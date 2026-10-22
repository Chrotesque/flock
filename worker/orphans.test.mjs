import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, mayBeAlive, afterFailure, STALL_MS, INCOMPLETE_MS, READY_GRACE_MS, CONFIRM_MS, GONE_GRACE_MS } from './orphans.mjs';

const now = Date.parse('2026-10-04T12:00:00Z');
const iso = (ms) => new Date(now + ms).toISOString();
const handle = (kind, extra = {}) => ({ kind, run: 'r', role: 'nas', claimedAt: iso(-60_000), ...extra });

test('only a NAS row seen by a covering PC may still be in flight', () => {
	assert.equal(mayBeAlive({ role: 'nas' }, 'local'), true);
	assert.equal(mayBeAlive({ role: 'local' }, 'nas'), false);
	assert.equal(mayBeAlive({ role: 'all' }, 'all'), false);
	assert.equal(mayBeAlive({ role: 'nas' }, 'nas'), false);
});

test('a row with nothing sent to the platform is requeued', () => {
	assert.equal(decide({ handle: { run: 'r' }, probe: null, alive: true, now }).action, 'requeue');
	assert.equal(decide({ handle: null, probe: null, alive: false, now }).action, 'requeue');
});

test('a finished upload is recorded, never uploaded again', () => {
	const probe = { state: 'done', result: {} };
	assert.equal(decide({ handle: handle('youtube-session'), probe, alive: true, now }).action, 'finish');
	assert.equal(decide({ handle: handle('youtube-session'), probe, alive: false, now }).action, 'finish');
});

test('a YouTube session still growing is left alone', () => {
	const h = handle('youtube-session');
	const first = decide({ handle: h, probe: { state: 'uploading', bytes: 100 }, alive: true, now });
	assert.equal(first.action, 'leave');
	const later = decide({ handle: h, probe: { state: 'uploading', bytes: 900 }, alive: true, now: now + STALL_MS, seen: first.seen });
	assert.equal(later.action, 'leave');
	assert.equal(later.seen.bytes, 900);
});

test('a YouTube session that stopped growing is requeued after the stall window', () => {
	const h = handle('youtube-session');
	const seen = { bytes: 100, at: now };
	assert.equal(decide({ handle: h, probe: { state: 'uploading', bytes: 100 }, alive: true, now: now + 60_000, seen }).action, 'leave');
	assert.equal(decide({ handle: h, probe: { state: 'uploading', bytes: 100 }, alive: true, now: now + STALL_MS, seen }).action, 'requeue');
});

test('a part-uploaded row of a run that is over is requeued at once', () => {
	assert.equal(decide({ handle: handle('youtube-session'), probe: { state: 'uploading', bytes: 5 }, alive: false, now }).action, 'requeue');
	assert.equal(decide({ handle: handle('tiktok-publish'), probe: { state: 'incomplete' }, alive: false, now }).action, 'requeue');
});

test('an incomplete TikTok or Instagram upload is waited for until the window passes', () => {
	const h = handle('tiktok-publish', { claimedAt: iso(-INCOMPLETE_MS + 60_000) });
	assert.equal(decide({ handle: h, probe: { state: 'incomplete' }, alive: true, now }).action, 'leave');
	const old = handle('tiktok-publish', { claimedAt: iso(-INCOMPLETE_MS) });
	assert.equal(decide({ handle: old, probe: { state: 'incomplete' }, alive: true, now }).action, 'requeue');
});

test('a post the platform is finishing itself is left alone, alive or not', () => {
	assert.equal(decide({ handle: handle('tiktok-publish'), probe: { state: 'processing' }, alive: false, now }).action, 'leave');
});

test('a processed reel is published at its slot, with grace for a worker that may be alive', () => {
	const h = handle('instagram-container');
	const probe = { state: 'ready' };
	assert.equal(decide({ handle: h, probe, alive: false, now, slotAt: iso(60_000) }).action, 'leave');
	assert.equal(decide({ handle: h, probe, alive: false, now, slotAt: iso(0) }).action, 'publish');
	assert.equal(decide({ handle: h, probe, alive: true, now, slotAt: iso(-READY_GRACE_MS + 1000) }).action, 'leave');
	assert.equal(decide({ handle: h, probe, alive: true, now, slotAt: iso(-READY_GRACE_MS) }).action, 'publish');
});

test('an expired or failed upload is requeued with the reason', () => {
	const result = decide({ handle: handle('youtube-session'), probe: { state: 'gone', reason: 'expired' }, alive: true, now });
	assert.deepEqual(result, { action: 'requeue', reason: 'expired' });
});

test('a failed publish is failed at once when nothing reached the platform', () => {
	assert.equal(afterFailure({ handle: { run: 'r' }, probe: null, failedAt: now, now }).action, 'fail');
	assert.equal(afterFailure({ handle: null, probe: null, failedAt: now, now }).action, 'fail');
});

test('a failed publish the platform has after all is recorded', () => {
	const probe = { state: 'done', result: { url: 'https://example.com/reel/1/' } };
	assert.equal(afterFailure({ handle: handle('facebook-reel'), probe, failedAt: now, now }).action, 'finish');
	assert.equal(afterFailure({ handle: handle('youtube'), probe, failedAt: now - CONFIRM_MS * 2, now }).action, 'finish');
});

test('a failed publish the platform is still working on, or cannot be asked about, is waited on', () => {
	const processing = { state: 'processing' };
	const unknown = { state: 'unknown', reason: 'ETIMEDOUT' };
	assert.equal(afterFailure({ handle: handle('tiktok'), probe: processing, failedAt: now - 60_000, now }).action, 'wait');
	assert.equal(afterFailure({ handle: handle('tiktok'), probe: unknown, failedAt: now - 60_000, now }).action, 'wait');
	const late = afterFailure({ handle: handle('tiktok'), probe: unknown, failedAt: now - CONFIRM_MS, now });
	assert.equal(late.action, 'fail');
	assert.match(late.reason, /not confirmed/);
	assert.equal(afterFailure({ handle: handle('tiktok'), probe: processing, failedAt: now - CONFIRM_MS, now }).action, 'fail');
});

test("a reel Facebook was told to publish is not believed gone at once", () => {
	const gone = { state: 'gone', reason: 'Facebook no longer has the video' };
	const told = handle('facebook-reel', { finished: true });
	assert.equal(afterFailure({ handle: told, probe: gone, failedAt: now - 60_000, now }).action, 'wait');
	assert.equal(afterFailure({ handle: told, probe: gone, failedAt: now - GONE_GRACE_MS, now }).action, 'fail');
	assert.equal(afterFailure({ handle: handle('facebook-reel'), probe: gone, failedAt: now, now }).action, 'fail');
	assert.equal(afterFailure({ handle: handle('instagram'), probe: gone, failedAt: now, now }).action, 'fail');
});

test('a failed publish that never went out is failed', () => {
	for (const state of ['uploading', 'incomplete', 'ready']) {
		assert.equal(afterFailure({ handle: handle('instagram'), probe: { state }, failedAt: now, now }).action, 'fail');
	}
});
