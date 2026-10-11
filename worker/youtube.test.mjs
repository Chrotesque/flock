import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processingState, scopeCanEdit } from './youtube.mjs';

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
