// What the worker prints, mirrored into PocketBase's `worker_log` so the Log
// screen can show it. The console stays the primary output; this is a copy
// that must never slow the worker down or take it down, so lines are queued
// and written in the background, and a PocketBase that cannot take them only
// costs the copy.

/** A top-level line seen again within this long is not written again. */
export const REPEAT_WINDOW_MS = 60 * 60_000;

/** Lines older than this are pruned. Unlike activity_log this is a console, not an audit trail. */
export const KEEP_MS = 14 * 24 * 60 * 60_000;

/** Held while PocketBase is unreachable; past it the oldest go. */
const QUEUE_MAX = 2000;
const FLUSH_MS = 1000;
const PRUNE_EVERY_MS = 60 * 60_000;
const MESSAGE_MAX = 1900;

/**
 * Decides whether a line is worth writing.
 *
 * The watch-folder pass prints the same line every poll, which would bury
 * everything else; a line identical to one written within the window is
 * skipped, so a changed count still gets through. Indented lines belong to a
 * job in progress (an upload's percentages, a thumbnail step) and are always
 * written — two uploads in an hour both print "  10%".
 */
export function makeRepeatFilter(windowMs = REPEAT_WINDOW_MS, now = Date.now) {
	const seen = new Map();
	return (message) => {
		if (/^\s/.test(message)) return true;
		const at = now();
		const last = seen.get(message);
		if (last !== undefined && at - last < windowMs) return false;
		seen.set(message, at);
		if (seen.size > 500) {
			for (const [key, when] of seen) if (at - when >= windowMs) seen.delete(key);
		}
		return true;
	};
}

/**
 * Strips anything token-shaped. Nothing logged today carries one, but error
 * text is often a platform's response or a URL echoed back, and the
 * collection is readable by anyone who can open flock.
 */
export function redact(message) {
	return message
		.replace(/((?:access|refresh)_token=)[^&\s"']+/gi, '$1…')
		.replace(/("(?:access|refresh)_token"\s*:\s*")[^"]+/gi, '$1…')
		.replace(/\b(Bearer|OAuth) [A-Za-z0-9._~+/=-]{8,}/g, '$1 …');
}

/**
 * The queue. `push` may be called before PocketBase is known — the startup
 * retries are worth seeing too — and `attach` starts the writing once it is.
 * `flush` drains what is queued, for the one-shot modes to call before exit.
 */
export function makeRemoteLog({ run, warn = (m) => console.error(m) } = {}) {
	const keep = makeRepeatFilter();
	const queue = [];
	let pb = null;
	let timer = null;
	let draining = null;
	let dead = false;
	let failing = false;
	let prunedAt = 0;

	function schedule() {
		if (timer || !pb || dead) return;
		timer = setTimeout(() => {
			timer = null;
			void drain();
		}, FLUSH_MS);
		timer.unref?.();
	}

	async function drain() {
		if (draining) return draining;
		draining = (async () => {
			while (pb && !dead && queue.length > 0) {
				try {
					await pb.appendWorkerLog({ message: queue[0], run });
					queue.shift();
					if (failing) failing = false;
				} catch (err) {
					const text = err instanceof Error ? err.message : String(err);
					// No collection means setup-pb has not been run on this
					// PocketBase; retrying every second would only fill the console.
					if (/-> 404/.test(text)) {
						dead = true;
						queue.length = 0;
						warn('worker log: no worker_log collection in PocketBase (run pnpm setup-pb) — the Log screen will not show the worker');
						return;
					}
					if (!failing) warn(`worker log: cannot write to PocketBase, holding lines (${text.split('\n')[0]})`);
					failing = true;
					return;
				}
			}
			if (pb && !dead && Date.now() - prunedAt > PRUNE_EVERY_MS) {
				prunedAt = Date.now();
				await pb.pruneWorkerLog(new Date(Date.now() - KEEP_MS)).catch(() => {});
			}
		})().finally(() => {
			draining = null;
			if (queue.length > 0) schedule();
		});
		return draining;
	}

	return {
		push(message) {
			if (dead || !keep(message)) return;
			queue.push(redact(message).slice(0, MESSAGE_MAX));
			if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
			schedule();
		},
		attach(client) {
			pb = client;
			schedule();
		},
		async flush() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			await drain();
		}
	};
}
