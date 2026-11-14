import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueWhileDraining, nextWatch } from './selfupdate.mjs';
import { makeHeartbeat } from './heartbeat.mjs';

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

describe('dueWhileDraining', () => {
	const now = Date.parse('2026-11-14T13:00:30Z');
	it('lets a post whose slot has come start, in PocketBase form or ISO', () => {
		assert.equal(dueWhileDraining('2026-11-14 13:00:00.000Z', now), true);
		assert.equal(dueWhileDraining('2026-11-14T13:00:30Z', now), true);
	});
	it('leaves a post not due yet, however close, to the new worker', () => {
		assert.equal(dueWhileDraining('2026-11-14 13:01:00.000Z', now), false);
	});
	it('counts an unreadable slot as not due', () => {
		assert.equal(dueWhileDraining('', now), false);
		assert.equal(dueWhileDraining(null, now), false);
	});
});

describe('a draining heartbeat', () => {
	it('stops new work but still allows a due post', () => {
		const hb = makeHeartbeat({ pb: {}, role: 'all', run: 'r', log: () => {}, live: false });
		assert.equal(hb.canPublish(), true);
		assert.equal(hb.draining(), false);
		hb.drain();
		hb.stop?.();
		assert.equal(hb.canPublish(), false);
		assert.equal(hb.canPublishDue(), true);
		assert.equal(hb.draining(), true);
		assert.equal(hb.canLocal(), false);
	});
	it('never lets a role that may not publish start a due post', () => {
		const hb = makeHeartbeat({ pb: {}, role: 'local', run: 'r', log: () => {}, live: false });
		hb.drain();
		hb.stop?.();
		assert.equal(hb.canPublishDue(), false);
	});
});
