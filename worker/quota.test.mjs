import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	charge,
	countUpload,
	mergeHistory,
	pacificDay,
	quotaToday,
	readRecord,
	resetQuota,
	restoreQuota,
	returnFinishedDays,
	statsMayRead,
	takeFinishedDays,
	unitCost,
	unitsToday
} from './quota.mjs';

beforeEach(() => resetQuota());

test('a read costs 1 unit, any write 50', () => {
	assert.equal(unitCost('GET'), 1);
	assert.equal(unitCost(), 1);
	assert.equal(unitCost('POST'), 50);
	assert.equal(unitCost('put'), 50);
	assert.equal(unitCost('DELETE'), 50);
});

test('the day is Pacific: 07:00 UTC in summer time starts it', () => {
	assert.equal(pacificDay(new Date('2026-10-23T06:59:00Z')), '2026-10-22');
	assert.equal(pacificDay(new Date('2026-10-23T07:00:00Z')), '2026-10-23');
	// Winter time: 08:00 UTC.
	assert.equal(pacificDay(new Date('2026-12-01T07:59:00Z')), '2026-11-30');
	assert.equal(pacificDay(new Date('2026-12-01T08:00:00Z')), '2026-12-01');
});

test('units add up by kind, an unknown kind as other, uploads apart', () => {
	charge('stats', 1);
	charge('stats', 1);
	charge('playlist', 51);
	charge('rename', 51);
	charge('surprise', 3);
	charge('stats', 0);
	charge('stats', -4);
	countUpload();
	countUpload();
	const q = quotaToday();
	assert.equal(q.day, pacificDay());
	assert.equal(q.units, 107);
	assert.equal(unitsToday(), 107);
	assert.deepEqual(q.kinds, { stats: 2, playlist: 51, rename: 51, other: 3 });
	assert.equal(q.uploads, 2);
});

test('a restart takes up what the day had spent, once, on top of its own', () => {
	charge('move', 51);
	countUpload();
	restoreQuota({ day: pacificDay(), units: 3400, kinds: { stats: 3300, playlist: 100, odd: 0 }, uploads: 9 });
	restoreQuota({ day: pacificDay(), units: 3400, kinds: { stats: 3300 }, uploads: 9 });
	const q = quotaToday();
	assert.equal(q.units, 3451);
	assert.deepEqual(q.kinds, { move: 51, stats: 3300, playlist: 100 });
	assert.equal(q.uploads, 10);
});

test('another day, or nothing, restores nothing', () => {
	restoreQuota({ day: '2001-01-01', units: 3400, kinds: { stats: 3400 }, uploads: 2 });
	assert.equal(unitsToday(), 0);
	resetQuota();
	restoreQuota(null);
	assert.equal(unitsToday(), 0);
	resetQuota();
	restoreQuota({ day: pacificDay(), units: 'many', kinds: 'none', uploads: -1 });
	assert.deepEqual(quotaToday().kinds, {});
	assert.equal(quotaToday().uploads, 0);
});

test('the automatic reads stop at the budget, a Refresh at the ceiling', () => {
	const limits = { budget: 8000, ceiling: 9000 };
	assert.equal(statsMayRead({ units: 7997, ...limits }), 'read');
	assert.equal(statsMayRead({ units: 7999, ...limits }), 'stopped');
	assert.equal(statsMayRead({ units: 7999, ...limits, manual: true }), 'read');
	assert.equal(statsMayRead({ units: 8997, ...limits, manual: true }), 'read');
	assert.equal(statsMayRead({ units: 8999, ...limits, manual: true }), 'ceiling');
	assert.equal(statsMayRead({ units: 9500, budget: 0, ceiling: 0 }), 'read');
	assert.equal(statsMayRead({ units: 9500, budget: 0, ceiling: 0, manual: true }), 'read');
});

test('an edit is kept as an event, its calls within a minute as one; reads are not', () => {
	const at = (s) => new Date(Date.parse('2026-10-23T18:00:00Z') + s * 1000);
	// A fixed instant: the Pacific day of 18:00 UTC is the 23rd.
	charge('stats', 1, at(0));
	charge('rename', 1, at(1));
	charge('rename', 50, at(2));
	charge('playlist', 1, at(30));
	charge('playlist', 50, at(31));
	charge('playlist', 50, at(32));
	charge('channel', 1, at(40));
	charge('rename', 51, at(200));
	// A charge on the next day ends the 23rd, which hands its record over.
	charge('stats', 1, new Date('2026-10-24T18:00:00Z'));
	const q = takeFinishedDays().find((d) => d.day === '2026-10-23');
	assert.deepEqual(q.events, [
		[at(1).toISOString(), 'rename', 51],
		[at(30).toISOString(), 'playlist', 101],
		[at(200).toISOString(), 'rename', 51]
	]);
});

test('a day that ends goes to the history, once', () => {
	charge('stats', 7, new Date('2026-10-20T12:00:00Z'));
	charge('move', 51, new Date('2026-10-20T13:00:00Z'));
	countUpload(new Date('2026-10-20T14:00:00Z'));
	charge('stats', 3, new Date('2026-10-21T12:00:00Z'));
	const days = takeFinishedDays();
	const ended = days.find((d) => d.day === '2026-10-20');
	assert.ok(ended);
	assert.equal(ended.units, 58);
	assert.equal(ended.uploads, 1);
	assert.deepEqual(ended.kinds, { stats: 7, move: 51 });
	assert.equal(ended.events.length, 1);
	assert.equal(takeFinishedDays().filter((d) => d.day === '2026-10-20').length, 0);
	returnFinishedDays(days);
	assert.ok(takeFinishedDays().some((d) => d.day === '2026-10-20'));
});

test('a restart finding an earlier day hands it to the history', () => {
	restoreQuota({ day: '2026-10-01', units: 4100, kinds: { stats: 4000, rename: 100 }, uploads: 3, events: [['2026-10-01T10:00:00Z', 'rename', 100]] });
	assert.equal(unitsToday(), 0);
	const [day] = takeFinishedDays();
	assert.equal(day.day, '2026-10-01');
	assert.equal(day.units, 4100);
	assert.deepEqual(day.events, [['2026-10-01T10:00:00Z', 'rename', 100]]);
});

test('the history keeps the newest days, the larger of a day handed over twice, without the day inside', () => {
	const stored = {
		days: {
			'2026-10-01': { units: 10, kinds: { stats: 10 }, uploads: 0, events: [] },
			'2026-10-02': { units: 20, kinds: { stats: 20 }, uploads: 1, events: [] },
			'2026-10-03': { units: 'bad' }
		}
	};
	const merged = mergeHistory(stored, [
		{ day: '2026-10-02', units: 15, kinds: { stats: 15 }, uploads: 0, events: [] },
		{ day: '2026-10-04', units: 40, kinds: { stats: 30, move: 10 }, uploads: 2, events: [['2026-10-04T08:00:00Z', 'move', 10]] }
	], 2);
	assert.deepEqual(Object.keys(merged.days), ['2026-10-02', '2026-10-04']);
	assert.equal(merged.days['2026-10-02'].units, 20);
	assert.equal(merged.days['2026-10-04'].day, undefined);
	assert.deepEqual(merged.days['2026-10-04'].kinds, { stats: 30, move: 10 });
	assert.deepEqual(mergeHistory(null, []), { days: {} });
});

test('a stored record is read field by field', () => {
	assert.equal(readRecord(null), null);
	assert.equal(readRecord({ day: '2026-10-05', units: 0 }), null);
	assert.deepEqual(
		readRecord({ day: '2026-10-05', units: 9, kinds: { stats: 8, weird: 1 }, uploads: 'x', events: [['nope', 'move', 5], ['2026-10-05T01:00:00Z', 'zap', 1]] }),
		{ day: '2026-10-05', units: 9, kinds: { stats: 8, other: 1 }, uploads: 0, events: [['2026-10-05T01:00:00Z', 'other', 1]] }
	);
});
