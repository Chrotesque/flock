// Copying a local project's video to the NAS before it is uploaded, so the
// Review step can play it from any browser (through the publishing worker's
// player) and the copy at confirm is already done. Only the newest video of
// the folder is copied; a newer one — another file, or the same file
// exported again — is copied beside it with _2, _3… on its name, and older
// copies are kept. The project row's `staged` field records every copy:
// `{ copies: [{ from, name, size, modified, path, at }], copying, error }`,
// paths in the typed form (see watch.mjs). The rules are here; the passes
// are in index.mjs.

import { extname } from 'node:path';
import { VIDEO_EXTENSIONS, typedJoin } from './watch.mjs';

/** The folder under the import folder that holds the projects' copies. */
export const STAGE_DIR = 'flock-projects';

/** A video modified more recently than this may still be being written. */
export const STABLE_MS = 60_000;

/** The row's `staged` read back field by field; never trusted to have a shape. */
export function readStaged(raw) {
	const value = raw && typeof raw === 'object' ? raw : {};
	const copies = Array.isArray(value.copies)
		? value.copies.filter(
				(c) =>
					c &&
					typeof c.from === 'string' &&
					typeof c.path === 'string' &&
					typeof c.name === 'string' &&
					Number.isFinite(c.size) &&
					typeof c.modified === 'string'
			)
		: [];
	return {
		copies,
		copying: value.copying && typeof value.copying.from === 'string' ? value.copying : null,
		error: typeof value.error === 'string' ? value.error : ''
	};
}

/** The copy of exactly this file — same path, size and time — or null. */
export function copyOf(staged, file) {
	if (!file) return null;
	const copies = readStaged(staged).copies;
	for (let i = copies.length - 1; i >= 0; i--) {
		const c = copies[i];
		if (c.from === file.path && c.size === file.size && c.modified === file.modified) return c;
	}
	return null;
}

/**
 * The video this project wants on the NAS now, or null: the newest in its
 * folder, once it has stood still for STABLE_MS, unless that very file
 * (path, size and time) is copied already. Only an open local project —
 * not sent, not taken off the list, not gone.
 */
export function stagingNeed(row, now = Date.now()) {
	if (!row?.local || row.missing || row.archived_at) return null;
	if (row.status === 'uploaded' || row.status === 'dismissed') return null;
	const videos = Array.isArray(row.videos) ? row.videos : [];
	const newest = [...videos].sort((a, b) => String(b.modified).localeCompare(String(a.modified)))[0];
	if (!newest?.path || !newest.size) return null;
	const at = Date.parse(newest.modified);
	if (!Number.isFinite(at) || now - at < STABLE_MS) return null;
	return copyOf(row.staged, newest) ? null : newest;
}

/** A project's name as a folder name on Windows and Linux shares alike. */
export function safeFolder(name) {
	const cleaned = String(name || '')
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/[. ]+$/, '')
		.trim()
		.slice(0, 120);
	return cleaned || 'project';
}

/**
 * The name a copy goes in under: the video's own name for the project's
 * first copy, `name_2.ext`, `name_3.ext`… after that — and never one the
 * folder already holds.
 */
export function stagedName(name, copiesBefore, taken) {
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	const used = new Set([...taken].map((n) => n.toLowerCase()));
	for (let n = copiesBefore + 1; n < copiesBefore + 1000; n++) {
		const candidate = n === 1 ? name : `${stem}_${n}${ext}`;
		if (!used.has(candidate.toLowerCase())) return candidate;
	}
	throw new Error(`No free name for ${name}`);
}

/** Where a project's copies go, typed: <import folder>/flock-projects/<project>. */
export function stageFolder(importTo, projectName) {
	return typedJoin(importTo, STAGE_DIR, safeFolder(projectName));
}

/**
 * Whether a recorded copy may be served: a video, under the staging folder
 * of the import folder as it is set now, with no step up out of it. The row
 * is open to anyone on the tailnet, so its path is checked rather than
 * trusted.
 */
export function servable(path, importTo) {
	if (typeof path !== 'string' || !importTo) return false;
	if (!VIDEO_EXTENSIONS.has(extname(path).toLowerCase())) return false;
	const parts = path.split(/[\\/]+/);
	if (parts.some((p) => p === '..' || p === '.')) return false;
	const norm = (p) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
	return norm(path).startsWith(`${norm(typedJoin(importTo, STAGE_DIR))}/`);
}

/** Splits a typed path into its folder and file name, whichever slash it uses. */
export function splitTyped(path) {
	const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return at < 0 ? { dir: '', name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}
