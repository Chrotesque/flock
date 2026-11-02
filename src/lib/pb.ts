import PocketBase, { BaseAuthStore } from 'pocketbase';
import { PUBLIC_POCKETBASE_URL } from '$env/static/public';
import { storedServer } from './server';

/**
 * flock talks to its OWN PocketBase instance (port 8091), not the one cortex
 * and its siblings share. Nothing here may assume cortex's collections exist.
 *
 * The app is local, single-user and deliberately unauthenticated, so the auth
 * store is memory-only — never localStorage.
 */
class MemoryAuthStore extends BaseAuthStore {}

/**
 * The copy built for flock's website (`pnpm build:site`, VITE_FLOCK_SITE=1)
 * is served by no PocketBase: it talks to the server this browser named
 * (server.ts), and until it has named one, nothing of flock starts.
 */
export const SITE_COPY = import.meta.env.VITE_FLOCK_SITE === '1';

// In production the SPA is served from PocketBase itself, so same-origin is
// the right default; in dev the NAS address comes from .env.
const url = SITE_COPY
	? storedServer()
	: PUBLIC_POCKETBASE_URL || (typeof window !== 'undefined' ? window.location.origin : '/');

/** The website's copy before this browser has named its server (ServerSetup asks). */
export const NEEDS_SERVER = SITE_COPY && !url;

export const pb = new PocketBase(url, new MemoryAuthStore());

// Realtime picks up what the worker writes as it writes it (the Dashboard's
// stats, the Calendar's moves, the To finish list). The auto-cancellation of overlapping requests is not
// wanted, since several panels load in parallel on mount.
pb.autoCancellation(false);

export const PB_URL = url;

/** URL of a stored video file, for the "already on the NAS" preview. */
export function fileUrl(record: { id: string; collectionId?: string }, filename: string): string {
	if (!filename) return '';
	return pb.files.getURL(record, filename);
}
