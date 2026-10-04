// Rows left `publishing` by a worker that is no longer handling them.
//
// Before a worker sends a single byte it records the platform's own handle on
// the upload in the row's `handle` (YouTube's session address, TikTok's
// publish id, Instagram's container id), and it does not start unless that
// write succeeded. So for any row another worker left mid-publish, the
// platform can be asked how far it got, and the answer decides what happens
// to the row — instead of uploading it again blind.
//
// The case this exists for: a NAS worker cut off from PocketBase but still
// uploading. Its heartbeat looks the same as a NAS that is switched off, so
// only the platform can tell them apart. A row whose claimer may still be
// running (`mayBeAlive`: a NAS row, seen by a PC worker covering for it) is
// requeued only once the platform shows the upload has stopped; a row left by
// a run that is certainly over is requeued as soon as its upload is not done.

/** A YouTube session whose byte count has not moved for this long has stopped. */
export const STALL_MS = 3 * 60_000;

/**
 * A TikTok or Instagram upload that is still incomplete this long after the
 * claim has stopped: neither reports bytes, and TikTok's upload address lasts
 * about an hour.
 */
export const INCOMPLETE_MS = 90 * 60_000;

/** How long past its slot a processed reel is left for its own worker to publish. */
export const READY_GRACE_MS = 2 * 60_000;

/**
 * Whether the run that claimed a row may still be at work on it. Only a NAS
 * row seen by a PC worker: a handover waits for the PC's own work to end, and
 * one worker per role means an earlier run of the same role is over.
 */
export function mayBeAlive(handle, role) {
	return role === 'local' && handle?.role === 'nas';
}

/**
 * What to do with an orphaned row, from what the platform said (`probe`, or
 * null when the row has no platform handle yet) and what was seen of it last
 * time (`seen`: `{ bytes, at }` for a YouTube session).
 *
 * Returns `{ action, reason?, seen? }`, where action is `finish` (the upload
 * completed — record it), `publish` (a processed reel nobody published),
 * `requeue` (start again) or `leave` (ask again next pass). `seen` is what to
 * remember for the next pass.
 */
export function decide({ handle, probe, alive, now, slotAt, seen }) {
	if (!handle?.kind || !probe) {
		return { action: 'requeue', reason: 'nothing had been sent to the platform yet' };
	}

	switch (probe.state) {
		case 'done':
			return { action: 'finish' };
		case 'gone':
			return { action: 'requeue', reason: probe.reason };
		case 'processing':
			// The bytes are up and the platform is finishing the post itself.
			return { action: 'leave', reason: 'the platform is still processing it' };
		case 'ready': {
			const slot = Date.parse(slotAt);
			const due = Number.isFinite(slot) ? slot + (alive ? READY_GRACE_MS : 0) : now;
			return now >= due
				? { action: 'publish' }
				: { action: 'leave', reason: 'processed and waiting for its slot' };
		}
		case 'uploading': {
			if (!alive) return { action: 'requeue', reason: 'its upload stopped part-way' };
			if (!seen || seen.bytes !== probe.bytes) {
				return { action: 'leave', reason: 'still uploading', seen: { bytes: probe.bytes, at: now } };
			}
			return now - seen.at >= STALL_MS
				? { action: 'requeue', reason: `its upload stopped at ${probe.bytes} bytes` }
				: { action: 'leave', reason: 'still uploading', seen };
		}
		case 'incomplete': {
			if (!alive) return { action: 'requeue', reason: 'its upload stopped part-way' };
			const claimed = Date.parse(handle.claimedAt);
			return Number.isFinite(claimed) && now - claimed >= INCOMPLETE_MS
				? { action: 'requeue', reason: 'its upload never completed' }
				: { action: 'leave', reason: 'may still be uploading' };
		}
		default:
			return { action: 'leave', reason: `unknown platform state ${probe.state}` };
	}
}
