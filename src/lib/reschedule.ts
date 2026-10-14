import { PLATFORMS } from './platforms';
import type { PlatformId, UploadTarget } from './types';

/**
 * Moving a post in the Calendar: what may be picked up, where it may land,
 * and how a move the platform has to be told of stands.
 *
 * Who holds the release time decides. A post still `pending` is flock's
 * alone — moving it changes `scheduled_at` and the worker sends it at the
 * new time. A YouTube video or Facebook reel already uploaded is held by the
 * platform (`scheduled`): the page still writes only `scheduled_at`, and the
 * worker tells the platform (worker/reschedule.mjs), keeping the time it
 * handed over as `handle.release` — until the two agree the post is moving.
 * Anything the worker has in hand, or a platform will put out any moment,
 * stays where it is: the Calendar shakes it and says why.
 */

/** A new time is at least this far ahead. */
export const MOVE_MARGIN_MS = 15 * 60_000;

/** The platforms that hold a time themselves once uploaded; the worker tells them of a move. */
export const SYNCED: readonly PlatformId[] = ['youtube', 'facebook'];

/**
 * How long before its slot the worker takes up a post it holds itself
 * (worker: Instagram's ten-minute lead, TikTok none), plus a minute: from
 * then on a new time would not reach it.
 */
const TAKEN_UP_MS: Partial<Record<PlatformId, number>> = { instagram: 11 * 60_000, tiktok: 60_000 };

/** How far ahead the worker hands a reel to Facebook; Facebook's own limit is 29 days. */
const FACEBOOK_MAX_MS = 28 * 24 * 3_600_000;

/** A refusal shown at the post, not an error. */
export class MoveRefused extends Error {}

export type MovablePost = Pick<UploadTarget, 'platform' | 'status' | 'scheduled_at'> & { handle?: unknown; request?: unknown };

interface Held {
	release?: string;
	released?: boolean;
	moveError?: string;
	moveErrorAt?: string;
}

function held(post: MovablePost): Held {
	const h = post.handle;
	return h && typeof h === 'object' ? (h as Held) : {};
}

function instant(value: string | undefined): number {
	const at = Date.parse(String(value ?? '').replace(' ', 'T'));
	return Number.isFinite(at) ? at : NaN;
}

/** Why a post cannot be picked up right now; '' when it can. */
export function lockReason(post: MovablePost, now = Date.now()): string {
	const name = PLATFORMS[post.platform]?.label ?? post.platform;
	const slot = instant(post.scheduled_at);
	// A release or delete asked for (postactions.ts) is under way.
	if (post.request && typeof post.request === 'object') return 'The worker is on it already.';
	switch (post.status) {
		case 'cancelled':
			return 'It was cancelled.';
		case 'published':
			return `It is out on ${name} already.`;
		case 'publishing':
			return SYNCED.includes(post.platform)
				? `It is being uploaded to ${name} right now.`
				: `The worker has it ready for its minute; ${name} takes it as it is.`;
		case 'failed':
			// Moved, a retry sends it at the new time.
			return '';
		case 'scheduled':
			if (!SYNCED.includes(post.platform)) return `${name} has it.`;
			if (held(post).released) return `${name} has put it out already.`;
			if (!(slot - now >= MOVE_MARGIN_MS)) return `${name} puts it out within 15 minutes.`;
			return '';
		default: {
			if (!(slot > now)) return 'Its time has passed; the worker is sending it.';
			const taken = TAKEN_UP_MS[post.platform];
			if (taken && slot - now <= taken) return `The worker takes it up for ${name} any moment now.`;
			return '';
		}
	}
}

/** Why a post cannot go to `at`; '' when it can. */
export function landReason(post: MovablePost, at: Date, now = Date.now()): string {
	const when = at.getTime();
	if (!(when - now >= MOVE_MARGIN_MS)) return 'At least 15 minutes from now.';
	if (post.platform === 'facebook' && post.status === 'scheduled' && when - now > FACEBOOK_MAX_MS) {
		return 'Facebook holds a reel at most 28 days ahead.';
	}
	return '';
}

/** Moved in flock and not yet on the platform: the worker is telling it. */
export function isMoving(post: MovablePost): boolean {
	if (post.status !== 'scheduled' || !SYNCED.includes(post.platform)) return false;
	const release = held(post).release;
	if (!release) return false;
	return Math.floor(instant(release) / 1000) !== Math.floor(instant(post.scheduled_at) / 1000);
}

/** Why the platform last refused a new time, for a day after. */
export function moveRefusal(post: MovablePost, now = Date.now()): string {
	const h = held(post);
	if (!h.moveError) return '';
	const at = instant(h.moveErrorAt);
	return Number.isFinite(at) && now - at > 86_400_000 ? '' : h.moveError;
}
