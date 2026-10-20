import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectReason, describeNetworkError, errorText, isNetworkError } from './net.mjs';

// What node:https hands back when every address of a host fails: an
// AggregateError with an empty message, the reasons inside.
const bothFailed = () => {
	const v4 = Object.assign(new Error('connect ETIMEDOUT 203.0.113.5:443'), {
		code: 'ETIMEDOUT',
		address: '203.0.113.5'
	});
	const v6 = Object.assign(new Error('connect ENETUNREACH 2001:db8::2:443'), {
		code: 'ENETUNREACH',
		address: '2001:db8::2'
	});
	return Object.assign(new AggregateError([v4, v6]), { code: 'ETIMEDOUT' });
};

test('a connection that failed on every address names each one and why', () => {
	assert.equal(connectReason(bothFailed()), 'ETIMEDOUT 203.0.113.5, ENETUNREACH 2001:db8::2');
});

test('a single failure is its code, or its message without one', () => {
	assert.equal(connectReason(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), 'ECONNRESET');
	assert.equal(connectReason(new Error('socket hang up')), 'socket hang up');
	// A DOMException's numeric code (20) says less than its message.
	assert.equal(connectReason(new DOMException('This operation was aborted', 'AbortError')), 'This operation was aborted');
	assert.equal(connectReason({}), '');
});

test('an https failure reads as the host and the reasons, never as ""', () => {
	const err = describeNetworkError('https://rupload.facebook.com/ig-api-upload/v23.0/123?x=1', bothFailed());
	assert.equal(
		err.message,
		'Cannot reach https://rupload.facebook.com (ETIMEDOUT 203.0.113.5, ENETUNREACH 2001:db8::2)'
	);
	assert.equal(isNetworkError(err), true);
});

test("fetch's bare \"fetch failed\" reads by its cause, as before", () => {
	const err = describeNetworkError('https://graph.facebook.com/v23.0/me', new TypeError('fetch failed', { cause: bothFailed() }));
	assert.equal(err.message, 'Cannot reach https://graph.facebook.com (ETIMEDOUT 203.0.113.5, ENETUNREACH 2001:db8::2)');
	const plain = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
	assert.equal(describeNetworkError('http://192.0.2.10:8091/api', plain).message, 'Cannot reach http://192.0.2.10:8091 (ECONNREFUSED)');
});

test('errorText falls back to the reason when the message is empty', () => {
	assert.equal(errorText(bothFailed()), 'ETIMEDOUT 203.0.113.5, ENETUNREACH 2001:db8::2');
	assert.equal(errorText(new Error('Instagram refused the upload (400)')), 'Instagram refused the upload (400)');
	assert.equal(errorText(new Error('')), 'Error');
	assert.equal(errorText('plain words'), 'plain words');
});
