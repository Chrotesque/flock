// What a task in hand reports while it runs: how far an upload has got and
// which try it is on. The heartbeat (heartbeat.mjs) runs each tracked task
// inside this scope, and an adapter calls `taskProgress` / `taskTries`
// wherever it already knows — no adapter has to be handed the task. Outside
// a tracked task both do nothing, so the one-shot modes and tests are
// unaffected. The page shows them in To finish's Worker section.

import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();

/** Runs `fn` with `task` (a heartbeat task) as the one reporting, `touch` called on each report. */
export function inTask(task, touch, fn) {
	return scope.run({ task, touch }, fn);
}

/** The share sent, 0–100, of the current task's upload. */
export function taskProgress(pct) {
	const here = scope.getStore();
	if (!here) return;
	const value = Math.max(0, Math.min(100, Math.round(pct)));
	if (here.task.progress === value) return;
	here.task.progress = value;
	here.touch();
}

/** The try the current task is on, and the most it will make (0 when there is no fixed most). */
export function taskTries(n, max = 0) {
	const here = scope.getStore();
	if (!here) return;
	here.task.tries = { n, max };
	// A new try starts its upload from nothing.
	delete here.task.progress;
	here.touch();
}
