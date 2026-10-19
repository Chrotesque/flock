import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	apportion,
	creditStep,
	creditWords,
	followerStep,
	mergeBackfill,
	readState,
	recentHigh,
	settingKey,
	viewGains,
	viewsAt
} from './followers.mjs';

const T = Date.parse('2026-10-20T12:00:00.000Z');
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

const start = (count, at = T - 10 * MIN) => ({
	platform: 'youtube',
	account: 'UC1',
	name: 'Owls Nest',
	count,
	at: iso(at),
	since: iso(at - 86_400_000),
	history: [[iso(at - 86_400_000), count]],
	credits: {}
});

test('views at a moment are the last sample at or before it', () => {
	const history = [
		[iso(T - 30 * MIN), 10, 1, 0],
		[iso(T - 20 * MIN), 25, 1, 0],
		[iso(T - 5 * MIN), 40, 2, 0]
	];
	assert.equal(viewsAt(history, T - 10 * MIN), 25);
	assert.equal(viewsAt(history, T - 31 * MIN), null);
	assert.equal(viewsAt(history, T), 40);
});

test('view gains count a post out since the start from 0 and leave out one not read then', () => {
	const from = T - 10 * MIN;
	const gains = viewGains(
		[
			{ id: 'old', at: T - 86_400_000, views: 120, history: [[iso(T - 60 * MIN), 100]] },
			{ id: 'fresh', at: T - 5 * MIN, views: 30, history: [] },
			{ id: 'unread', at: T - 86_400_000, views: 500, history: [[iso(T - 2 * MIN), 500]] },
			{ id: 'quiet', at: T - 86_400_000, views: 80, history: [[iso(T - 60 * MIN), 80]] },
			{ id: 'scheduled', at: T + 60 * MIN, views: 0, history: [] }
		],
		from,
		T
	);
	assert.deepEqual(gains, [
		{ id: 'old', gain: 20 },
		{ id: 'fresh', gain: 30 }
	]);
});

test('followers are shared out whole, the rest to the largest remainders', () => {
	assert.deepEqual(apportion(1, [{ id: 'a', gain: 10 }, { id: 'b', gain: 90 }]), { b: 1 });
	assert.deepEqual(apportion(3, [{ id: 'a', gain: 70 }, { id: 'b', gain: 20 }, { id: 'c', gain: 10 }]), { a: 2, b: 1 });
	assert.deepEqual(apportion(3, [{ id: 'a', gain: 50 }, { id: 'b', gain: 30 }, { id: 'c', gain: 20 }]), { a: 1, b: 1, c: 1 });
	assert.deepEqual(apportion(2, [{ id: 'a', gain: 1 }, { id: 'b', gain: 1 }]), { a: 1, b: 1 });
	// A tie goes to the first listed.
	assert.deepEqual(apportion(1, [{ id: 'a', gain: 5 }, { id: 'b', gain: 5 }]), { a: 1 });
	assert.deepEqual(apportion(0, [{ id: 'a', gain: 5 }]), {});
	assert.deepEqual(apportion(2, []), {});
});

test('the recent high is the highest count held at any moment of the last day', () => {
	const history = [
		[iso(T - 3 * 86_400_000), 700],
		[iso(T - 30 * 3_600_000), 705],
		[iso(T - 2 * 3_600_000), 703]
	];
	// 705 was still the count when the window opened.
	assert.equal(recentHigh(history, T), 705);
	assert.equal(recentHigh([[iso(T - 3 * 86_400_000), 700]], T), 700);
	assert.equal(recentHigh([], T), null);
});

test('the first read only starts the record', () => {
	const step = creditStep(null, { platform: 'youtube', account: 'UC1', name: 'Owls Nest', count: 709, now: T, posts: [] });
	assert.equal(step.gained, 0);
	assert.deepEqual(step.credited, {});
	assert.equal(step.state.since, iso(T));
	assert.deepEqual(step.state.history, [[iso(T), 709]]);
});

test('a rise goes to the videos that gained views in the stretch, by their views', () => {
	const posts = [
		{ id: 'a', at: T - 86_400_000, views: 1300, history: [[iso(T - 15 * MIN), 1000]] },
		{ id: 'b', at: T - 2 * 86_400_000, views: 600, history: [[iso(T - 15 * MIN), 500]] }
	];
	const step = creditStep(start(709), { platform: 'youtube', account: 'UC1', name: 'Owls Nest', count: 713, now: T, posts });
	assert.equal(step.gained, 4);
	assert.deepEqual(step.credited, { a: 3, b: 1 });
	assert.deepEqual(step.state.credits, { a: 3, b: 1 });
	assert.equal(step.state.count, 713);
	assert.deepEqual(step.state.history.at(-1), [iso(T), 713]);
	assert.equal(step.state.at, iso(T));
});

test('with no view gained in the stretch, the newest video out takes the rise', () => {
	const posts = [
		{ id: 'older', at: T - 2 * 86_400_000, views: 50, history: [[iso(T - 60 * MIN), 50]] },
		{ id: 'newest', at: T - 86_400_000, views: 20, history: [[iso(T - 60 * MIN), 20]] },
		{ id: 'scheduled', at: T + 3_600_000, views: 0, history: [] }
	];
	const step = creditStep(start(10), { platform: 'instagram', account: '17', name: '@owls', count: 11, now: T, posts });
	assert.deepEqual(step.credited, { newest: 1 });
});

test('a count that dips and comes back credits nothing twice', () => {
	const posts = [{ id: 'a', at: T - 86_400_000, views: 5000, history: [[iso(T - 120 * MIN), 1000]] }];
	const first = creditStep(start(709, T - 30 * MIN), { platform: 'youtube', account: 'UC1', name: '', count: 710, now: T - 20 * MIN, posts });
	assert.equal(first.gained, 1);
	const dip = creditStep(first.state, { platform: 'youtube', account: 'UC1', name: '', count: 709, now: T - 10 * MIN, posts });
	assert.equal(dip.gained, 0);
	const back = creditStep(dip.state, { platform: 'youtube', account: 'UC1', name: '', count: 710, now: T, posts });
	assert.equal(back.gained, 0);
	assert.deepEqual(back.state.credits, { a: 1 });
	const more = creditStep(back.state, { platform: 'youtube', account: 'UC1', name: '', count: 712, now: T + 10 * MIN, posts });
	assert.equal(more.gained, 2);
	assert.deepEqual(more.state.credits, { a: 3 });
});

test('an unchanged count writes no sample', () => {
	const step = creditStep(start(709), { platform: 'youtube', account: 'UC1', name: 'Owls Nest', count: 709, now: T, posts: [] });
	assert.equal(step.state.history.length, 1);
	assert.equal(step.state.at, iso(T));
});

test('a stored row is read back field by field', () => {
	assert.equal(readState(null), null);
	assert.equal(readState({ count: 'x', at: iso(T) }), null);
	const state = readState({
		platform: 'youtube',
		account: 'UC1',
		count: 709,
		at: iso(T),
		history: [[iso(T), 709], ['nonsense', 1], 'junk'],
		credits: { a: 2, b: 0, c: 'x' }
	});
	assert.deepEqual(state.history, [[iso(T), 709]]);
	assert.deepEqual(state.credits, { a: 2 });
	assert.equal(state.since, iso(T));
});

test('a step reads the row afresh and writes it back under the account key', async () => {
	const rows = new Map([[settingKey('youtube', 'UC1'), { value: start(709) }]]);
	const pb = {
		getSetting: async (key) => rows.get(key) ?? null,
		setSetting: async (key, value) => rows.set(key, { value })
	};
	const posts = [{ id: 'a', at: T - 86_400_000, views: 1300, history: [[iso(T - 15 * MIN), 1000]] }];
	const step = await followerStep({ pb, platform: 'youtube', account: 'UC1', name: 'Owls Nest', count: 710, posts, now: T });
	assert.equal(step.gained, 1);
	assert.deepEqual(rows.get('followers:youtube:UC1').value.credits, { a: 1 });
	// The same read again credits nothing: the row already holds it.
	const again = await followerStep({ pb, platform: 'youtube', account: 'UC1', name: 'Owls Nest', count: 710, posts, now: T + MIN });
	assert.equal(again.gained, 0);
	assert.equal(creditWords('Owls Nest', step, (id) => (id === 'a' ? 'A Short' : '')), 'followers Owls Nest: +1 (now 710) — 1 to "A Short"');
});

test("the platform's past counts go in front, changes only, once", () => {
	const day = 86_400_000;
	const state = { ...start(1016, T - 10 * MIN), history: [[iso(T - 2 * day), 1016]], since: iso(T - 2 * day) };
	const daily = [
		[iso(T - 6 * day), 1020],
		[iso(T - 5 * day), 1020],
		[iso(T - 4 * day), 1018],
		[iso(T - 3 * day), 1017],
		// From the day flock was reading on, its own samples stand.
		[iso(T - 2 * day), 9999],
		[iso(T - day), 9999]
	];
	const merged = mergeBackfill(state, daily, T);
	assert.deepEqual(merged.history, [
		[iso(T - 6 * day), 1020],
		[iso(T - 4 * day), 1018],
		[iso(T - 3 * day), 1017],
		[iso(T - 2 * day), 1016]
	]);
	assert.equal(merged.since, iso(T - 6 * day));
	assert.equal(merged.backfilled, iso(T));
	// Kept through the next read.
	assert.equal(readState(merged).backfilled, iso(T));
	const next = creditStep(readState(merged), { platform: 'facebook', account: 'P', name: 'Owls Nest', count: 1016, now: T + MIN, posts: [] });
	assert.equal(next.state.backfilled, iso(T));
	// Nothing given: marked done all the same, so it is not asked again.
	assert.equal(mergeBackfill(state, [], T).backfilled, iso(T));
	assert.deepEqual(mergeBackfill(state, [], T).history, state.history);
});
