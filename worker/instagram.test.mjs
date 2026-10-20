import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildContainer,
	checkGrant,
	freshContainerHelps,
	GraphError,
	INSTAGRAM_SCOPES,
	labelRefused,
	nextUploadPause
} from './instagram.mjs';

const granted = (names) => names.map((permission) => ({ permission, status: 'granted' }));
const names = (list) => list.map((p) => p.name);

test('a token with every permission lacks nothing', () => {
	const grant = checkGrant(granted([...INSTAGRAM_SCOPES, 'public_profile']));
	assert.deepEqual(grant.missing, []);
	assert.deepEqual(grant.optional, []);
});

test('a missing publish permission stops the setup; a missing cover permission only warns', () => {
	const grant = checkGrant(
		granted(INSTAGRAM_SCOPES.filter((s) => s !== 'instagram_content_publish' && s !== 'pages_manage_posts'))
	);
	assert.deepEqual(names(grant.missing), ['instagram_content_publish']);
	assert.deepEqual(names(grant.optional), ['pages_manage_posts']);
});

test('declined and expired permissions count as absent', () => {
	const rows = granted(INSTAGRAM_SCOPES).map((row) =>
		row.permission === 'instagram_basic'
			? { ...row, status: 'declined' }
			: row.permission === 'business_management'
				? { ...row, status: 'expired' }
				: row
	);
	const grant = checkGrant(rows);
	assert.deepEqual(names(grant.missing), ['instagram_basic']);
	assert.deepEqual(names(grant.optional), ['business_management']);
});

test('a token without insights can still post; only the views are lost', () => {
	const grant = checkGrant(granted(INSTAGRAM_SCOPES.filter((s) => s !== 'instagram_manage_insights')));
	assert.deepEqual(grant.missing, []);
	assert.deepEqual(names(grant.optional), ['instagram_manage_insights']);
});

test('no rows at all means every required permission is missing', () => {
	assert.equal(checkGrant(undefined).missing.length, 4);
});

test('a reel goes up resumable, with the caption and feed choice', () => {
	const params = buildContainer({ description: 'hello' }, { shareToFeed: false }, 30);
	assert.equal(params.media_type, 'REELS');
	assert.equal(params.upload_type, 'resumable');
	assert.equal(params.caption, 'hello');
	assert.equal(params.share_to_feed, false);
	assert.equal('cover_url' in params, false);
});

test('the cover time is milliseconds and stays inside the video', () => {
	assert.equal(buildContainer({}, { coverFrame: 2 }, 30).thumb_offset, 2000);
	assert.equal(buildContainer({}, { coverFrame: 40 }, 30).thumb_offset, 29_500);
	assert.equal('thumb_offset' in buildContainer({}, { coverFrame: 0 }, 30), false);
});

test('collaborators lose their @ and stop at three', () => {
	const params = buildContainer({}, { collaborators: ['@a', ' b ', '', 'c', 'd'] }, 0);
	assert.deepEqual(params.collaborators, ['a', 'b', 'c']);
});

test("rupload's processing failure gets a new container despite saying it is not retriable", () => {
	// Word for word what Meta answered on 13 and 15 Oct 2026.
	const answer = { debug_info: { retriable: false, type: 'ProcessingFailedError', message: 'Request processing failed' } };
	assert.equal(freshContainerHelps(answer), true);
});

test('any other refusal of the upload fails the reel as before', () => {
	assert.equal(freshContainerHelps({ error: { message: 'Invalid OAuth access token', code: 190 } }), false);
	assert.equal(freshContainerHelps({ debug_info: { type: 'SomethingElse' } }), false);
	assert.equal(freshContainerHelps({}), false);
	assert.equal(freshContainerHelps(undefined), false);
});

const MIN = 60_000;
const slot = '2026-10-20 16:00:00.000Z';
const at = (minutes) => Date.parse('2026-10-20T16:00:00Z') + minutes * MIN;

test('new containers wait 30 s, then 1 min, then 2 min each', () => {
	const pauses = [1, 2, 3, 4].map((attempt) => nextUploadPause({ attempt, slot, startedAt: at(-10), now: at(-8) }));
	assert.deepEqual(pauses, [30_000, MIN, 2 * MIN, 2 * MIN]);
});

test('tries go on past the slot and stop starting 15 minutes after it', () => {
	assert.equal(nextUploadPause({ attempt: 6, slot, startedAt: at(-10), now: at(12) }), 2 * MIN);
	assert.equal(nextUploadPause({ attempt: 7, slot, startedAt: at(-10), now: at(13) }), null);
});

test('a reel picked up after its slot (a late Retry) gets 15 minutes from then', () => {
	assert.equal(nextUploadPause({ attempt: 2, slot, startedAt: at(12), now: at(20) }), MIN);
	assert.equal(nextUploadPause({ attempt: 5, slot, startedAt: at(12), now: at(26) }), null);
});

test('refusals that come at once stop after twelve containers', () => {
	assert.equal(nextUploadPause({ attempt: 11, slot, startedAt: at(-10), now: at(-9) }), 2 * MIN);
	assert.equal(nextUploadPause({ attempt: 12, slot, startedAt: at(-10), now: at(-9) }), null);
});

test('a row without a slot counts from the start', () => {
	assert.equal(nextUploadPause({ attempt: 1, slot: '', startedAt: at(0), now: at(14) }), 30_000);
	assert.equal(nextUploadPause({ attempt: 1, slot: '', startedAt: at(0), now: at(15) }), null);
});

test('the Paid partnership tick puts the label on the container, and only then', () => {
	assert.equal(buildContainer({}, { paidPartnership: true }, 30).is_paid_partnership, true);
	assert.equal('is_paid_partnership' in buildContainer({}, { paidPartnership: false }, 30), false);
	assert.equal('is_paid_partnership' in buildContainer({}, {}, 30), false);
});

test('a refusal over the label is told apart from one over the reel', () => {
	const params = { is_paid_partnership: true };
	const label = new GraphError({ code: 100, message: 'Invalid parameter: is_paid_partnership is not available for this account' }, 400);
	const other = new GraphError({ code: 100, message: 'The video file is too short' }, 400);
	assert.equal(labelRefused(label, params), true);
	assert.equal(labelRefused(other, params), false);
	assert.equal(labelRefused(label, {}), false);
	assert.equal(labelRefused(new Error('branded content'), params), false);
});
