import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ALERT_DEFAULTS,
	addSeen,
	autostartCommand,
	cardItems,
	decodeLine,
	encodeLine,
	readAlertSettings,
	readDismissed,
	readSeen,
	runName,
	sameWarnings,
	SEEN_CAP,
	toShow,
	undelivered
} from './alerts.mjs';

const H = 3_600_000;
const NOW = new Date('2026-10-14T15:00:00Z');
const now = NOW.getTime();
const pb = (ms) => new Date(ms).toISOString().replace('T', ' ');

const target = (over) => ({
	id: 't',
	job: 'j',
	platform: 'instagram',
	status: 'pending',
	scheduled_at: pb(now + H),
	updated: pb(now - 2 * H),
	title: '',
	error: '',
	expand: { job: { created: pb(now - 3 * H), title: 'Owls at dusk', source_local: false } },
	...over
});

describe('readAlertSettings', () => {
	it('is the defaults with nothing stored', () => {
		assert.deepEqual(readAlertSettings(undefined), ALERT_DEFAULTS);
		assert.deepEqual(readAlertSettings('junk'), ALERT_DEFAULTS);
	});

	it('keeps what is valid and drops the rest, field by field', () => {
		const read = readAlertSettings({
			enabled: false,
			screen: '\\\\.\\DISPLAY2',
			position: 'bottom-left',
			size: 'huge',
			pulse: 'yes',
			slide: false,
			seen: ['x']
		});
		assert.deepEqual(read, {
			...ALERT_DEFAULTS,
			enabled: false,
			screen: '\\\\.\\DISPLAY2',
			position: 'bottom-left',
			slide: false
		});
		assert.equal(readAlertSettings({ screen: 'DISPLAY2' }).screen, 'second');
	});
});

describe('undelivered', () => {
	it('lists a failure of the last week and a post never sent, newest first', () => {
		const items = undelivered(
			[
				target({ id: 'f', status: 'failed', scheduled_at: pb(now - 2 * H), updated: pb(now - H), error: 'Refused\nmore' }),
				target({ id: 'old', status: 'failed', scheduled_at: pb(now - 8 * 24 * H) }),
				target({ id: 'late', scheduled_at: pb(now - 3 * H), title: 'Paper Moon' }),
				target({ id: 'soon', scheduled_at: pb(now + H) }),
				target({ id: 'done', status: 'published', scheduled_at: pb(now - H) })
			],
			NOW
		);
		assert.deepEqual(
			items.map((i) => [i.key, i.kind, i.title, i.detail]),
			[
				[`failed:f:${pb(now - H)}`, 'failed', 'Owls at dusk', 'Refused'],
				['unsent:late', 'unsent', 'Paper Moon', 'Its slot passed and it was never sent.']
			]
		);
		assert.equal(items[0].label, 'Instagram');
	});

	it('waits for YouTube from the upload, and from a retry', () => {
		const yt = target({ id: 'yt', platform: 'youtube', scheduled_at: pb(now + 5 * H), updated: pb(now - 20 * 60_000) });
		assert.deepEqual(undelivered([yt], NOW).map((i) => i.key), ['unsent:yt']);
		const retried = target({ id: 'r', scheduled_at: pb(now - 3 * H), updated: pb(now - 60_000) });
		assert.deepEqual(undelivered([retried], NOW), []);
	});

	it('leaves a local video still being copied to the NAS alone', () => {
		const importing = target({ scheduled_at: pb(now - 3 * H), expand: { job: { created: pb(now - 4 * H), source_local: true } } });
		assert.deepEqual(undelivered([importing], NOW), []);
	});
});

describe('toShow, dismissed and seen', () => {
	const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

	it('leaves out what flock dismissed and what was dismissed here', () => {
		assert.deepEqual(toShow(items, { dismissed: ['a'], seen: ['c'] }), [{ key: 'b' }]);
		assert.deepEqual(toShow(items), items);
	});

	it('reads the stored lists whatever they hold', () => {
		assert.deepEqual(readDismissed({ dismissed: ['a', 2, ''] }), ['a']);
		assert.deepEqual(readDismissed(null), []);
		assert.deepEqual(readSeen({ seen: 'x' }), []);
		assert.deepEqual(readSeen({ seen: ['b'] }), ['b']);
	});

	it('adds seen keys once, newest last, capped', () => {
		assert.deepEqual(addSeen(['a', 'b'], ['a', 'c', '']), ['b', 'a', 'c']);
		const full = Array.from({ length: SEEN_CAP }, (_, i) => `k${i}`);
		const next = addSeen(full, ['new']);
		assert.equal(next.length, SEEN_CAP);
		assert.equal(next.at(-1), 'new');
	});

	it('tells a change of warnings by their keys', () => {
		assert.equal(sameWarnings([{ key: 'a' }], [{ key: 'a', title: 'x' }]), true);
		assert.equal(sameWarnings([{ key: 'a' }], [{ key: 'b' }]), false);
		assert.equal(sameWarnings([], [{ key: 'a' }]), false);
	});
});

describe('cardItems', () => {
	it("points Open in flock at the upload's overview", () => {
		const [item] = cardItems([{ key: 'k', label: 'TikTok', title: 'Clip', detail: 'x', job: 'ab c' }], 'https://flock.example/');
		assert.deepEqual(item, {
			key: 'k',
			platform: 'TikTok',
			title: 'Clip',
			detail: 'x',
			url: 'https://flock.example/log/upload?job=ab%20c'
		});
		assert.equal(cardItems([{ key: 'k', job: '' }], 'https://flock.example')[0].url, 'https://flock.example/');
	});
});

describe('start with Windows', () => {
	it("names the entry by role and quotes the program's path", () => {
		assert.equal(runName('all'), 'flock worker');
		assert.equal(runName('local'), 'flock worker (local)');
		assert.equal(autostartCommand('C:\\Program Files\\flock\\flock-worker-background.exe'), '"C:\\Program Files\\flock\\flock-worker-background.exe" --autostart');
	});
});

describe('the line protocol', () => {
	it('carries any text through both ways', () => {
		const payload = { items: [{ title: 'Werbung – in Zusammenarbeit 🐦 "quoted"\nline' }] };
		const line = encodeLine('show', payload);
		assert.match(line, /^show [A-Za-z0-9+/=]+\n$/);
		assert.deepEqual(decodeLine(line), { type: 'show', payload });
	});

	it('takes a bare word, and survives junk', () => {
		assert.equal(encodeLine('hide'), 'hide\n');
		assert.deepEqual(decodeLine('ready\r\n'), { type: 'ready', payload: undefined });
		assert.deepEqual(decodeLine('dismiss !!!'), { type: 'dismiss', payload: undefined });
		assert.equal(decodeLine('  '), null);
	});
});
