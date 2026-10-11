// Project folders: a parent folder in Settings holds one subfolder per
// project, and a subfolder becomes a project once a flock JSON file is in it
// — written there by an assistant on the PC that edits the videos. The worker
// finds them, reads the file's text raw (the page parses it, as it parses a
// pasted block: src/lib/flockpaste.ts) and lists the videos beside it, and
// keeps one `projects` row per project up to date. The page keeps the upload
// in progress on the same row; the worker never touches that half.

import { readdir, readFile, rename, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { resolveFolder, triedAs } from './paths.mjs';
import { VIDEO_EXTENSIONS, published, typedJoin } from './watch.mjs';

/** The name looked for first; any other .json naming itself a flock block also counts. */
export const MANIFEST_NAME = 'flock.json';
/** What the row's text field holds, and so the largest project file read. */
export const MANIFEST_MAX_BYTES = 100_000;

const MARK = /"flock"\s*:/;

/**
 * A project file flock renamed after its upload (`flock_uploaded.json`, or
 * `-2`… when that was taken): kept for the record, never read as a project
 * again — it still carries its `"flock"` key.
 */
export function isUploadedName(name) {
	return /_uploaded(-\d+)?\.json$/i.test(name);
}

/** `flock.json` → `flock_uploaded.json`, or `flock_uploaded-2.json`… when taken. */
export function uploadedName(name, taken) {
	const stem = name.replace(/\.json$/i, '');
	const used = new Set([...taken].map((n) => n.toLowerCase()));
	for (let n = 1; n < 100; n++) {
		const candidate = `${stem}_uploaded${n === 1 ? '' : `-${n}`}.json`;
		if (!used.has(candidate.toLowerCase())) return candidate;
	}
	throw new Error(`No free name for ${stem}_uploaded.json`);
}

/**
 * Renames a project's file once its upload is queued, so the folder leaves
 * the sidebar and the text stays beside the video. `{ renamed }` with the
 * new name, or `{ gone: true }` when the folder holds no such file any more.
 * A folder that cannot be read throws, to be tried again.
 */
export async function archiveManifest(dir, name) {
	const names = await readdir(dir);
	if (!names.includes(name)) return { gone: true };
	const renamed = uploadedName(name, names);
	await rename(join(dir, name), join(dir, renamed));
	return { renamed };
}

/**
 * The key of a row whose file was renamed: no longer its folder's, so a new
 * flock.json there later is a new project rather than this sent one.
 */
export function detachedKey(row) {
	return `${String(row.key).slice(0, 980)}#${row.id}`;
}

/**
 * The flock JSON of one project folder, or null: `flock.json` if it is
 * there, whatever it holds — so a broken one is reported rather than the
 * project vanishing — else the newest other .json with a top `"flock"` key.
 */
async function pickManifest(dir, names) {
	let best = null;
	const ordered = [...names].sort(
		(a, b) => Number(b.toLowerCase() === MANIFEST_NAME) - Number(a.toLowerCase() === MANIFEST_NAME)
	);
	for (const name of ordered) {
		if (isUploadedName(name)) continue;
		const named = name.toLowerCase() === MANIFEST_NAME;
		let info;
		try {
			info = await stat(join(dir, name));
		} catch {
			continue;
		}
		const modified = info.mtime.toISOString();
		if (info.size > MANIFEST_MAX_BYTES) {
			if (named) {
				return { name, text: '', modified, error: `${name} is ${Math.round(info.size / 1024)} KB — a project file may be 100 KB at most.` };
			}
			continue;
		}
		let text;
		try {
			text = (await readFile(join(dir, name), 'utf8')).replace(/^﻿/, '');
		} catch {
			continue;
		}
		if (named) return { name, text, modified };
		if (!MARK.test(text)) continue;
		if (!best || modified > best.modified) best = { name, text, modified };
	}
	return best;
}

/** One subfolder as a project, or null when it holds no flock JSON. */
async function readProject(dir, typedDir, name) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return null;
	}
	const jsons = [];
	const videos = [];
	for (const entry of entries) {
		if (!entry.isFile() || entry.name.startsWith('.')) continue;
		const ext = extname(entry.name).toLowerCase();
		if (ext === '.json') jsons.push(entry.name);
		else if (VIDEO_EXTENSIONS.has(ext)) videos.push(entry.name);
	}
	const manifest = await pickManifest(dir, jsons);
	if (!manifest) return null;

	const files = [];
	for (const file of videos) {
		try {
			const info = await stat(join(dir, file));
			// Zero bytes is a copy that has only just begun.
			if (info.size === 0) continue;
			files.push({
				name: file,
				size: info.size,
				modified: info.mtime.toISOString(),
				path: typedJoin(typedDir, file),
				opened: join(dir, file)
			});
		} catch {
			// Gone between the listing and the look.
		}
	}
	files.sort((a, b) => b.modified.localeCompare(a.modified));
	return {
		path: typedDir,
		name,
		manifest: manifest.text,
		manifestName: manifest.name,
		manifestModified: manifest.modified,
		error: manifest.error ?? '',
		videos: files
	};
}

/**
 * The projects in one configured folder, each named and pathed the way the
 * folder was typed (see watch.mjs). `error` when the folder itself cannot be
 * read — then nothing under it may be taken for gone. `resolved` and `dirs`
 * are the folder as opened here and every subfolder of it, projects or not
 * yet: what the folder watcher watches (folderwatch.mjs).
 */
export async function scanProjectRoot(configured) {
	const typed = String(configured || '').trim();
	const resolved = await resolveFolder(typed);
	let entries;
	try {
		entries = await readdir(resolved, { withFileTypes: true });
	} catch (err) {
		const where = `${typed}${resolved === typed ? triedAs(typed) : ''}`;
		return {
			folder: typed,
			error:
				err.code === 'ENOENT'
					? `Project folder not found: ${where}`
					: `Cannot read the project folder ${where}: ${err.code || err.message}`,
			projects: []
		};
	}
	const projects = [];
	const dirs = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		dirs.push(join(resolved, entry.name));
		const project = await readProject(join(resolved, entry.name), typedJoin(typed, entry.name), entry.name);
		if (project) projects.push(project);
	}
	return { folder: typed, resolved, dirs, projects };
}

export async function scanProjectRoots(configured) {
	const out = [];
	for (const folder of configured) out.push(await scanProjectRoot(folder));
	return out;
}

/** A project's row key: its path, as a unique index can compare it. */
export function projectKey(path) {
	return String(path).trim().replace(/[\\/]+$/, '').toLowerCase();
}

/** JSON with every object's keys sorted — PocketBase hands json fields back that way. */
export function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

const SAME_ROOT = (a, b) => projectKey(a) === projectKey(b);

/**
 * What to write after a scan of the project folders of one kind (`local`
 * true for the PC's), given the rows there are: a row for each new project,
 * a patch for each whose file, videos or place changed — nothing for one
 * that did not, so a quiet folder costs no writes — and `missing` for a row
 * under a folder read cleanly this time that holds it no longer. A folder
 * that could not be read says nothing about what is under it, and a row whose
 * file was renamed after its upload is history, left alone.
 */
export function planProjectWrites(existing, roots, local) {
	const byKey = new Map(existing.map((row) => [row.key, row]));
	const create = [];
	const update = [];
	const seen = new Set();

	for (const root of roots) {
		if (root.error) continue;
		for (const project of root.projects) {
			const key = projectKey(project.path);
			if (seen.has(key)) continue;
			seen.add(key);
			const data = {
				key,
				path: project.path,
				name: project.name,
				root: root.folder,
				local,
				manifest: project.manifest,
				manifest_name: project.manifestName,
				manifest_modified: project.manifestModified,
				videos: project.videos.map(published),
				missing: false,
				error: project.error
			};
			const row = byKey.get(key);
			if (!row) {
				create.push(data);
				continue;
			}
			const changed = Object.keys(data).some((field) =>
				field === 'videos'
					? canonical(row.videos ?? []) !== canonical(data.videos)
					: (row[field] ?? (typeof data[field] === 'boolean' ? false : '')) !== data[field]
			);
			if (changed) update.push({ id: row.id, data });
		}
	}

	const read = roots.filter((root) => !root.error).map((root) => root.folder);
	for (const row of existing) {
		if (row.archived_at || row.missing || seen.has(row.key) || Boolean(row.local) !== local) continue;
		if (read.some((folder) => SAME_ROOT(folder, row.root))) update.push({ id: row.id, data: { missing: true } });
	}
	return { create, update };
}
