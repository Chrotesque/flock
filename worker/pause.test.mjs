import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAUSE_MS, isPaused, pauseFor, pauseState, resume } from './pause.mjs';

test('a fresh pass is not paused', () => {
	assert.equal(isPaused(pauseState(), 1000), false);
});

test('a pause holds for its length, then lets the pass try again', () => {
	const state = pauseState();
	pauseFor(state, 1000);
	assert.equal(isPaused(state, 1000 + PAUSE_MS - 1), true);
	assert.equal(isPaused(state, 1000 + PAUSE_MS), false);
});

test('only the first pause in a row asks for a log line', () => {
	const state = pauseState();
	assert.equal(pauseFor(state, 0), true);
	assert.equal(pauseFor(state, PAUSE_MS), false);
	assert.equal(resume(state), true);
	assert.equal(pauseFor(state, 2 * PAUSE_MS), true);
});

test('a read that goes through ends the pause, and says so only after one', () => {
	const state = pauseState();
	assert.equal(resume(state), false);
	pauseFor(state, 0);
	assert.equal(resume(state), true);
	assert.equal(isPaused(state, 1), false);
	assert.equal(resume(state), false);
});
