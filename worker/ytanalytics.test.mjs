import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_SCOPE, canReadAnalytics, dailyCounts, dayEnd, lastDay, morePages, perVideo, reportRows } from './ytanalytics.mjs';
import { readState } from './followers.mjs';

const report = (names, rows) => ({ columnHeaders: names.map((name) => ({ name })), rows });

test('a grant reads Analytics only with its scope among the ones Google reported', () => {
	assert.equal(canReadAnalytics(`https://www.googleapis.com/auth/youtube.upload ${ANALYTICS_SCOPE}`), true);
	assert.equal(canReadAnalytics('https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.readonly'), false);
	assert.equal(canReadAnalytics(null), false);
});

test('report rows read by column name, per video as [gained, lost]', () => {
	const rows = reportRows(
		report(['video', 'subscribersGained', 'subscribersLost'], [
			['vidA', 12, 1],
			['vidB', 0, 2],
			['vidC', 0, 0]
		])
	);
	assert.deepEqual(rows[0], { video: 'vidA', subscribersGained: 12, subscribersLost: 1 });
	assert.deepEqual(perVideo(rows), { vidA: [12, 1], vidB: [0, 2] });
	assert.deepEqual(reportRows({}), []);
});

test("the channel's days add up to counts, shifted to meet the first count flock recorded", () => {
	const days = reportRows(
		report(['day', 'subscribersGained', 'subscribersLost'], [
			['2026-10-18', 3, 1],
			['2026-10-16', 5, 0],
			['2026-10-17', 0, 1]
		])
	);
	assert.equal(lastDay(days), '2026-10-18');
	assert.equal(dayEnd('2026-10-16'), '2026-10-17T08:00:00.000Z');
	assert.deepEqual(dailyCounts(days), [
		['2026-10-17T08:00:00.000Z', 5],
		['2026-10-18T08:00:00.000Z', 4],
		['2026-10-19T08:00:00.000Z', 6]
	]);
	// flock first read 709 on the 20th: the level is flock's, the moves YouTube's.
	assert.deepEqual(dailyCounts(days, { at: Date.parse('2026-10-20T22:47:00Z'), count: 709 }), [
		['2026-10-17T08:00:00.000Z', 708],
		['2026-10-18T08:00:00.000Z', 707],
		['2026-10-19T08:00:00.000Z', 709]
	]);
	assert.equal(lastDay([]), '');
});

test('the top-videos report is paged only while a full page still ends in gains', () => {
	const full = (last) => Array.from({ length: 200 }, (_, i) => ({ subscribersGained: i === 199 ? last : 5 }));
	assert.equal(morePages(full(1), 1), true);
	assert.equal(morePages(full(0), 1), false);
	assert.equal(morePages(full(1), 5), false);
	assert.equal(morePages([{ subscribersGained: 3 }], 1), false);
});

test("a follower row keeps YouTube's figures through the next read", () => {
	const state = readState({
		platform: 'youtube',
		account: 'UC1',
		count: 709,
		at: '2026-10-20T22:47:00Z',
		history: [['2026-10-20T22:47:00Z', 709]],
		analytics: { vidA: [12, 1], junk: 'x' },
		analyticsThrough: '2026-10-18'
	});
	assert.deepEqual(state.analytics, { vidA: [12, 1] });
	assert.equal(state.analyticsThrough, '2026-10-18');
	assert.equal(readState({ count: 1, at: '2026-10-20T22:47:00Z' }).analytics, null);
});
