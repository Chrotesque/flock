import PocketBase, { BaseAuthStore } from 'pocketbase';
import { PUBLIC_POCKETBASE_URL } from '$env/static/public';

/**
 * flock talks to its OWN PocketBase instance (port 8091), not the one cortex
 * and its siblings share. Nothing here may assume cortex's collections exist.
 *
 * The app is local, single-user and deliberately unauthenticated, so the auth
 * store is memory-only — never localStorage.
 */
class MemoryAuthStore extends BaseAuthStore {}

// In production the SPA is served from PocketBase itself, so same-origin is
// the right default; in dev the NAS address comes from .env.
const url =
	PUBLIC_POCKETBASE_URL || (typeof window !== 'undefined' ? window.location.origin : '/');

export const pb = new PocketBase(url, new MemoryAuthStore());

// Realtime is unused; the auto-cancellation of overlapping requests is not
// wanted either, since several panels load in parallel on mount.
pb.autoCancellation(false);

export const PB_URL = url;

/** URL of a stored video file, for the "already on the NAS" preview. */
export function fileUrl(record: { id: string; collectionId?: string }, filename: string): string {
	if (!filename) return '';
	return pb.files.getURL(record, filename);
}
