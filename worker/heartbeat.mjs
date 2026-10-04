// The worker's heartbeat, and the handover between a NAS and a PC worker.
//
// Every BEAT_MS the worker writes `app_settings` / `worker_<role>`: who it is,
// whether it is covering or waiting, and what it is doing right now. The
// sidebar reads those rows; the other worker reads them to decide who
// publishes. See roles.mjs for the rules themselves.

import { hostname } from 'node:os';
import {
	BEAT_MS,
	beatKey,
	coverDecision,
	isAlive,
	nasMayWork,
	ownsLocal,
	ownsPublishing
} from './roles.mjs';

/**
 * `live` is false for the one-shot modes, which write no heartbeat and simply
 * do what their role owns. `onStartPublishing` runs whenever this worker
 * takes up the publishing work — the NAS worker once the PC has handed it
 * over, the PC worker when it starts covering — and is where rows left
 * `publishing` by the other one are recovered.
 */
export function makeHeartbeat({ pb, role, run, log, live = true, onStartPublishing = async () => {} }) {
	const startedAt = new Date().toISOString();
	const tasks = new Map();
	let nextTask = 0;
	let publishingTasks = 0;

	// `waiting`: a NAS worker that has not been handed the work yet.
	// `covering` / `releasing`: a PC worker doing the NAS worker's work, and
	// winding it down once the NAS is back.
	let waiting = role === 'nas';
	let covering = false;
	let releasing = false;
	let beats = 0;
	let stopped = false;
	let beating = false;
	let timer = null;
	let soon = null;
	let lastError = '';
	const warned = new Set();

	function canPublish() {
		if (!live) return ownsPublishing(role);
		if (role === 'all') return true;
		if (role === 'nas') return !waiting;
		return covering && !releasing;
	}

	function payload() {
		return {
			role,
			run,
			pid: process.pid,
			host: hostname(),
			startedAt,
			beatAt: new Date().toISOString(),
			covering,
			waiting,
			doing: [...tasks.values()],
			...(stopped ? { stoppedAt: new Date().toISOString() } : {})
		};
	}

	async function read(key) {
		const row = await pb.getSetting(key);
		return row?.value ?? null;
	}

	async function write() {
		await pb.setSetting(beatKey(role), payload());
	}

	/** Says once, until it stops being true, that another worker overlaps this one. */
	function warnOnce(key, alive, message) {
		if (alive && !warned.has(key)) {
			warned.add(key);
			log(message);
		} else if (!alive) {
			warned.delete(key);
		}
	}

	async function decide() {
		const now = Date.now();

		if (role === 'all') {
			for (const other of ['nas', 'local']) {
				warnOnce(
					other,
					isAlive(await read(beatKey(other)), now),
					`warning: a "${other}" worker is running beside this "all" one — they will pick up the same work`
				);
			}
			return;
		}
		warnOnce(
			'all',
			isAlive(await read(beatKey('all')), now),
			'warning: an "all" worker is running beside this one — they will pick up the same work'
		);

		if (role === 'nas') {
			const may = nasMayWork(await read(beatKey('local')), now);
			// Never on the first beat: a PC worker that read our row as stale just
			// before it was written may be about to say it is covering.
			if (waiting && may && beats >= 2) {
				waiting = false;
				log('publishing here — the PC worker is not covering');
				await onStartPublishing();
			} else if (!waiting && !may) {
				waiting = true;
				log('the PC worker says it is covering — pausing publishing until it hands back');
			}
			return;
		}

		// role === 'local'
		const nasBeat = await read(beatKey('nas'));
		const decision = coverDecision({ covering, nasBeat, now });
		if (decision === 'start') {
			covering = true;
			releasing = false;
			await write();
			// Read again after saying so: a NAS worker that came up in the gap
			// sees our row and waits, and if it is already up we back out.
			if (isAlive(await read(beatKey('nas')), Date.now())) {
				covering = false;
				return;
			}
			log('the NAS worker is not running — covering its work here until it is back');
			await onStartPublishing();
		} else if (decision === 'release' && !releasing) {
			releasing = true;
			log('the NAS worker is back — finishing what is in hand, then handing over');
		}
		if (covering && releasing && publishingTasks === 0) {
			covering = false;
			releasing = false;
			log('handed the work back to the NAS worker');
		}
	}

	// One at a time: a beat asked for by a finishing task must not decide
	// alongside the timer's, or a takeover would be started twice.
	async function beat() {
		if (stopped || beating) return;
		beating = true;
		beats++;
		try {
			await decide();
			await write();
			lastError = '';
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message !== lastError) log(`heartbeat failed: ${message}`);
			lastError = message;
		} finally {
			beating = false;
		}
	}

	/** A beat shortly, so the sidebar follows a task starting or ending. */
	function beatSoon() {
		if (!live || stopped || soon) return;
		soon = setTimeout(() => {
			soon = null;
			void write().catch(() => {});
		}, 500);
	}

	return {
		role,
		canPublish,
		canLocal: () => ownsLocal(role),

		/**
		 * Runs `fn` as a named task: shown in the sidebar while it runs, and —
		 * for publishing work — counted, so a handover waits for it.
		 */
		async track(text, fn, { publishing = false, until } = {}) {
			const id = ++nextTask;
			tasks.set(id, until ? { text, until } : { text });
			if (publishing) publishingTasks++;
			beatSoon();
			try {
				return await fn();
			} finally {
				tasks.delete(id);
				if (publishing) publishingTasks--;
				// The last task of a handover is what lets it complete.
				if (live && releasing && publishingTasks === 0) void beat();
				else beatSoon();
			}
		},

		async start() {
			if (!live) return;
			const mine = await read(beatKey(role)).catch(() => null);
			if (isAlive(mine, Date.now()) && mine.run !== run) {
				log(
					`warning: another "${role}" worker seems to be running (pid ${mine.pid} on ${mine.host}) — ` +
						'two of the same role pick up the same work'
				);
			}
			await beat();
			timer = setInterval(() => void beat(), BEAT_MS);
		},

		/** The last beat, saying it stopped, so the dot goes red at once. */
		async stop() {
			if (!live || stopped) return;
			stopped = true;
			clearInterval(timer);
			clearTimeout(soon);
			await write().catch(() => {});
		}
	};
}
