// The Dashboard's player: an upload's copy on the NAS.
//
// Every upload with a destination folder is copied there (archive.mjs), so a
// video stays watchable from flock after it has gone out, whichever route it
// came in by. The page names an upload; the worker reads that upload's row
// and opens the copy the row records.
//
// The row is open to anyone who can reach PocketBase, so a path read from it
// is held to two rules before anything is opened: it must sit directly in the
// upload's destination folder, where copies are made, and it must be a video
// by its extension. A config file, or anything else that is not a video, is
// never served, whatever the row says.

import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { resolveFolder } from './paths.mjs';
import { typedJoin, VIDEO_EXTENSIONS } from './watch.mjs';

/** A PocketBase record id: 15 lower-case letters and digits. */
export function isRecordId(id) {
	return /^[a-z0-9]{15}$/.test(String(id ?? ''));
}

/** The last part of a typed path, whichever separator it uses. */
function lastPart(path) {
	return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** The folder part of a typed path, '' for a bare name. */
function folderOf(path) {
	const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return cut > 0 ? path.slice(0, cut) : '';
}

/**
 * Whether two typed folders are the same one, compared as written, case
 * aside (as UNC paths are, and resolveFolder is). Nothing is normalised, so a
 * name with `..` in it adds a level and cannot climb out of the folder.
 */
export function sameFolder(a, b) {
	const clean = (p) =>
		String(p).trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
	return clean(a) !== '' && clean(a) === clean(b);
}

/**
 * Where an upload's NAS copy is, as typed: `stored_path` once the worker has
 * recorded it, else — for an upload copied before it did — the destination
 * folder and the video's name, `guessed`, since the copy there may have been
 * given " (2)". `{ error }` when there is nothing to play: `no-job`,
 * `not-stored` (no destination folder, or not copied yet) or `refused` (a path
 * breaking the rules above).
 */
export function storedCopyOf(job) {
	if (!job) return { error: 'no-job' };
	const folder = String(job.destination_path ?? '').trim();
	const recorded = String(job.stored_path ?? '').trim();
	let path = recorded;
	if (!path) {
		const name = String(job.video_name || job.video || '').trim();
		if (!folder || job.status !== 'done' || !name) return { error: 'not-stored' };
		path = typedJoin(folder, name);
	}
	if (!sameFolder(folderOf(path), folder)) return { error: 'refused' };
	if (!VIDEO_EXTENSIONS.has(extname(path).toLowerCase())) return { error: 'refused' };
	return { path, guessed: !recorded };
}

/**
 * The names a copy of `name` may have been given, in the order archive.mjs'
 * freeName tries them: the name itself, then " (2)", " (3)" and on.
 */
export function copyNames(name, upTo = 9) {
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	return [name, ...Array.from({ length: upTo - 1 }, (_, i) => `${stem} (${i + 2})${ext}`)];
}

/**
 * The upload's copy as the preview server serves files — `{ name, path }`,
 * with the path as it opens on this machine — or `{ error }`: those of
 * storedCopyOf, `gone` when nothing is there, `differs` when files with its
 * name are there but none is clearly this one. Only ever a file directly in
 * the destination folder as it resolves here. `io` is for the tests.
 *
 * A recorded path is the copy. A guessed one is checked against what the
 * folder holds: the name may have been taken, so the copy went in as " (2)"
 * — the one with the upload's size is it. A lone file under the name itself
 * counts whatever its size, because the size on an upload is the listing's,
 * and a file re-exported after it was listed went out (and was copied) at
 * its new size.
 */
export async function openStoredCopy(job, io = { resolve: resolveFolder, stat }) {
	const copy = storedCopyOf(job);
	if (copy.error) return copy;
	const dir = await io.resolve(String(job.destination_path).trim());
	const sizeOf = async (name) => {
		try {
			const info = await io.stat(join(dir, name));
			return info.isFile() ? info.size : null;
		} catch {
			return null;
		}
	};
	const at = (name) => ({ name, path: join(dir, name) });
	const wanted = lastPart(copy.path);
	if (!copy.guessed) return (await sizeOf(wanted)) === null ? { error: 'gone' } : at(wanted);

	const present = [];
	for (const name of copyNames(wanted)) {
		const size = await sizeOf(name);
		if (size !== null) present.push({ name, size });
	}
	if (present.length === 0) return { error: 'gone' };
	const size = Number(job.video_size);
	const match =
		present.find((f) => size > 0 && f.size === size) ??
		(present.length === 1 && present[0].name === wanted ? present[0] : null);
	return match ? at(match.name) : { error: 'differs' };
}
