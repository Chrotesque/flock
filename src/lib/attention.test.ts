import { describe, expect, it } from 'vitest';
import {
	addDismissed,
	attentionItems,
	DISMISSED_CAP,
	hasFailure,
	readDismissed,
	systemProblems,
	targetProblems
} from './attention';
import type { DashTarget } from './dashboard';
import type { Account, StatsStatus } from './types';
import type { WorkerDot } from './workerstatus';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = new Date(2026, 9, 14, 15, 0); // Wed 14 Oct 2026, 15:00 local
const now = NOW.getTime();

const target = (over: Partial<DashTarget>): DashTarget => ({
	id: 't',
	job: 'j',
	platform: 'tiktok',
	status: 'pending',
	scheduled_at: iso(now + H),
	title: 'Clip',
	visibility: '',
	jobTitle: 'Clip',
	jobCreated: iso(now - 2 * H),
	importing: false,
	jobError: '',
	...over
});
const label = (p: string) => p;

const account = (over: Partial<Account>): Account => ({
	id: 'r',
	platform: 'tiktok',
	account_id: 'a1',
	handle: 'owlsnest',
	name: 'Owls Nest',
	details: null,
	error: '',
	fetched_at: '',
	...over
});

const up: WorkerDot = { role: 'nas', state: 'up', title: '' };

describe('targetProblems', () => {
	it('flags failures, posts never sent, long uploads, waiting imports and private slots', () => {
		const problems = targetProblems(
			[
				target({ id: 'f', status: 'failed', scheduled_at: iso(now - 2 * H), error: 'audience not offered' }),
				target({ id: 'old', status: 'failed', scheduled_at: iso(now - 9 * 24 * H) }),
				target({ id: 'late', status: 'pending', scheduled_at: iso(now - 30 * 60_000) }),
				target({ id: 'soon', status: 'pending', scheduled_at: iso(now + H) }),
				target({ id: 'yt', platform: 'youtube', status: 'pending', jobCreated: iso(now - 20 * 60_000), scheduled_at: iso(now + 5 * H) }),
				target({ id: 'stuck', status: 'publishing', scheduled_at: iso(now - 2 * H) }),
				target({ id: 'imp', job: 'k', status: 'pending', importing: true, jobCreated: iso(now - 15 * 60_000) }),
				target({ id: 'imp2', job: 'k', platform: 'instagram', status: 'pending', importing: true, jobCreated: iso(now - 15 * 60_000) }),
				target({ id: 'priv', platform: 'youtube', status: 'published', visibility: 'Private', jobCreated: iso(now - 9 * H), scheduled_at: iso(now - H) }),
				target({ id: 'privnow', platform: 'youtube', status: 'published', visibility: 'Private', jobCreated: iso(now - H), scheduled_at: iso(now - H - 30_000) })
			],
			NOW,
			label
		);
		const texts = problems.map((p) => p.text);
		expect(texts).toContain('tiktok: "Clip" failed');
		expect(texts.filter((t) => t.endsWith('failed'))).toHaveLength(1);
		expect(texts.filter((t) => t.endsWith('was never sent'))).toHaveLength(2);
		expect(texts).toContain('tiktok: "Clip" has been uploading for 2 h');
		expect(texts.filter((t) => t.includes('not on the NAS yet'))).toHaveLength(1);
		expect(texts.filter((t) => t.includes('private, with a slot'))).toHaveLength(1);
		expect(problems.findIndex((p) => p.level === 'warn')).toBeGreaterThan(problems.findLastIndex((p) => p.level === 'error'));
	});

	it('keys each post item, a failure by its row as it stands', () => {
		const [first] = targetProblems(
			[target({ id: 'f', status: 'failed', scheduled_at: iso(now - H), updated: '2026-10-14 12:00:00.000Z', brand: 'b1' })],
			NOW,
			label
		);
		expect(first).toMatchObject({ kind: 'failed', key: 'failed:f:2026-10-14 12:00:00.000Z', platform: 'tiktok', brand: 'b1', job: 'j' });
		const [again] = targetProblems(
			[target({ id: 'f', status: 'failed', scheduled_at: iso(now - H), updated: '2026-10-14 13:00:00.000Z' })],
			NOW,
			label
		);
		expect(again.key).not.toBe(first.key);
	});
});

describe('systemProblems', () => {
	const quiet = { dots: [up], accounts: [], targets: [], status: null, now: NOW };

	it('says nothing when all is well', () => {
		expect(systemProblems(quiet)).toEqual([]);
	});

	it('flags a publishing worker down, not the PC one', () => {
		const items = systemProblems({
			...quiet,
			dots: [
				{ role: 'nas', state: 'down', title: '' },
				{ role: 'local', state: 'down', title: '' }
			]
		});
		expect(items.map((i) => i.text)).toEqual(['The NAS worker is not running']);
		expect(items[0]).toMatchObject({ kind: 'system', key: '', level: 'error' });
	});

	it("flags a TikTok account's trouble only while posts wait for it", () => {
		const troubled = account({ error: 'spam_risk_too_many_posts\nmore' });
		expect(systemProblems({ ...quiet, accounts: [troubled] })).toEqual([]);
		const items = systemProblems({ ...quiet, accounts: [troubled], targets: [target({ account: 'a1' })] });
		expect(items.map((i) => [i.text, i.detail])).toEqual([['TikTok says @owlsnest cannot post right now', 'spam_risk_too_many_posts']]);
		// A post naming no account goes out as the platform's only one…
		expect(systemProblems({ ...quiet, accounts: [troubled], targets: [target({ account: '' })] })).toHaveLength(1);
		// …and as no one in particular once there are several.
		const other = account({ id: 'r2', account_id: 'a2', handle: 'papermoon' });
		expect(systemProblems({ ...quiet, accounts: [troubled, other], targets: [target({ account: '' })] })).toEqual([]);
		expect(systemProblems({ ...quiet, accounts: [troubled, other], targets: [target({ account: 'a2' })] })).toEqual([]);
	});

	it("flags Instagram's used-up allowance with posts due within a day", () => {
		const full = account({ platform: 'instagram', details: { quotaUsed: 100, quotaTotal: 100 } });
		const post = (hours: number) => target({ platform: 'instagram', account: 'a1', scheduled_at: iso(now + hours * H) });
		expect(systemProblems({ ...quiet, accounts: [full], targets: [post(30)] })).toEqual([]);
		const [item] = systemProblems({ ...quiet, accounts: [full], targets: [post(2), post(30)] });
		expect(item.text).toBe("@owlsnest's 100 Instagram posts in 24 h are used up");
		expect(item.detail).toMatch(/^1 post is due within a day/);
	});

	it("flags YouTube's stats not being read, per channel, and the quota nearly gone", () => {
		const status: StatsStatus = {
			polledAt: '',
			unitsToday: 5500,
			budget: 6000,
			intervalSeconds: 30,
			videos: 50,
			error: '',
			channels: {
				UC1: { title: 'Owls Nest', polledAt: '', videos: 50, error: 'quotaExceeded' },
				UC2: { title: '', polledAt: '', videos: 50, error: '' }
			}
		};
		const texts = systemProblems({ ...quiet, status }).map((i) => i.text);
		expect(texts).toEqual(['YouTube stats are not being read for Owls Nest', 'YouTube quota nearly used up']);
	});
});

describe('attentionItems', () => {
	it('leaves out what was dismissed, never a system item, errors first', () => {
		const items = attentionItems({
			dots: [{ role: 'all', state: 'down', title: '' }],
			accounts: [],
			targets: [
				target({ id: 'f', status: 'failed', scheduled_at: iso(now - H), updated: 'u1' }),
				target({ id: 'stuck', status: 'publishing', scheduled_at: iso(now - 2 * H) })
			],
			status: null,
			now: NOW,
			label,
			dismissed: ['failed:f:u1', '']
		});
		expect(items.map((i) => i.kind)).toEqual(['system', 'stuck']);
	});
});

describe('hasFailure', () => {
	it('is a failed post or one that missed its slot, nothing milder', () => {
		const items = targetProblems(
			[
				target({ id: 'stuck', status: 'publishing', scheduled_at: iso(now - 2 * H) }),
				target({ id: 'late', status: 'pending', scheduled_at: iso(now - H) })
			],
			NOW,
			label
		);
		expect(hasFailure(items)).toBe(true);
		expect(hasFailure(items.filter((i) => i.kind !== 'unsent'))).toBe(false);
		expect(hasFailure([])).toBe(false);
	});
});

describe('dismissed keys', () => {
	it('reads whatever is stored as a list of keys', () => {
		expect(readDismissed(null)).toEqual([]);
		expect(readDismissed({ dismissed: 'x' })).toEqual([]);
		expect(readDismissed({ dismissed: ['a', 3, '', 'b'] })).toEqual(['a', 'b']);
	});

	it('adds each key once, newest last, and keeps the newest when full', () => {
		expect(addDismissed(['a', 'b'], 'a', 'c', '')).toEqual(['b', 'a', 'c']);
		const full = Array.from({ length: DISMISSED_CAP }, (_, i) => `k${i}`);
		const next = addDismissed(full, 'new');
		expect(next).toHaveLength(DISMISSED_CAP);
		expect(next[0]).toBe('k1');
		expect(next.at(-1)).toBe('new');
	});
});
