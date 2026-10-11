import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextWatch } from './selfupdate.mjs';

const v = (mtimeMs, size = 100) => ({ mtimeMs, size });

/** Runs a sequence of looks and says after which one (1-based) it was ready, or 0. */
function readyAfter(looks) {
	let state = { base: null, pending: null, ready: false };
	for (const [i, seen] of looks.entries()) {
		state = nextWatch(state, seen);
		if (state.ready) return i + 1;
	}
	return 0;
}

describe('nextWatch', () => {
	it('stays put while the file does not change', () => {
		assert.equal(readyAfter([v(1), v(1), v(1), v(1)]), 0);
	});

	it('is ready on the second look that agrees on a new version', () => {
		assert.equal(readyAfter([v(1), v(2), v(2)]), 3);
	});

	it('waits out a copy still being written', () => {
		assert.equal(readyAfter([v(1), v(2, 10), v(3, 50), v(4, 100), v(4, 100)]), 5);
	});

	it('does not count a file missing mid-replace', () => {
		assert.equal(readyAfter([v(1), null, null, v(2), null, v(2), v(2)]), 7);
	});

	it('ignores a change that is undone before it settles', () => {
		assert.equal(readyAfter([v(1), v(2), v(1), v(1)]), 0);
	});

	it('tells a new file by its size as well as its time', () => {
		assert.equal(readyAfter([v(1, 100), v(1, 200), v(1, 200)]), 3);
	});

	it('is not ready when the worker starts with the file missing', () => {
		assert.equal(readyAfter([null, null]), 0);
	});
});
