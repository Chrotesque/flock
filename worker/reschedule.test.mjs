import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movedHandle, refusedHandle, rescheduleStep, seconds } from './reschedule.mjs';

const now = Date.parse('2026-10-14T20:00:00Z');
const hours = (n) => new Date(now + n * 3_600_000).toISOString();
const row = (over = {}) => ({
	id: 'r1',
	platform: 'youtube',
	status: 'scheduled',
	scheduled_at: hours(24),
	handle: { release: hours(24) },
	...over
});

test('seconds reads PocketBase and ISO forms alike', () => {
	assert.equal(seconds('2026-10-15 18:00:00.000Z'), seconds('2026-10-15T18:00:00Z'));
	assert.equal(seconds('2026-11-04T19:57:44+0000'.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')), seconds('2026-11-04T19:57:44Z'));
	assert.ok(Number.isNaN(seconds('')));
});

test('a row whose time matches what the platform holds needs nothing', () => {
	assert.deepEqual(rescheduleStep(row(), { now }), { action: 'none' });
	// The same instant in PocketBase's form and to the millisecond still matches.
	const at = new Date(now + 24 * 3_600_000);
	assert.deepEqual(
		rescheduleStep(row({ scheduled_at: at.toISOString().replace('T', ' '), handle: { release: at.toISOString() } }), { now }),
		{ action: 'none' }
	);
});

test('a moved row is handed over with the new time', () => {
	assert.deepEqual(rescheduleStep(row({ scheduled_at: hours(30) }), { now }), {
		action: 'move',
		from: hours(24),
		to: hours(30)
	});
	assert.equal(rescheduleStep(row({ platform: 'facebook', scheduled_at: hours(2) }), { now }).action, 'move');
});

test('only scheduled YouTube and Facebook rows, not in hand and not moving brand, are looked at', () => {
	const moved = { scheduled_at: hours(30) };
	assert.equal(rescheduleStep(row({ ...moved, platform: 'instagram' }), { now }).action, 'none');
	assert.equal(rescheduleStep(row({ ...moved, status: 'pending' }), { now }).action, 'none');
	assert.equal(rescheduleStep(row({ ...moved, status: 'published' }), { now }).action, 'none');
	assert.equal(rescheduleStep(row(moved), { now, held: true }).action, 'none');
	assert.equal(rescheduleStep(row({ ...moved, move: { to: 'x' } }), { now }).action, 'none');
});

test('an upload from before has its time learnt first, only while it is ahead', () => {
	assert.equal(rescheduleStep(row({ handle: { kind: 'youtube' } }), { now }).action, 'learn');
	assert.equal(rescheduleStep(row({ handle: null }), { now }).action, 'learn');
	assert.equal(rescheduleStep(row({ handle: {}, scheduled_at: hours(-1) }), { now }).action, 'none');
	assert.equal(rescheduleStep(row({ handle: { released: true }, scheduled_at: hours(5) }), { now }).action, 'none');
});

test('a time the platform cannot take is refused, the post left where it was', () => {
	const near = rescheduleStep(row({ scheduled_at: new Date(now + 5 * 60_000).toISOString() }), { now });
	assert.equal(near.action, 'refuse');
	assert.match(near.reason, /11 minutes/);
	const far = rescheduleStep(row({ platform: 'facebook', scheduled_at: hours(24 * 30) }), { now });
	assert.equal(far.action, 'refuse');
	assert.match(far.reason, /29 days/);
	// YouTube has no such limit.
	assert.equal(rescheduleStep(row({ scheduled_at: hours(24 * 60) }), { now }).action, 'move');
	const out = rescheduleStep(row({ scheduled_at: hours(3), handle: { release: hours(-1) } }), { now });
	assert.equal(out.action, 'refuse');
	assert.match(out.reason, /out already/);
});

test('a move keeps the new time and clears an old refusal; a refusal says why and when', () => {
	const before = { kind: 'facebook-reel', videoId: '1', moveError: 'old', moveErrorAt: 'then', release: hours(1) };
	assert.deepEqual(movedHandle(before, hours(5)), { kind: 'facebook-reel', videoId: '1', release: hours(5) });
	const refused = refusedHandle({ release: hours(1) }, 'no', new Date(now));
	assert.deepEqual(refused, { release: hours(1), moveError: 'no', moveErrorAt: new Date(now).toISOString() });
});
