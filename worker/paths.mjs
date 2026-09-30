// Making a path typed on one machine usable on another.
//
// Folders are typed into Settings from a Windows browser, so they arrive as UNC
// paths like \\nas\videos\incoming. The worker is meant to end up in a
// container on the NAS itself, where that same folder is /mnt/user/videos/...
// Rather than making the user maintain two sets of paths, or hard-coding which
// machine the worker is on, resolution is by trial: use what works.

import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * The Linux form of a UNC path, if it looks like one.
 *
 * \\nas\videos\Testing -> /mnt/user/videos/Testing
 *
 * The share name maps to a top-level folder under /mnt/user, which is how
 * Unraid exposes shares. Returns null for anything that is not a UNC path.
 */
export function uncToUnraid(input) {
	const match = /^\\\\[^\\]+\\([^\\]+)(?:\\(.*))?$/.exec(input.trim());
	if (!match) return null;
	const [, share, rest = ''] = match;
	const tail = rest.replace(/\\/g, '/');
	return `/mnt/user/${share}${tail ? `/${tail}` : ''}`;
}

async function reachable(path) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Picks whichever form of a configured folder actually exists here.
 *
 * Tries the path as written first, so a worker on Windows keeps using the UNC
 * path directly. Falls back to the Unraid translation, which is what a worker
 * inside a container on the NAS will need. Returns the original if neither
 * resolves, so the caller's own error names the path the user actually typed.
 */
export async function resolveFolder(configured) {
	const path = (configured || '').trim();
	if (!path) return '';
	if (await reachable(path)) return path;

	const translated = uncToUnraid(path);
	if (translated && (await reachable(translated))) return translated;

	return path;
}
