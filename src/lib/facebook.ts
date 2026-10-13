/**
 * What Facebook refuses for a reel, said on the Review step before anything
 * is sent (worker/facebook.mjs refuses the same). Only the length: a reel on
 * a Page has no audience or options to get wrong, and its time is held by
 * Facebook itself — the worker uploads it up to four weeks ahead.
 */

/** The Reels Publishing API's limits on a reel's length, in seconds. */
export const FACEBOOK_REEL_SECONDS = { min: 3, max: 90 } as const;

function length(seconds: number): string {
	const s = Math.round(seconds);
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

/** Why Facebook would not take this video as a reel; empty when it would, or when its length is not known yet. */
export function facebookProblems(durationSeconds: number): string[] {
	if (!(durationSeconds > 0)) return [];
	const { min, max } = FACEBOOK_REEL_SECONDS;
	if (durationSeconds > max + 0.5) {
		return [`Facebook takes reels of up to ${max} seconds; this video runs ${length(durationSeconds)}. Give Facebook a shorter cut of its own, or untick it.`];
	}
	if (durationSeconds < min) {
		return [`Facebook takes reels of at least ${min} seconds; this video runs ${length(durationSeconds)}.`];
	}
	return [];
}
