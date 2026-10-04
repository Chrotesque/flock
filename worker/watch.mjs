// Scanning the watch folder and publishing what is in it.
//
// The compose screen needs to list videos sitting on the NAS, and a browser
// cannot read a filesystem. Rather than standing up a second service for the
// SPA to call — with its own URL, port and CORS — the worker writes the listing
// into PocketBase, which the SPA already talks to. It is stale by up to one
// poll interval, so the listing carries the time it was taken.

import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { resolveFolder } from './paths.mjs';

// Matches what the browser picker accepts, minus the ones nothing here can
// realistically publish. Keeping it to a list stops stray .part files, sidecar
// subtitles and Windows thumbnail junk showing up as choosable videos.
const VIDEO_EXTENSIONS = new Set([
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
 * The videos in one folder, newest first, or the reason it could not be read.
 * `label` names the folder in errors, since the resolved path may not be what
 * the user typed.
 */
async function scanFolder(folder, label) {
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
 * The watch folder's videos, each `path` in the form the folder was typed in
 * Settings — not the form that resolved here. A NAS worker reads the folder
 * as /mnt/user/... and a PC worker as \\nas\..., and both publish this
 * listing, so naming files by the typed form is what keeps a job's
 * `source_path` the same whichever wrote it; `resolveFolder` translates it
 * back on whichever machine opens it. `folder` stays the resolved one.
 */
export async function scanWatchFolder(configured) {
	const folder = await resolveFolder(configured);
	if (!folder) return null;
	const scan = await scanFolder(folder, `the watch folder ${configured}`);
	const typed = configured.trim();
	if (folder !== typed && /^\\\\/.test(typed)) {
		const base = typed.replace(/\\+$/, '');
		scan.files = scan.files.map((file) => ({ ...file, path: `${base}\\${file.name}` }));
	}
	return { ...scan, scannedAt: new Date().toISOString() };
}

/**
 * Every local folder pooled into one list, newest first. A folder listed twice,
 * or two folders sharing a file, never offer the same file twice.
 */
export async function scanLocalFolders(configured) {
	const folders = [];
	const files = new Map();
	for (const entry of configured) {
		const typed = (entry || '').trim();
		if (!typed) continue;
		const scan = await scanFolder(await resolveFolder(typed), typed);
		folders.push(scan.error ? { folder: typed, error: scan.error } : { folder: typed });
		for (const file of scan.files) files.set(file.path, file);
	}
	return {
		scannedAt: new Date().toISOString(),
		folders,
		files: [...files.values()].sort((a, b) => b.modified.localeCompare(a.modified))
	};
}
