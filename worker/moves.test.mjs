import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facebookVideoId, moveStep, readMove, requeuePatch, youtubeVideoId } from './moves.mjs';

const move = { to: 'new', toName: '@new', from: 'old', brand: 'b', brandName: 'Paper Moon' };
const row = (platform, status, extra = {}) => ({ id: 'r', platform, status, account: 'old', remote_url: '', move, ...extra });

test('a row with no move has nothing to do', () => {
	assert.equal(moveStep(row('youtube', 'pending', { move: null })).action, 'none');
	assert.equal(moveStep({ platform: 'youtube', status: 'pending' }).action, 'none');
});

test('a post with nothing on the platform just changes account', () => {
	assert.equal(moveStep(row('instagram', 'pending')).action, 'switch');
	assert.equal(moveStep(row('facebook', 'failed')).action, 'switch');
	assert.equal(moveStep(row('youtube', 'cancelled')).action, 'switch');
});

test('a YouTube video or Facebook reel on the old account is replaced', () => {
	const yt = moveStep(row('youtube', 'scheduled', { remote_url: 'https://www.youtube.com/watch?v=Ab3_dEf-9hZ' }));
	assert.deepEqual([yt.action, yt.remoteId], ['replace', 'Ab3_dEf-9hZ']);
	const fb = moveStep(row('facebook', 'scheduled', { handle: { videoId: '1234567890123456' } }));
	assert.deepEqual([fb.action, fb.remoteId], ['replace', '1234567890123456']);
	const live = moveStep(row('youtube', 'published', { remote_url: 'https://youtu.be/Ab3_dEf-9hZ' }));
	assert.equal(live.action, 'replace');
});

test('a live Instagram reel is posted again, never deleted', () => {
	assert.equal(moveStep(row('instagram', 'published', { remote_url: 'https://www.instagram.com/reel/x/' })).action, 'repost');
});

test('a row being published waits, held here or not', () => {
	assert.equal(moveStep(row('youtube', 'publishing')).action, 'wait');
	assert.equal(moveStep(row('instagram', 'pending'), { held: true }).action, 'wait');
});

test('nothing to do, or nothing flock can do, drops the request', () => {
	assert.equal(moveStep(row('youtube', 'scheduled', { account: 'new' })).action, 'drop');
	assert.equal(moveStep(row('tiktok', 'pending')).action, 'drop');
	assert.equal(moveStep(row('youtube', 'pending', { move: { to: '' } })).action, 'drop');
	assert.equal(moveStep(row('youtube', 'scheduled', { remote_url: 'https://example.com' })).action, 'drop');
	assert.equal(moveStep(row('facebook', 'published', { remote_url: 'https://www.facebook.com/' })).action, 'drop');
});

test('a held post already on the new account is dropped, not waited for', () => {
	assert.equal(moveStep(row('instagram', 'publishing', { account: 'new' }), { held: true }).action, 'drop');
});

test('video ids come out of every link shape', () => {
	assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=Ab3_dEf-9hZ&t=3'), 'Ab3_dEf-9hZ');
	assert.equal(youtubeVideoId('https://www.youtube.com/shorts/Ab3_dEf-9hZ'), 'Ab3_dEf-9hZ');
	assert.equal(youtubeVideoId('https://youtu.be/Ab3_dEf-9hZ'), 'Ab3_dEf-9hZ');
	assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=short'), '');
	assert.equal(youtubeVideoId(undefined), '');
	assert.equal(facebookVideoId({ remote_url: 'https://www.facebook.com/reel/1234567890123456/' }), '1234567890123456');
	assert.equal(facebookVideoId({ remote_url: 'https://www.facebook.com/Page/videos/123/' }), '123');
	assert.equal(facebookVideoId({ handle: { videoId: 9 }, remote_url: '' }), '9');
	assert.equal(facebookVideoId(null), '');
});

test('a move reads back with a brand name to say', () => {
	assert.equal(readMove({ to: 'x' }).brandName, 'another brand');
	assert.equal(readMove(null), null);
	assert.equal(readMove('nope'), null);
});

test('queueing again clears everything of the old attempt', () => {
	assert.deepEqual(requeuePatch('new'), {
		account: 'new',
		status: 'pending',
		remote_url: '',
		handle: null,
		error: '',
		published_at: '',
		move: null
	});
});
