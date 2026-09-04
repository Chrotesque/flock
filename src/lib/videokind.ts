import type { VideoStats } from './types';

/**
 * The kinds the Analytics screen sorts a channel into, in display order.
 *
 * The rules are deliberately by duration rather than by YouTube's own Shorts
 * test (a request to youtube.com/shorts/<id> answers 200 for a Short and
 * redirects for anything else). That test is definitive but lives outside
 * the API; the duration rule is what was asked for, and `other` exists to
 * show what slips through it — a video of exactly three minutes, or one whose
 * length is not known yet.
 */
export type VideoKind = 'short' | 'long' | 'live' | 'other';

export const KIND_ORDER: VideoKind[] = ['short', 'long', 'live', 'other'];

export const KIND_LABELS: Record<VideoKind, string> = {
	short: 'Shorts',
	long: 'Long form',
	live: 'Live streams',
	other: 'Other'
};

/** Shorts are under this; long form is over it. Exactly this is `other`. */
export const SHORT_MAX_SECONDS = 180;

/**
 * Live wins outright: a stream's VOD can be any length, and YouTube marks it
 * by the presence of streaming details rather than by anything in the
 * duration. Everything else is split on the three-minute line.
 */
export function kindOf(video: { duration: number; live: boolean }): VideoKind {
	if (video.live) return 'live';
	const seconds = Number(video.duration);
	if (!(seconds > 0)) return 'other';
	if (seconds < SHORT_MAX_SECONDS) return 'short';
	if (seconds > SHORT_MAX_SECONDS) return 'long';
	return 'other';
}

/** Whether YouTube reports this as a broadcast — current, upcoming or past. */
export function isLive(data: VideoStats['data'] | undefined): boolean {
	const details = data?.liveStreamingDetails;
	return Boolean(details && Object.keys(details).length > 0);
}

export function kindOfVideo(row: VideoStats): VideoKind {
	return kindOf({ duration: row.duration, live: isLive(row.data) });
}
