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

export async function scanWatchFolder(configured) {
	const folder = await resolveFolder(configured);
	if (!folder) return null;

	const index = { folder, scannedAt: new Date().toISOString(), files: [] };

	let entries;
	try {
		entries = await readdir(folder, { withFileTypes: true });
	} catch (err) {
		index.error =
			err.code === 'ENOENT'
				? `Watch folder not found: ${configured}`
				: `Cannot read the watch folder: ${err.code || err.message}`;
		return index;
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
			index.files.push({
				name: entry.name,
				size: info.size,
				modified: info.mtime.toISOString(),
				path
			});
		} catch {
			// Vanished between readdir and stat — nothing to report.
		}
	}

	index.files.sort((a, b) => b.modified.localeCompare(a.modified));
	return index;
}
