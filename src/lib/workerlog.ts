/**
 * How a worker console line reads on the Log screen. The worker prints prose,
 * not levels, so this goes by its wording — the words it uses for "this did
 * not happen" (FAILED, refused, …) and for "this was left out on purpose"
 * (skipped, not found, …). A wrong guess costs a colour, nothing more.
 */
export type WorkerTone = 'fail' | 'skip' | 'done' | '';

const FAIL = /\bfail(ed|s)?\b|\brefused\b|\bcannot\b|\bcould not\b|\berror\b|^stopped:/i;
const SKIP = /\bskipped\b|\bnot found\b|\bleft out\b|\bnot set up\b|\bfalls? back\b/i;
const DONE = /^done\b|\bthumbnail set\b|\badded to playlist\b/i;

export function toneOf(message: string): WorkerTone {
	const text = message.trim();
	// A skip names why, often with 'cannot' or 'refused' in it; the video is
	// still up, so it reads as a skip rather than a failure.
	if (SKIP.test(text)) return 'skip';
	if (FAIL.test(text)) return 'fail';
	if (DONE.test(text)) return 'done';
	return '';
}

/** Indented lines are steps of the job above them; the depth is kept for display. */
export function depthOf(message: string): number {
	const lead = /^ */.exec(message)?.[0].length ?? 0;
	return Math.min(3, Math.floor(lead / 2));
}
