/**
 * Releasing a post at once, or deleting it, as the Calendar asked by writing
 * `request` on the row (src/lib/postactions.ts). The page does what touches
 * PocketBase alone itself — a post flock still holds has its time set to now
 * or its row deleted — and asks the worker only when a platform holds the
 * post for its time, because only the worker holds the tokens:
 *
 * - `publish` a YouTube video held private with `publishAt`: made public now
 * - `resend`  a reel Facebook holds: deleted there and queued again for now
 *             (Facebook will not take a time nearer than 10 minutes)
 * - `remove`  either, for a delete: deleted on the platform, then the row
 * - `now`     flock holds it after all: its time becomes now
 * - `forget`  flock holds it after all, for a delete: the row goes
 * - `wait`    being published right now: asked again on the next tick
 * - `drop`    nothing flock can do: the request is cleared, with why
 *
 * Decided from the row as it is now, not as it was when the page asked.
 */
import { facebookVideoId, youtubeVideoId } from './moves.mjs';

const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

/** A request as the page wrote it; null when there is none. */
export function readRequest(raw) {
	if (!raw || typeof raw !== 'object') return null;
	if (raw.kind !== 'release' && raw.kind !== 'delete') return null;
	const text = (key) => (typeof raw[key] === 'string' ? raw[key] : '');
	return { kind: raw.kind, requestedAt: text('requestedAt'), by: text('by') };
}

export function requestStep(row, { held = false } = {}) {
	const request = readRequest(row?.request);
	if (!request) return { action: 'none' };
	if (held || row.status === 'publishing') return { action: 'wait', request };
	const name = NAMES[row.platform] ?? row.platform;
	if (row.status === 'published') return { action: 'drop', request, reason: `it is out on ${name} already` };
	const onPlatform = row.status === 'scheduled' || Boolean(row.remote_url);
	if (!onPlatform) return { action: request.kind === 'delete' ? 'forget' : 'now', request };

	const remoteId =
		row.platform === 'youtube' ? youtubeVideoId(row.remote_url) : row.platform === 'facebook' ? facebookVideoId(row) : '';
	if (row.platform !== 'youtube' && row.platform !== 'facebook') {
		return { action: 'drop', request, reason: `flock cannot change a ${name} post once ${name} has it` };
	}
	if (!remoteId) return { action: 'drop', request, reason: `its ${name} link names no video` };
	if (request.kind === 'delete') return { action: 'remove', request, remoteId };
	return { action: row.platform === 'youtube' ? 'publish' : 'resend', request, remoteId };
}
