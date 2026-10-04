import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRole, isAlive, coverDecision, nasMayWork, STALE_MS, TAKEOVER_MS } from './roles.mjs';

const now = Date.parse('2026-10-04T12:00:00Z');
const ago = (ms, extra = {}) => ({ beatAt: new Date(now - ms).toISOString(), ...extra });

test('parseRole defaults to all and refuses anything else', () => {
	assert.equal(parseRole(undefined), 'all');
	assert.equal(parseRole(''), 'all');
	assert.equal(parseRole(' NAS '), 'nas');
	assert.throws(() => parseRole('cloud'), /Unknown worker role/);
});

test('a heartbeat is alive inside the stale window only', () => {
	assert.equal(isAlive(ago(1000), now), true);
	assert.equal(isAlive(ago(STALE_MS + 1), now), false);
	assert.equal(isAlive(null, now), false);
	assert.equal(isAlive({ beatAt: 'nonsense' }, now), false);
});

test('a worker that said it stopped is down at once', () => {
	assert.equal(isAlive(ago(1000, { stoppedAt: ago(1000).beatAt }), now), false);
});

test('the PC covers only once the NAS has been quiet for the takeover window', () => {
	assert.equal(coverDecision({ covering: false, nasBeat: ago(STALE_MS + 1000), now }), 'stay');
	assert.equal(coverDecision({ covering: false, nasBeat: ago(TAKEOVER_MS + 1000), now }), 'start');
	assert.equal(coverDecision({ covering: false, nasBeat: null, now }), 'start');
});

test('the PC hands back as soon as the NAS is alive again', () => {
	assert.equal(coverDecision({ covering: true, nasBeat: ago(1000), now }), 'release');
	assert.equal(coverDecision({ covering: true, nasBeat: ago(TAKEOVER_MS + 1000), now }), 'stay');
});

test('the NAS waits while a live PC worker covers', () => {
	assert.equal(nasMayWork(ago(1000, { covering: true }), now), false);
	assert.equal(nasMayWork(ago(1000, { covering: false }), now), true);
	// A PC that died while covering is not waited for.
	assert.equal(nasMayWork(ago(STALE_MS + 1000, { covering: true }), now), true);
	assert.equal(nasMayWork(null, now), true);
});
