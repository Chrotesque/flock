// Which worker does what, when there are two.
//
// A worker's `role` splits the work between a worker on the NAS and one on
// the PC. `all` is the default and does everything, exactly as a single worker
// always has — it is what a setup without a NAS runs. `nas` publishes, files
// videos into their destinations, keeps the stats and answers scoring; `local`
// does what only the PC can: its own folders, the folder dialog and the
// previews.
//
// Each running worker writes a heartbeat to `app_settings` under
// `worker_<role>`, which is also what the sidebar reads. When the NAS worker's
// heartbeat goes quiet, a `local` worker covers its work until it is back,
// then hands it over: it stops starting new work, finishes what it holds, and
// only then clears `covering`. The NAS worker waits for that before it starts,
// so the two never publish at the same time.

export const ROLES = ['all', 'nas', 'local'];

/** How often a heartbeat is written, and how old one may be and still count. */
export const BEAT_MS = 15_000;
export const STALE_MS = 45_000;

/** How long the NAS worker must be quiet before the PC takes its work over. */
export const TAKEOVER_MS = 60_000;

export function parseRole(value) {
	const role = String(value ?? '').trim().toLowerCase() || 'all';
	if (!ROLES.includes(role)) {
		throw new Error(`Unknown worker role "${value}" — expected one of: ${ROLES.join(', ')}`);
	}
	return role;
}

export function beatKey(role) {
	return `worker_${role}`;
}

/**
 * Whether a heartbeat shows a worker that is up now. One that said it was
 * stopping is down at once rather than after the stale window.
 */
export function isAlive(beat, now, within = STALE_MS) {
	if (!beat || typeof beat.beatAt !== 'string' || beat.stoppedAt) return false;
	const at = Date.parse(beat.beatAt);
	return Number.isFinite(at) && now - at < within;
}

/** Whether this role publishes, files and keeps stats in its own right. */
export function ownsPublishing(role) {
	return role === 'all' || role === 'nas';
}

/** Whether this role reads the PC's folders, opens the dialog and serves previews. */
export function ownsLocal(role) {
	return role === 'all' || role === 'local';
}

/**
 * What a `local` worker should do about the NAS worker's work, given the NAS
 * heartbeat. `start` covering once the NAS has been quiet for TAKEOVER_MS;
 * `release` once it is back while covering; otherwise `stay` as it is.
 */
export function coverDecision({ covering, nasBeat, now }) {
	if (!covering) return isAlive(nasBeat, now, TAKEOVER_MS) ? 'stay' : 'start';
	return isAlive(nasBeat, now) ? 'release' : 'stay';
}

/**
 * Whether a `nas` worker may do its work, given the PC's heartbeat: not while
 * a live PC worker still says it is covering.
 */
export function nasMayWork(localBeat, now) {
	return !(isAlive(localBeat, now) && localBeat.covering);
}
