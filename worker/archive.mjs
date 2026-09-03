// Copying the finished video into its NAS destination folder.
//
// Independent of publishing: the destination is a place to file the video, not
// a platform, so a job is copied whether or not any platform has an adapter.
// It is also a *copy* — the original in PocketBase stays exactly where it is,
// and nothing here ever moves or deletes a source file.

import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, parse } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveFolder } from './paths.mjs';

async function exists(path) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * A name that is free in the destination.
 *
 * Never overwrites: a file already sitting there belongs to whoever put it
 * there, and silently replacing someone's video is not a recoverable mistake.
 */
async function freeName(dir, filename) {
	const { name, ext } = parse(filename);
	if (!(await exists(join(dir, filename)))) return filename;

	for (let n = 2; n < 1000; n++) {
		const candidate = `${name} (${n})${ext}`;
		if (!(await exists(join(dir, candidate)))) return candidate;
	}
	throw new Error(`Cannot find a free name for ${filename} in ${dir}`);
}

/**
 * Streams one job's video into its destination folder.
 *
 * Writes to a .part file and renames on completion, so an interrupted copy
 * cannot leave something that looks like a finished video behind.
 */
export async function copyToDestination({ job, pb, log }) {
	const configured = (job.destination_path || '').trim();
	if (!configured) return { skipped: 'no destination set' };
	// Resolved so a destination typed as a UNC path on Windows still works once
	// the worker is running in a container on the NAS.
	const dir = await resolveFolder(configured);

	// mkdir -p rather than requiring the folder to exist: a destination the user
	// typed into Settings has never been checked by anything until now.
	await mkdir(dir, { recursive: true }).catch((err) => {
		throw new Error(`Destination is not reachable: ${dir} (${err.code || err.message})`);
	});

	const wanted = job.video_name || job.video;
	const filename = await freeName(dir, wanted);
	const target = join(dir, filename);
	const partial = `${target}.part`;

	const source = await pb.openVideo(job);
	log(`copying ${filename} (${(source.size / 1024 / 1024).toFixed(1)} MB) -> ${dir}`);

	try {
		await pipeline(source.stream, createWriteStream(partial));
	} catch (err) {
		await unlink(partial).catch(() => {});
		throw new Error(`Copy failed: ${err.message}`);
	}

	// A short read finishes the pipeline without error, so compare before the
	// rename rather than filing a truncated video as complete.
	const written = await stat(partial);
	if (written.size !== source.size) {
		await unlink(partial).catch(() => {});
		throw new Error(`Copy was short: got ${written.size} of ${source.size} bytes`);
	}

	await rename(partial, target);
	return { path: target, bytes: written.size, renamed: filename !== wanted };
}
