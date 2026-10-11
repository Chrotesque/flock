// Restarting on a new worker file, for a worker in a container.
//
// `pnpm deploy:worker` copies a fresh bundle beside the running one. With
// FLOCK_RESTART_ON_UPDATE=1 — set only in the container, whose restart policy
// brings it back — the worker notices, starts nothing new, finishes what it
// holds and exits, and comes back up on the new code. Without the variable
// nothing watches: a worker run by hand that quit on its own would simply be
// gone.

import { stat } from 'node:fs/promises';

/**
 * The watch, one look at a time. `base` is the file as the worker started
 * with it; a change counts once two looks in a row agree on it, so a copy
 * still being written — or a file briefly missing mid-replace — never starts
 * a restart on half a program.
 */
export function nextWatch(state, seen) {
	const same = (a, b) => a.mtimeMs === b.mtimeMs && a.size === b.size;
	if (!seen) return { ...state, pending: null, ready: false };
	if (!state.base) return { base: seen, pending: null, ready: false };
	if (same(seen, state.base)) return { ...state, pending: null, ready: false };
	if (state.pending && same(seen, state.pending)) return { ...state, ready: true };
	return { ...state, pending: seen, ready: false };
}

/** Looks at `file` every `everyMs` and calls `onReady` once, when a new version has settled. */
export function watchForUpdate({ file, everyMs = 10_000, onReady, look = stat }) {
	let state = { base: null, pending: null, ready: false };
	let done = false;
	const tick = async () => {
		if (done) return;
		const seen = await look(file).then(
			(info) => ({ mtimeMs: info.mtimeMs, size: info.size }),
			() => null
		);
		state = nextWatch(state, seen);
		if (state.ready) {
			done = true;
			clearInterval(timer);
			onReady();
		}
	};
	const timer = setInterval(() => void tick(), everyMs);
	void tick();
	return () => {
		done = true;
		clearInterval(timer);
	};
}
