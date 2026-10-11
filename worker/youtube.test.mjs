import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShortVideo, isoSeconds, processingState, scopeCanEdit, studioUrl } from './youtube.mjs';

const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE = 'https://www.googleapis.com/auth/youtube';

test('the default grant cannot edit, although every scope contains "youtube"', () => {
	assert.equal(scopeCanEdit(`${READONLY} ${UPLOAD}`), false);
});

test('the --with-playlists grant can edit', () => {
	assert.equal(scopeCanEdit(`${UPLOAD} ${READONLY} ${YOUTUBE}`), true);
	assert.equal(scopeCanEdit('https://www.googleapis.com/auth/youtube.force-ssl'), true);
});

test('a grant that says nothing about its scopes is unknown, not upload-only', () => {
	assert.equal(scopeCanEdit(undefined), null);
	assert.equal(scopeCanEdit(''), null);
	assert.equal(scopeCanEdit('   '), null);
});

test('processing is done only once YouTube has its own thumbnails too', () => {
	assert.equal(processingState({ processingStatus: 'succeeded', thumbnailsAvailability: 'available' }), 'done');
	assert.equal(processingState({ processingStatus: 'succeeded', thumbnailsAvailability: 'inProgress' }), 'wait');
	assert.equal(processingState({ processingStatus: 'processing', thumbnailsAvailability: 'available' }), 'wait');
});

test('a reading without processing details yet means wait', () => {
	assert.equal(processingState(undefined), 'wait');
	assert.equal(processingState({}), 'wait');
});

test('failed and terminated processing stop the wait', () => {
	assert.equal(processingState({ processingStatus: 'failed' }), 'failed');
	assert.equal(processingState({ processingStatus: 'terminated' }), 'failed');
});

test('a video length reads out of ISO 8601 as YouTube gives it', () => {
	assert.equal(isoSeconds('PT30S'), 30);
	assert.equal(isoSeconds('PT2M58S'), 178);
	assert.equal(isoSeconds('PT1H2M3S'), 3723);
	assert.equal(isoSeconds('P1DT1S'), 86401);
	assert.equal(isoSeconds('P0D'), 0);
	assert.equal(isoSeconds(''), null);
	assert.equal(isoSeconds('PT'), null);
	assert.equal(isoSeconds(undefined), null);
});

test('a Short is up to three minutes, and unknown without a length', () => {
	assert.equal(isShortVideo(30), true);
	assert.equal(isShortVideo(180), true);
	assert.equal(isShortVideo(181), false);
	assert.equal(isShortVideo(null), null);
	assert.equal(isShortVideo(0), null);
});

test('the Studio link opens the video’s edit page', () => {
	assert.equal(studioUrl('LTk4d1CwGQE'), 'https://studio.youtube.com/video/LTk4d1CwGQE/edit');
});
