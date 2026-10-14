import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionWithTitle, readTitleRequest, sameTitle, snippetPatch } from './retitle.mjs';

const ask = (over = {}) => ({ platform: 'youtube', video_id: 'Ab3dE6gH9jK', account: 'UC1', title: 'Owls at dusk', ...over });

test('a rename reads field by field, on one line', () => {
	assert.deepEqual(readTitleRequest(ask()), { platform: 'youtube', videoId: 'Ab3dE6gH9jK', account: 'UC1', title: 'Owls at dusk' });
	assert.equal(readTitleRequest(ask({ title: '  Owls\n at dusk ' })).title, 'Owls at dusk');
	assert.equal(readTitleRequest(ask({ account: undefined })).account, '');
});

test('Instagram, TikTok, an empty name or no video are refused', () => {
	assert.match(readTitleRequest(ask({ platform: 'instagram' })).error, /cannot rename a post on Instagram/);
	assert.match(readTitleRequest(ask({ platform: 'tiktok' })).error, /TikTok/);
	assert.match(readTitleRequest(ask({ title: ' \n ' })).error, /empty/);
	assert.match(readTitleRequest(ask({ video_id: '' })).error, /names no video/);
});

test("YouTube's own rules: 100 characters, no angle brackets", () => {
	assert.match(readTitleRequest(ask({ title: 'x'.repeat(101) })).error, /100 characters/);
	assert.equal(readTitleRequest(ask({ title: 'x'.repeat(100) })).title.length, 100);
	assert.match(readTitleRequest(ask({ title: 'Owls <3' })).error, /< or >/);
	// Facebook has neither rule.
	assert.equal(readTitleRequest(ask({ platform: 'facebook', title: 'Owls <3' })).title, 'Owls <3');
});

test('the snippet goes back whole, with only the title new', () => {
	const read = {
		title: 'Old',
		description: 'About owls',
		tags: ['owls'],
		categoryId: '15',
		defaultLanguage: 'en',
		defaultAudioLanguage: 'en-US',
		thumbnails: { default: { url: 'x' } },
		channelId: 'UC1',
		publishedAt: '2026-10-01T10:00:00Z'
	};
	assert.deepEqual(snippetPatch(read, 'New'), {
		title: 'New',
		description: 'About owls',
		tags: ['owls'],
		categoryId: '15',
		defaultLanguage: 'en',
		defaultAudioLanguage: 'en-US'
	});
	assert.deepEqual(snippetPatch({ categoryId: '22' }, 'New'), { categoryId: '22', title: 'New' });
});

test("a caption's title line is replaced, every other line kept", () => {
	assert.equal(captionWithTitle('Owls at dusk\n\nThey hoot.\n#owls #shorts', 'Owls at night'), 'Owls at night\n\nThey hoot.\n#owls #shorts');
	// The line the Dashboard shows: past an ad notice and any hashtag run.
	assert.equal(captionWithTitle('Werbung\n#owls\nOwls at dusk\nMore', 'New'), 'Werbung\n#owls\nNew\nMore');
	assert.equal(captionWithTitle('Old\r\nMore', 'New'), 'New\nMore');
});

test('a caption with no title line gets one under its ad notice', () => {
	assert.equal(captionWithTitle('', 'New'), 'New');
	assert.equal(captionWithTitle('#owls #shorts', 'New'), 'New\n#owls #shorts');
	assert.equal(captionWithTitle('[Werbung]\n#owls', 'New'), '[Werbung]\nNew\n#owls');
});

test('titles compare without their spacing', () => {
	assert.ok(sameTitle('Owls  at dusk ', 'Owls at dusk'));
	assert.ok(!sameTitle('Owls', 'owls'));
});
