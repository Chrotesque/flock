// Scanning the watch folders.
//
// The compose screen needs to list videos sitting in them, and a browser
// cannot read a filesystem. Rather than standing up a second service for the
// SPA to call — with its own URL, port and CORS — the worker writes the listing
// into PocketBase, which the SPA already talks to. It is stale by up to one
// poll interval, so the listing carries the time it was taken.

import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { resolveFolder, triedAs } from './paths.mjs';

// Matches what the browser picker accepts, minus the ones nothing here can
// realistically publish. Keeping it to a list stops stray .part files, sidecar
// subtitles and Windows thumbnail junk showing up as choosable videos.
export const VIDEO_EXTENSIONS = new Set([
	'.mp4',
	'.mov',
	'.m4v',
	'.mkv',
	'.webm',
	'.avi',
	'.wmv',
	'.flv',
	'.mpg',
	'.mpeg',
	'.ts'
]);

/**
 * A path under a folder, in the form the folder was typed in Settings. A UNC
 * folder joins with backslashes on any machine — the NAS worker reads it as
 * /mnt/user/… but names it as typed — and anything else as this machine
 * joins paths.
 */
export function typedJoin(typed, ...parts) {
	const base = String(typed).trim().replace(/[\\/]+$/, '');
	return /^\\\\/.test(base) ? [base, ...parts].join('\\') : join(base, ...parts);
}

/**
 * The videos in one folder, newest first, or the reason it could not be read.
 * `label` names the folder in errors, since the resolved path may not be what
 * the user typed.
 */
export async function scanFolder(folder, label) {
	const out = { folder, files: [] };

	let entries;
	try {
		entries = await readdir(folder, { withFileTypes: true });
	} catch (err) {
		out.error =
			err.code === 'ENOENT'
				? `Folder not found: ${label}`
				: `Cannot read ${label}: ${err.code || err.message}`;
		return out;
	}

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (entry.name.startsWith('.')) continue;
		if (!VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

		const path = join(folder, entry.name);
		try {
			const info = await stat(path);
			// A file still being copied in would otherwise be offered for publishing
			// half-written. Size alone cannot prove it is finished, but zero bytes
			// definitely is not.
			if (info.size === 0) continue;
			out.files.push({
				name: entry.name,
				size: info.size,
				modified: info.mtime.toISOString(),
				path
			});
		} catch {
			// Vanished between readdir and stat — nothing to report.
		}
	}

	out.files.sort((a, b) => b.modified.localeCompare(a.modified));
	return out;
}

/**
 * Every folder of one kind pooled into one listing, newest first. Each file's
 * `path` is in the form its folder was typed — not the form that resolved
 * here: a NAS worker reads a share as /mnt/user/... and a PC worker as
 * \\nas\..., and both may publish this listing, so naming files the typed way
 * is what keeps a job's `source_path` the same whichever wrote it;
 * `resolveFolder` translates it back where it is opened. `opened` is the path
 * that works here, for the preview server — strip it before publishing. A
 * folder listed twice, or two sharing a file, never offer it twice.
 */
export async function scanFolders(configured) {
	const folders = [];
	const files = new Map();
	for (const entry of configured) {
		const typed = (entry || '').trim();
		if (!typed) continue;
		const resolved = await resolveFolder(typed);
		const tried = resolved === typed ? triedAs(typed) : '';
		const scan = await scanFolder(resolved, `${typed}${tried}`);
		folders.push(scan.error ? { folder: typed, error: scan.error } : { folder: typed });
		for (const file of scan.files) {
			const path = typedJoin(typed, file.name);
			files.set(path.toLowerCase(), { ...file, path, opened: file.path });
		}
	}
	return {
		scannedAt: new Date().toISOString(),
		folders,
		files: [...files.values()].sort((a, b) => b.modified.localeCompare(a.modified))
	};
}

/** A listed file as the page gets it: without the path that works here. */
export function published(file) {
	const { opened: _opened, ...rest } = file;
	return rest;
}
