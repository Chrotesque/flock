// Which build of the worker this is, so the log and the sidebar can say which
// copy runs where — a PC worker is carried over by hand, and an old copy left
// running looks just like the new one otherwise. bundle-worker.mjs stamps it
// in from src/lib/version.ts; a run from the checkout has no stamp.

/* global __FLOCK_VERSION__ */
export const WORKER_VERSION = typeof __FLOCK_VERSION__ === 'string' ? __FLOCK_VERSION__ : 'dev';
