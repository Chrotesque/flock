// Making a path typed on one machine usable on another.
//
// Folders are typed into Settings from a Windows browser, so they arrive as UNC
// paths like \\nas\videos\incoming. The worker is meant to end up in a
// container on the NAS itself, where that same folder is /mnt/user/videos/...
// Rather than making the user maintain two sets of paths, or hard-coding which
// machine the worker is on, resolution is by trial: use what works.

import { access, readdir } from 'node:fs/promises';
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

const disk = {
	exists: reachable,
	list: (dir) => readdir(dir)
};

/**
 * The path as it is spelled on this disk, matching each part regardless of
 * case where the exact spelling is not there; null when some part is missing
 * in any case. A UNC path is case-insensitive — `\\nas\shared` reaches a share
 * named `Shared` — while Linux is not, so the translation of what was typed
 * in Windows may differ from the folder only in case. `fs` is for the tests.
 */
export async function matchCase(path, fs = disk) {
	if (!path.startsWith('/')) return null;
	let current = '';
	for (const part of path.split('/').filter(Boolean)) {
		const exact = `${current}/${part}`;
		if (await fs.exists(exact)) {
			current = exact;
			continue;
		}
		let names;
		try {
			names = await fs.list(current || '/');
		} catch {
			return null;
		}
		const found = names.find((name) => name.toLowerCase() === part.toLowerCase());
		if (!found) return null;
		current = `${current}/${found}`;
	}
	return current || '/';
}

/**
 * Picks whichever form of a configured folder actually exists here.
 *
 * Tries the path as written first, so a worker on Windows keeps using the UNC
 * path directly. Falls back to the Unraid translation, which is what a worker
 * inside a container on the NAS will need — spelled as the disk spells it,
 * since the share may be `Shared` where the UNC path says `shared`. Returns
 * the original if nothing resolves, so the caller's own error names the path
 * the user actually typed.
 */
export async function resolveFolder(configured) {
	const path = (configured || '').trim();
	if (!path) return '';
	if (await reachable(path)) return path;

	const translated = uncToUnraid(path);
	if (translated) {
		const found = await matchCase(translated);
		if (found) return found;
	}

	return path;
}

/**
 * What a folder that did not resolve was looked for as here, for the error:
 * on the NAS, "\\nas\shared\x" alone does not say that /mnt/user/shared/x
 * was missing too.
 */
export function triedAs(configured) {
	const translated = uncToUnraid((configured || '').trim());
	return translated && process.platform !== 'win32' ? ` (looked for ${translated} here)` : '';
}
