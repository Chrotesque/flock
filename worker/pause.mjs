/**
 * A pass that PocketBase answered with an error it cannot tell apart from a
 * missing field (a 400 on a filter naming it) pauses and asks again later,
 * rather than turning itself off for the whole run: on 23 Nov 2026 one
 * passing 400 left the Calendar's deletes unanswered for a day and a half.
 * A field that is really missing costs one line and a cheap read every pause.
 */
export const PAUSE_MS = 10 * 60 * 1000;

export function pauseState() {
	return { until: 0, said: false };
}

/** Whether the pass should sit this tick out. */
export function isPaused(state, now = Date.now()) {
	return state.until > now;
}

/** Pauses the pass; true the first time in a row, when it is worth a log line. */
export function pauseFor(state, now = Date.now(), ms = PAUSE_MS) {
	state.until = now + ms;
	if (state.said) return false;
	state.said = true;
	return true;
}

/** A read went through; true when the pass had been paused, so its return can be said. */
export function resume(state) {
	const was = state.said;
	state.until = 0;
	state.said = false;
	return was;
}
