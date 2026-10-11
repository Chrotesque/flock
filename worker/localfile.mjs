// Images on this machine that the compose screen asks for by path.
//
// A browser cannot open a path, and a pasted flock block (src/lib/flockpaste.ts)
// names its thumbnail by one — so the page writes the path to a
// `file_requests` row, and the worker reads the file here and attaches it to
// the row. The row is open to anything that can reach PocketBase, which is
// why only images come back, and only up to the 8 MB the largest platform
// takes: this is no way to fetch an arbitrary file off the PC.

import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFolder } from './paths.mjs';

export const IMAGE_TYPES = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp'
};

/** Instagram's cover cap, the largest of the platforms that take an image. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The path as this machine reads it: without the quotes Explorer's "Copy as
 * path" puts around it, from a file:// address, and with a leading ~ as the
 * worker's home folder.
 */
export function localPath(input, home = homedir()) {
	let path = String(input ?? '').trim();
	path = path.replace(/^"(.*)"$/, '$1').trim();
	if (/^file:\/\//i.test(path)) path = fileURLToPath(path);
	if (path === '~' || /^~[\\/]/.test(path)) path = join(home, path.slice(1));
	return path;
}

export function imageType(path) {
	return IMAGE_TYPES[extname(path).toLowerCase()] ?? null;
}

/** Reads an image for a request, or throws saying why in words for the page. */
export async function readLocalImage(input, { home } = {}) {
	const given = localPath(input, home);
	if (!given) throw new Error('No path was given.');
	const type = imageType(given);
	if (!type) throw new Error(`Not an image flock can use (JPEG, PNG, GIF or WebP): ${basename(given)}`);

	const path = await resolveFolder(given);
	if (!isAbsolute(path)) throw new Error(`Not a full path on the worker's machine: ${given}`);
	let info;
	try {
		info = await stat(path);
	} catch (err) {
		throw new Error(`Not found on the worker's machine: ${given} (${err.code || err.message})`);
	}
	if (!info.isFile()) throw new Error(`Not a file: ${given}`);
	if (info.size === 0) throw new Error(`The file is empty: ${given}`);
	if (info.size > IMAGE_MAX_BYTES) {
		throw new Error(
			`${basename(path)} is ${(info.size / 1024 / 1024).toFixed(1)} MB, over the 8 MB any platform takes.`
		);
	}
	return { bytes: await readFile(path), name: basename(path), type };
}
