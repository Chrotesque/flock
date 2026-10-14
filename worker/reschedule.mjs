/**
 * Moving a post whose release time the platform already holds — a YouTube
 * video private with `publishAt`, a reel Facebook holds for its time — when
 * the Calendar moves it (src/lib/reschedule.ts). The page writes only
 * `scheduled_at`. The worker keeps in the row's handle the time it handed
 * the platform (`release`); wherever the two differ it tells the platform
 * the new time and keeps that. A platform that refuses leaves the post where
 * it was: `scheduled_at` goes back to `release`, and the reason is kept as
 * `handle.moveError` for the Calendar to show.
 *
 * Instagram and TikTok posts are held by the worker itself until their
 * minute, so moving one is `scheduled_at` alone and needs nothing here; once
 * the worker has one in hand, the Calendar refuses to move it.
 *
 * What to do with a scheduled row, decided from the row as it is now:
 *
 * - `none`    nothing differs, or nothing here to move
 * - `learn`   no `release` yet (uploaded before this existed): ask the
 *             platform what it holds first
 * - `move`    tell the platform the new time
 * - `refuse`  the new time cannot be held: back to the old one, with why
 */

export const SYNC_PLATFORMS = ['youtube', 'facebook'];

/** Nearer than this, a new time is not handed over: Facebook wants 10 minutes, and either may be putting it out. */
export const SYNC_MIN_MS = 11 * 60_000;

/** Facebook holds a reel at most 29 days ahead. */
export const FACEBOOK_MAX_MS = 29 * 24 * 3_600_000;

/** An instant to the second, from PocketBase's or an ISO form; NaN when there is none. */
export function seconds(value) {
	const at = Date.parse(String(value ?? '').replace(' ', 'T'));
	return Number.isFinite(at) ? Math.floor(at / 1000) : NaN;
}

const NAMES = { youtube: 'YouTube', facebook: 'Facebook' };

export function rescheduleStep(row, { now = Date.now(), held = false } = {}) {
	if (!SYNC_PLATFORMS.includes(row?.platform) || row.status !== 'scheduled' || held || row.move || row.request) {
		return { action: 'none' };
	}
	const wanted = seconds(row.scheduled_at);
	const handle = row.handle && typeof row.handle === 'object' ? row.handle : {};
	if (handle.released) return { action: 'none' };
	if (!handle.release) return wanted * 1000 > now ? { action: 'learn' } : { action: 'none' };

	const release = seconds(handle.release);
	if (!Number.isFinite(wanted) || wanted === release) return { action: 'none' };
	const name = NAMES[row.platform];
	if (Number.isFinite(release) && release * 1000 <= now) {
		return { action: 'refuse', reason: `${name} has put it out already` };
	}
	if (wanted * 1000 - now < SYNC_MIN_MS) {
		return { action: 'refuse', reason: 'the new time was less than 11 minutes away by the time the worker got to it' };
	}
	if (row.platform === 'facebook' && wanted * 1000 - now > FACEBOOK_MAX_MS) {
		return { action: 'refuse', reason: 'Facebook holds a reel at most 29 days ahead' };
	}
	return { action: 'move', from: handle.release, to: new Date(wanted * 1000).toISOString() };
}

/**
 * The handle after a move: the new time kept, any old refusal gone — or,
 * refused, the reason and when.
 */
export function movedHandle(handle, release) {
	const { moveError: _error, moveErrorAt: _at, ...rest } = handle && typeof handle === 'object' ? handle : {};
	return { ...rest, release };
}

export function refusedHandle(handle, reason, now = new Date()) {
	return { ...(handle && typeof handle === 'object' ? handle : {}), moveError: reason, moveErrorAt: now.toISOString() };
}
