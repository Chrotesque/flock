import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRequest, requestStep } from './requests.mjs';

const ask = (kind) => ({ kind, requestedAt: '2026-10-15T08:00:00.000Z', by: 'Studio PC' });
const row = (over = {}) => ({
	id: 'r1',
	platform: 'youtube',
	status: 'scheduled',
	remote_url: 'https://www.youtube.com/shorts/Ab3dE6gH9jK',
	handle: {},
	request: ask('release'),
	...over
});

test('a request reads field by field; anything else is none', () => {
	assert.deepEqual(readRequest(ask('delete')), ask('delete'));
	assert.equal(readRequest({ kind: 'explode' }), null);
	assert.equal(readRequest(null), null);
	assert.deepEqual(requestStep(row({ request: null })), { action: 'none' });
});

test('a YouTube video held for its time is made public now, or deleted', () => {
	assert.deepEqual(requestStep(row()), { action: 'publish', request: ask('release'), remoteId: 'Ab3dE6gH9jK' });
	assert.equal(requestStep(row({ request: ask('delete') })).action, 'remove');
});

test('a reel Facebook holds is sent again for now, or deleted', () => {
	const reel = { platform: 'facebook', remote_url: 'https://www.facebook.com/reel/2229/', handle: { videoId: '2229' } };
	assert.deepEqual(requestStep(row(reel)), { action: 'resend', request: ask('release'), remoteId: '2229' });
	assert.equal(requestStep(row({ ...reel, request: ask('delete') })).action, 'remove');
});

test('a post flock still holds is its own: its time becomes now, or its row goes', () => {
	assert.equal(requestStep(row({ status: 'pending', remote_url: '' })).action, 'now');
	assert.equal(requestStep(row({ status: 'failed', remote_url: '', request: ask('delete') })).action, 'forget');
});

test('a post in hand waits; one out already, or with no video named, is dropped', () => {
	assert.equal(requestStep(row({ status: 'publishing' })).action, 'wait');
	assert.equal(requestStep(row(), { held: true }).action, 'wait');
	assert.match(requestStep(row({ status: 'published' })).reason, /out on YouTube/);
	assert.match(requestStep(row({ remote_url: 'https://www.youtube.com/' })).reason, /names no video/);
	assert.match(requestStep(row({ platform: 'instagram', remote_url: 'https://www.instagram.com/reel/x/' })).reason, /cannot change/);
});
