// A local project's videos copied to the NAS ahead of the upload
// (worker/staging.mjs writes them onto the project row's `staged`). The
// Review step plays such a copy through the publishing worker's player, so
// it plays in any browser rather than only on the PC that holds the file.

import type { WatchFile } from './types';

export interface StagedCopy {
	from: string;
	name: string;
	size: number;
	modified: string;
	path: string;
	at: string;
}

export interface Staged {
	copies: StagedCopy[];
	copying: { from: string; name: string; size: number; at: string } | null;
	error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The row's field read back field by field. */
export function readStaged(raw: unknown): Staged {
	const value = isRecord(raw) ? raw : {};
	const copies = Array.isArray(value.copies)
		? value.copies.filter(
				(c): c is StagedCopy =>
					isRecord(c) &&
					typeof c.from === 'string' &&
					typeof c.path === 'string' &&
					typeof c.name === 'string' &&
					typeof c.size === 'number' &&
					typeof c.modified === 'string'
			)
		: [];
	const copying = isRecord(value.copying) && typeof value.copying.from === 'string' ? (value.copying as Staged['copying']) : null;
	return { copies, copying, error: typeof value.error === 'string' ? value.error : '' };
}

/**
 * Where this very file's copy sits in the row's list — same path, size and
 * time — or -1. The index is what the worker's player is asked for.
 */
export function stagedIndex(staged: Staged, file: Pick<WatchFile, 'path' | 'size' | 'modified'>): number {
	for (let i = staged.copies.length - 1; i >= 0; i--) {
		const c = staged.copies[i];
		if (c.from === file.path && c.size === file.size && c.modified === file.modified) return i;
	}
	return -1;
}

/** What the project box says about its newest video and the NAS, or ''. */
export function stagedWords(staged: Staged, newest: WatchFile | undefined): string {
	if (!newest) return '';
	if (stagedIndex(staged, newest) >= 0) {
		const copy = staged.copies[stagedIndex(staged, newest)];
		return `${newest.name} is on the NAS${copy.name !== newest.name ? ` as ${copy.name}` : ''}.`;
	}
	if (staged.copying?.from === newest.path) return `Copying ${newest.name} to the NAS…`;
	if (staged.error) return `Copying to the NAS failed: ${staged.error} — tried again in a few minutes.`;
	return `${newest.name} is copied to the NAS once it has stood still for a minute.`;
}
