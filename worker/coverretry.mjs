// A reel's cover, tried for up to five minutes (the user's call, 20 Oct
// 2026, after a reel went out without its cover over one failed connection
// to Meta). A step that fails on the network, or on an answer worth asking
// again (`retryable`), is tried again after a pause growing to a minute;
// anything else, or the five minutes gone, gives up. The post then goes out
// without the cover and carries a warning starting with COVER_MISSING, which
// To finish lists under Needs attention (src/lib/attention.ts reads the same
// words — keep the two in step).

import { sleep as realSleep } from './upload.mjs';

export const COVER_RETRY_MS = 5 * 60_000;
const COVER_PAUSES_MS = [10_000, 20_000, 30_000, 60_000];
/** A last pause shorter than this is not worth a try. */
const MIN_PAUSE_MS = 5_000;

/** The start of the warning a post carries when it went out without its cover. */
export const COVER_MISSING = 'Cover not set:';

/**
 * The pause after try `attempt` (1-based) failed, cut short so the last try
 * starts at COVER_RETRY_MS from `startedAt`, or null once less than
 * MIN_PAUSE_MS is left. Milliseconds.
 */
export function nextCoverPause(attempt, startedAt, now) {
	const left = startedAt + COVER_RETRY_MS - now;
	if (left < MIN_PAUSE_MS) return null;
	return Math.min(COVER_PAUSES_MS[Math.min(attempt, COVER_PAUSES_MS.length) - 1], left);
}

const firstLine = (err) => String(err?.message ?? err).split('\n')[0];

/**
 * Runs `step` until it works, `retryable(err)` says not to ask again, or the
 * time is up. Resolves `{ value, attempts }`, or `{ error, attempts, ms }`
 * when it gave up; never throws.
 */
export async function withCoverRetries(step, { retryable, log, sleep = realSleep, now = Date.now }) {
	const startedAt = now();
	for (let attempt = 1; ; attempt += 1) {
		try {
			return { value: await step(), attempts: attempt };
		} catch (error) {
			const pause = retryable(error) ? nextCoverPause(attempt, startedAt, now()) : null;
			if (pause === null) return { error, attempts: attempt, ms: now() - startedAt };
			log(`cover: ${firstLine(error)} — trying again in ${Math.round(pause / 1000)}s`);
			await sleep(pause);
		}
	}
}

/** How long it was tried, for the warning: '' after a single try. */
export function triedFor({ attempts, ms }) {
	if (!(attempts > 1)) return '';
	const minutes = Math.max(1, Math.round(ms / 60_000));
	return ` (gave up after ${attempts} tries over ${minutes} min)`;
}
