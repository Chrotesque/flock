// Which upload the worker is busy with, for the Log's upload overview.
//
// Everything printed while one job is handled — the claim, an adapter's
// steps, the result — is tagged with that job's id in worker_log, and the
// worker's activity_log rows likewise, so the overview can list exactly the
// lines that belong to one upload. AsyncLocalStorage carries the id through
// every await of that work without passing it to each adapter, and keeps the
// slot lanes, which run side by side, apart.

import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();

/** Runs `fn` with `job` as the current upload; anything it prints is tagged. */
export function inJob(job, fn) {
	return job ? scope.run(job, fn) : fn();
}

/** The upload being handled here, or '' outside one. */
export function currentJob() {
	return scope.getStore() ?? '';
}
