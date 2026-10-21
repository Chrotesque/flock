import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropQuietStart, insightTotals, lastDayOf, monthStretches, newest, wholeMonths, youtubeMonthly } from './monthly.mjs';
import { readMonthly, readState } from './followers.mjs';

const day = (d, views, likes = 0, comments = 0) => ({ day: d, subscribersGained: 0, subscribersLost: 0, views, likes, comments });

test("a channel's whole months add up its days, from the first month it was active all of", () => {
	const rows = [
		day('2026-07-30', 0),
		day('2026-08-10', 50, 2, 1), // first activity: August is not whole
		day('2026-09-01', 100, 5, 1),
		day('2026-09-30', 20, 1, 0),
		day('2026-10-01', 300, 9, 2),
		day('2026-10-18', 40, 1, 0)
	];
	// YouTube has days through 18 Oct: October is still running.
	assert.deepEqual(youtubeMonthly(rows, '2026-10-18'), { '2026-09': [120, 6, 1] });
	// Through the 31st, October is whole too.
	assert.deepEqual(youtubeMonthly(rows, '2026-10-31'), { '2026-09': [120, 6, 1], '2026-10': [340, 10, 2] });
	assert.deepEqual(youtubeMonthly([day('2026-09-01', 0)], '2026-10-18'), {});
	assert.deepEqual(youtubeMonthly(rows, ''), {});
});

test('a month starting on the first active day counts as whole', () => {
	assert.deepEqual(youtubeMonthly([day('2026-09-01', 7), day('2026-09-30', 3)], '2026-09-30'), { '2026-09': [10, 0, 0] });
});

test('months are whole calendar months before now, kept to the newest thirteen', () => {
	const now = Date.parse('2026-10-21T00:53:00Z');
	assert.deepEqual(wholeMonths(now, 3), ['2026-07', '2026-08', '2026-09']);
	// Two days into November, Instagram's lag still holds October back.
	assert.deepEqual(wholeMonths(Date.parse('2026-11-01T12:00:00Z'), 2, 2 * 86_400_000), ['2026-08', '2026-09']);
	assert.deepEqual(wholeMonths(Date.parse('2026-01-05T00:00:00Z'), 2), ['2025-11', '2025-12']);
	const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`2025-${String((i % 12) + 1).padStart(2, '0')}-x${i}`, [i, 0, 0]]));
	assert.equal(Object.keys(newest(many)).length, 13);
	assert.equal(lastDayOf('2026-02'), '2026-02-28');
	assert.equal(lastDayOf('2026-12'), '2026-12-31');
});

test("a month is asked of Instagram in two stretches under its 30-day limit", () => {
	const [[a, b], [c, d]] = monthStretches('2026-08');
	assert.equal(new Date(a * 1000).toISOString(), '2026-08-01T00:00:00.000Z');
	assert.equal(b, c);
	assert.equal(new Date(d * 1000).toISOString(), '2026-09-01T00:00:00.000Z');
	assert.ok(b - a <= 30 * 86_400 && d - c <= 30 * 86_400);
});

test('quiet months before an account was active are left out, quiet ones after it kept', () => {
	assert.deepEqual(
		dropQuietStart({ '2026-03': [0, 0, 0], '2026-01': [0, 0, 0], '2026-04': [5, 0, 0], '2026-05': [0, 0, 0] }),
		{ '2026-04': [5, 0, 0], '2026-05': [0, 0, 0] }
	);
	assert.deepEqual(insightTotals({ data: [{ name: 'views', total_value: { value: 7616 } }, { name: 'comments', total_value: { value: 14 } }] }), [7616, 0, 14]);
});

test('a follower row keeps its months through the next read', () => {
	const state = readState({ count: 1, at: '2026-10-20T22:47:00Z', monthly: { '2026-09': [120, 6, 1], junk: [1, 2, 3], '2026-08': [1, 2] } });
	assert.deepEqual(state.monthly, { '2026-09': [120, 6, 1] });
	assert.equal(readState({ count: 1, at: '2026-10-20T22:47:00Z' }).monthly, null);
	assert.equal(readMonthly('x'), null);
});
