import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from './instagram.mjs';

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
