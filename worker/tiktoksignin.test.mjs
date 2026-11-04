import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	ASK_MAX_AGE_MS,
	OPEN_MAX_AGE_MS,
	heldByOther,
	pageRedirect,
	pkcePair,
	signinStep,
	signinUrl
} from './tiktoksignin.mjs';

const now = Date.parse('2026-11-04T12:00:00Z');
const iso = (ms) => new Date(now + ms).toISOString();

test("a page redirect is flock's own return page, over https or loopback", () => {
	assert.equal(
		pageRedirect('https://flock.example.com/app/connect/tiktok'),
		'https://flock.example.com/app/connect/tiktok'
	);
	assert.equal(pageRedirect('https://flock.example.com/connect/tiktok'), 'https://flock.example.com/connect/tiktok');
	assert.equal(pageRedirect('http://localhost:5273/connect/tiktok'), 'http://localhost:5273/connect/tiktok');
	assert.equal(pageRedirect('http://192.0.2.10:8091/connect/tiktok'), '');
	assert.equal(pageRedirect('https://evil.example.com/steal'), '');
	assert.equal(pageRedirect('https://flock.example.com/connect/tiktok?x=1'), '');
	assert.equal(pageRedirect(''), '');
	assert.equal(pageRedirect(undefined), '');
});

test('the PKCE challenge is the hex SHA-256 of the verifier', () => {
	const { verifier, challenge } = pkcePair();
	assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
	assert.equal(challenge, createHash('sha256').update(verifier).digest('hex'));
});

test("the consent address carries the key, scopes, return page, state and challenge", () => {
	const url = new URL(
		signinUrl({
			clientKey: 'key',
			scopes: ['user.info.basic', 'video.list'],
			redirectUri: 'https://flock.example.com/app/connect/tiktok',
			state: 'abc',
			challenge: 'c0ffee'
		})
	);
	assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
	assert.equal(url.searchParams.get('client_key'), 'key');
	assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.list');
	assert.equal(url.searchParams.get('response_type'), 'code');
	assert.equal(url.searchParams.get('redirect_uri'), 'https://flock.example.com/app/connect/tiktok');
	assert.equal(url.searchParams.get('state'), 'abc');
	assert.equal(url.searchParams.get('code_challenge'), 'c0ffee');
	assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('the demo holds sign-ins only while its claim is fresh and not ours', () => {
	assert.equal(heldByOther({ run: 'demo', until: iso(10_000) }, 'nas', now), true);
	assert.equal(heldByOther({ run: 'demo', until: iso(-1) }, 'nas', now), false);
	assert.equal(heldByOther({ run: 'demo', until: '' }, 'nas', now), false);
	assert.equal(heldByOther({ run: 'nas', until: iso(10_000) }, 'nas', now), false);
	assert.equal(heldByOther(null, 'nas', now), false);
});

test('what a worker does with the sign-in row', () => {
	const held = new Map([['a', {}]]);
	const step = (ask, extra = {}) => signinStep(ask, { run: 'me', held, now, ...extra });

	assert.equal(step(null), 'skip');
	assert.equal(step({ id: 'a', status: 'pending', requestedAt: iso(-1000) }), 'start');
	assert.equal(step({ id: 'a', status: 'pending', requestedAt: iso(-ASK_MAX_AGE_MS - 1) }), 'expire');
	assert.equal(step({ id: 'a', status: 'pending', requestedAt: iso(-1000) }, { hostOther: true }), 'skip');

	// Only the run that opened a sign-in carries it on.
	assert.equal(step({ id: 'a', status: 'code', answeredBy: 'other' }), 'skip');
	assert.equal(step({ id: 'a', status: 'open', answeredBy: 'me', openedAt: iso(-1000) }), 'skip');
	assert.equal(step({ id: 'a', status: 'open', answeredBy: 'me', openedAt: iso(-OPEN_MAX_AGE_MS - 1) }), 'expire');
	assert.equal(step({ id: 'a', status: 'code', answeredBy: 'me' }), 'exchange');
	assert.equal(step({ id: 'b', status: 'code', answeredBy: 'me' }), 'lost');
	assert.equal(step({ id: 'a', status: 'returned', answeredBy: 'me' }), 'refused');
	assert.equal(step({ id: 'a', status: 'done', answeredBy: 'me' }), 'skip');
	assert.equal(step({ id: 'a', status: 'failed', answeredBy: 'me' }), 'skip');
});
