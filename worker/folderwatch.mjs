// Watching folders for changes, so a scan follows a change within a second or
// two instead of waiting for the next poll — a flock.json saved into a
// project folder shows in the sidebar almost at once.
//
// The regular scan stays as the safety net: a watch can miss changes (a
// machine waking from sleep, a share that dropped, a NAS file system that
// reports patchily), and nobody would notice it had.

import { watch as fsWatch } from 'node:fs';

/**
 * Watches one set of folders per kind ('local', 'network') and calls
 * `onChange(kind)` once a burst of changes in that kind's folders has
 * settled: `quietMs` after the last change, or `maxWaitMs` after the first
 * while changes keep coming — a video being copied in — so a long copy is
 * still seen growing.
 *
 * Each folder is watched on its own, not recursively: a scan reads a project
 * folder and its subfolders and nothing deeper, and a recursive watch on
 * Linux would add a watch for every folder below, however many an editor's
 * project files bring along. A folder that cannot be watched (gone, a share
 * not mounted, a drive unplugged) is left out; the next `sync` tries again.
 * `watch` is for the tests.
 */
export function makeFolderWatcher({ onChange, quietMs = 1500, maxWaitMs = 10_000, watch = fsWatch }) {
	/** path → { kind, handle } */
	const watchers = new Map();
	/** kind → { first, timer }: a burst waiting to settle. */
	const pending = new Map();

	function fire(kind) {
		const burst = pending.get(kind);
		if (burst) clearTimeout(burst.timer);
		pending.delete(kind);
		onChange(kind);
	}

	function changed(kind) {
		const now = Date.now();
		const burst = pending.get(kind);
		const first = burst?.first ?? now;
		if (burst) clearTimeout(burst.timer);
		const wait = Math.max(0, Math.min(quietMs, first + maxWaitMs - now));
		pending.set(kind, { first, timer: setTimeout(() => fire(kind), wait) });
	}

	function drop(path) {
		const entry = watchers.get(path);
		if (!entry) return;
		watchers.delete(path);
		try {
			entry.handle.close();
		} catch {
			// Already closed.
		}
	}

	return {
		/** Makes a kind's watched folders exactly `paths`, closing the rest. */
		sync(kind, paths) {
			const wanted = new Set(paths.filter(Boolean));
			for (const [path, entry] of watchers) {
				if (entry.kind === kind && !wanted.has(path)) drop(path);
			}
			for (const path of wanted) {
				if (watchers.has(path)) continue;
				try {
					const handle = watch(path, { persistent: false }, () => changed(kind));
					// A watch that fails later (the folder deleted, the share gone) is
					// dropped, and set up again by a later sync if the folder is back.
					handle.on?.('error', () => drop(path));
					watchers.set(path, { kind, handle });
				} catch {
					// Not there (yet).
				}
			}
		},

		/** How many folders of a kind are watched. */
		count(kind) {
			let n = 0;
			for (const entry of watchers.values()) if (entry.kind === kind) n++;
			return n;
		},

		close() {
			for (const path of [...watchers.keys()]) drop(path);
			for (const burst of pending.values()) clearTimeout(burst.timer);
			pending.clear();
		}
	};
}
