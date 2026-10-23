import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	charge,
	countUpload,
	pacificDay,
	quotaToday,
	resetQuota,
	restoreQuota,
	statsMayRead,
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
