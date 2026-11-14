import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CONTAINER_MAX_MS,
	PREPARE_MS,
	RETRY_MS,
	freshPrep,
	giveUpText,
	prepFingerprint,
	prepLooksReady,
	prepPause,
	prepStep,
	prepUsable,
	readyPrep,
	refusedPrep
} from './igprep.mjs';

const H = 3_600_000;
const now = Date.parse('2026-11-14T08:00:00Z');
const slotIn = (ms) => new Date(now + ms).toISOString();
const job = { cover: 'cover_a.jpg', source_path: '\\\\nas\\in\\a.mp4', video_size: 1000 };
const params = { media_type: 'REELS', upload_type: 'resumable', caption: 'hello', share_to_feed: true };
const fp = prepFingerprint({ params, account: 'ig1', job });

test('the fingerprint follows what Instagram would show, not the time or the upload route', () => {
	assert.equal(prepFingerprint({ params: { ...params, upload_type: 'x', cover_url: 'https://cdn/x' }, account: 'ig1', job }), fp);
	assert.equal(prepFingerprint({ params: { share_to_feed: true, caption: 'hello', media_type: 'REELS' }, account: 'ig1', job }), fp, 'key order');
	assert.notEqual(prepFingerprint({ params: { ...params, caption: 'hello!' }, account: 'ig1', job }), fp, 'caption');
	assert.notEqual(prepFingerprint({ params: { ...params, share_to_feed: false }, account: 'ig1', job }), fp, 'option');
	assert.notEqual(prepFingerprint({ params, account: 'ig2', job }), fp, 'account');
	assert.notEqual(prepFingerprint({ params, account: 'ig1', job: { ...job, cover: 'cover_b.jpg' } }), fp, 'cover');
	assert.notEqual(prepFingerprint({ params, account: 'ig1', job: { ...job, video_size: 2000 } }), fp, 'video');
});

test('nothing is prepared more than 14 hours ahead', () => {
	assert.deepEqual(prepStep({ handle: null, fingerprint: fp, slot: slotIn(PREPARE_MS + 60_000), now }), { action: 'wait' });
	assert.equal(prepStep({ handle: null, fingerprint: fp, slot: slotIn(PREPARE_MS - 60_000), now }).action, 'start');
	// A post queued after its slot (a release, a retry) starts at once.
	assert.equal(prepStep({ handle: null, fingerprint: fp, slot: slotIn(-H), now }).action, 'start');
});

test('a refused try waits its pause, then tries again, until twelve hours have passed', () => {
	const fresh = freshPrep({ fingerprint: fp, account: 'ig1', now });
	assert.equal(prepStep({ handle: { prep: fresh }, fingerprint: fp, slot: slotIn(10 * H), now }).action, 'try');
	const refused = refusedPrep(fresh, { error: 'Instagram refused the upload (400)\nmore', now });
	assert.equal(refused.tries, 1);
	assert.equal(refused.lastError, 'Instagram refused the upload (400)');
	assert.equal(Date.parse(refused.nextTryAt) - now, prepPause(1));
	assert.equal(prepStep({ handle: { prep: refused }, fingerprint: fp, slot: slotIn(10 * H), now: now + 10_000 }).action, 'wait');
	assert.equal(prepStep({ handle: { prep: refused }, fingerprint: fp, slot: slotIn(10 * H), now: now + prepPause(1) }).action, 'try');
	assert.equal(prepStep({ handle: { prep: refused }, fingerprint: fp, slot: slotIn(10 * H), now: now + RETRY_MS }).action, 'fail');
	assert.match(giveUpText(refused), /12 hours \(1 container\).*Last answer: Instagram refused/);
});

test('pauses grow to ten minutes and stay there', () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6, 40].map(prepPause), [30_000, 60_000, 120_000, 300_000, 600_000, 600_000, 600_000]);
});

test('a ready container is used while it matches the post and is young enough at its slot', () => {
	const ready = readyPrep(freshPrep({ fingerprint: fp, account: 'ig1', now }), { containerId: 'c1', notes: [], now });
	assert.equal(ready.state, 'ready');
	assert.equal(ready.tries, 1);
	assert.ok(prepLooksReady({ prep: ready }));
	assert.ok(prepUsable(ready, { fingerprint: fp, slot: slotIn(14 * H), now }));
	assert.equal(prepStep({ handle: { prep: ready }, fingerprint: fp, slot: slotIn(14 * H), now }).action, 'ready');
	// Edited since: uploaded again.
	const edited = prepStep({ handle: { prep: ready }, fingerprint: 'other', slot: slotIn(H), now });
	assert.deepEqual(edited, { action: 'start', reason: 'the post changed since it was uploaded' });
	assert.ok(!prepUsable(ready, { fingerprint: 'other', slot: slotIn(H), now }));
	// Moved later than Instagram keeps a container: uploaded again once in range.
	const late = slotIn(CONTAINER_MAX_MS + H);
	assert.ok(!prepUsable(ready, { fingerprint: fp, slot: late, now: now + CONTAINER_MAX_MS - PREPARE_MS + 2 * H }));
	assert.equal(
		prepStep({ handle: { prep: ready }, fingerprint: fp, slot: late, now: now + CONTAINER_MAX_MS - PREPARE_MS + 2 * H }).reason,
		'the uploaded reel would be too old by its slot'
	);
	// Past its slot, the container's age counts to now.
	assert.ok(prepUsable(ready, { fingerprint: fp, slot: slotIn(-H), now: now + 2 * H }));
	assert.ok(!prepUsable(ready, { fingerprint: fp, slot: slotIn(-H), now: now + CONTAINER_MAX_MS }));
});

test('a try in flight is not ready, and an edit mid-try starts afresh', () => {
	const trying = { ...freshPrep({ fingerprint: fp, account: 'ig1', now }), state: 'uploading', containerId: 'c9' };
	assert.ok(!prepLooksReady({ prep: trying }));
	assert.ok(!prepUsable(trying, { fingerprint: fp, slot: slotIn(H), now }));
	assert.equal(prepStep({ handle: { prep: trying }, fingerprint: 'edited', slot: slotIn(H), now }).action, 'start');
});
