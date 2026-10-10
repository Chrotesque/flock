import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer, checkGrant, INSTAGRAM_SCOPES } from './instagram.mjs';

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
