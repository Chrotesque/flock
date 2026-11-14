// Uploading Instagram reels hours ahead of their slot.
//
// Meta's resumable upload refuses containers in streaks — on some days most
// of them, for minutes or hours (`ProcessingFailedError`, see instagram.mjs).
// A container, once processed, keeps for 24 hours and is published by a
// separate quick call, so the worker prepares each reel early: from
// PREPARE_MS before its slot it uploads into a container, trying again with
// growing pauses for up to RETRY_MS, and records the processed container on
// the row as `handle.prep`. The publish at the slot then needs no upload.
//
// The row stays `pending` the whole time, so the page treats it as flock's
// own: it can be moved, edited, released or deleted as before. A move only
// changes when it is published. Anything that changes what Instagram would
// show — caption, options, cover, video or account — changes the
// fingerprint, and the reel is prepared again.
//
// The numbers are the user's (14 Nov 2026): start 14 hours ahead, give up
// after 12 hours of refusals, which leaves two hours to look into it.

import { createHash } from 'node:crypto';

/** How long before its slot a reel is prepared. */
export const PREPARE_MS = 14 * 3_600_000;
/** How long a reel's upload is tried before the post fails. */
export const RETRY_MS = 12 * 3_600_000;
/**
 * The oldest a prepared container may be when it is published: Instagram
 * keeps one for 24 hours, and an hour is kept in hand.
 */
export const CONTAINER_MAX_MS = 23 * 3_600_000;
/** Pauses between tries, the last repeated. */
export const PREP_PAUSES_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

/** The pause after try number `tries` (1-based) failed. */
export function prepPause(tries) {
	return PREP_PAUSES_MS[Math.min(Math.max(1, tries), PREP_PAUSES_MS.length) - 1];
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/**
 * What a prepared container was made from: the container's parameters
 * (caption, feed, cover frame, collaborators…), the account, the cover image
 * and the video. The time is left out on purpose — a move changes only when
 * the container is published.
 */
export function prepFingerprint({ params, account, job }) {
	const made = { ...params };
	delete made.upload_type;
	delete made.cover_url;
	return createHash('sha1')
		.update(
			canonical({
				params: made,
				account: String(account ?? ''),
				cover: String(job?.cover ?? ''),
				video: String(job?.video || job?.source_path || ''),
				size: Number(job?.video_size) || 0
			})
		)
		.digest('hex');
}

/** The row's preparation, or null. */
export function prepOf(handle) {
	const prep = handle && typeof handle === 'object' ? handle.prep : null;
	return prep && typeof prep === 'object' ? prep : null;
}

function instant(value) {
	const at = Date.parse(String(value ?? '').replace(' ', 'T'));
	return Number.isFinite(at) ? at : NaN;
}

/**
 * Whether a prepared container can be published for this row as it is now:
 * processed, made from what the row holds (`fingerprint`), and young enough
 * at the later of its slot and now.
 */
export function prepUsable(prep, { fingerprint, slot, now }) {
	if (!prep || prep.state !== 'ready' || !prep.containerId) return false;
	if (prep.fingerprint !== fingerprint) return false;
	const made = instant(prep.madeAt);
	if (!Number.isFinite(made)) return false;
	const publishAt = Math.max(instant(slot) || now, now);
	return publishAt - made < CONTAINER_MAX_MS;
}

/** Ready by its own record — the cheap test before the full one at the claim. */
export function prepLooksReady(handle) {
	const prep = prepOf(handle);
	return Boolean(prep && prep.state === 'ready' && prep.containerId);
}

/**
 * What the preparing pass does with a pending row on this tick:
 * - `wait`: nothing yet — too early, or its next try is not due;
 * - `start`: begin a fresh preparation (none yet, or the post changed, or the
 *   container would be too old by its slot) and try at once;
 * - `try`: the next try of the preparation under way;
 * - `fail`: it has been tried for RETRY_MS; the post fails;
 * - `ready`: prepared and usable, nothing to do.
 */
export function prepStep({ handle, fingerprint, slot, now }) {
	const at = instant(slot);
	if (Number.isFinite(at) && at - now > PREPARE_MS) return { action: 'wait' };
	const prep = prepOf(handle);
	if (prepUsable(prep, { fingerprint, slot, now })) return { action: 'ready' };
	if (!prep || prep.fingerprint !== fingerprint || prep.state === 'ready') {
		return {
			action: 'start',
			reason: !prep
				? ''
				: prep.fingerprint !== fingerprint
					? 'the post changed since it was uploaded'
					: 'the uploaded reel would be too old by its slot'
		};
	}
	const since = instant(prep.since);
	if (Number.isFinite(since) && now - since >= RETRY_MS) return { action: 'fail' };
	const next = instant(prep.nextTryAt);
	if (Number.isFinite(next) && next > now) return { action: 'wait' };
	return { action: 'try' };
}

/** A fresh preparation, written before its first try. */
export function freshPrep({ fingerprint, account, now }) {
	const at = new Date(now).toISOString();
	return { fingerprint, account: String(account ?? ''), since: at, tries: 0, nextTryAt: at, state: 'trying' };
}

/** The preparation after a refused try. */
export function refusedPrep(prep, { error, now }) {
	const tries = (Number(prep.tries) || 0) + 1;
	return {
		...prep,
		tries,
		state: 'trying',
		containerId: '',
		lastError: String(error ?? '').split('\n')[0].slice(0, 300),
		lastTryAt: new Date(now).toISOString(),
		nextTryAt: new Date(now + prepPause(tries)).toISOString()
	};
}

/** The preparation once its container is processed. */
export function readyPrep(prep, { containerId, notes, now }) {
	const at = new Date(now).toISOString();
	return {
		...prep,
		tries: (Number(prep.tries) || 0) + 1,
		state: 'ready',
		containerId: String(containerId),
		madeAt: at,
		lastTryAt: at,
		lastError: '',
		...(notes?.length ? { notes } : {})
	};
}

/** The failure written when a preparation runs out of time. */
export function giveUpText(prep) {
	const hours = Math.round(RETRY_MS / 3_600_000);
	const tries = Number(prep?.tries) || 0;
	const last = prep?.lastError ? ` Last answer: ${prep.lastError}` : '';
	return `Instagram refused the upload for ${hours} hours (${tries} container${tries === 1 ? '' : 's'}); nothing was posted.${last}`;
}
