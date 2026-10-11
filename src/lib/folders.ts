import type { WatchFolder } from './types';

/**
 * Watch and project folders, one list each, whatever machine they are on.
 *
 * A folder's kind follows from how its path is written, nothing else: a
 * network path (`\\nas\share\x`, or an absolute POSIX path such as
 * `/mnt/user/x`) is read by the worker that publishes, which references a
 * picked file where it lies; anything else (`D:\videos`) is on the PC the
 * `local` worker runs on, and a pick from it is copied into a network watch
 * folder before anything publishes. worker/folders.mjs holds the same rule.
 */
export type FolderKind = 'network' | 'local';

export function folderKind(path: string): FolderKind {
	const clean = path.trim();
	return clean.startsWith('\\\\') || clean.startsWith('/') ? 'network' : 'local';
}

/** The last part of a path, for headings: `\\nas\x\Monetized` → `Monetized`. */
export function folderName(path: string): string {
	const parts = path.trim().split(/[\\/]+/).filter(Boolean);
	return parts[parts.length - 1] ?? path.trim();
}

/** The folder a listed file sits in, by name — `D:\clips\a.mp4` → `clips`. */
export function parentName(path: string): string {
	const parts = path.trim().split(/[\\/]+/).filter(Boolean);
	return parts.length > 1 ? parts[parts.length - 2] : '';
}

/** A path that names its own place: drive, UNC, POSIX root or a file: URL. */
export function isAbsolutePath(path: string): boolean {
	const clean = path.trim().replace(/^"|"$/g, '');
	return /^[A-Za-z]:[\\/]/.test(clean) || /^[\\/]/.test(clean) || /^file:/i.test(clean) || clean.startsWith('~');
}

/**
 * A path from a project file, read against the project's folder: a bare
 * `thumb.png` or `art\thumb.png` is next to the file, an absolute path is
 * left as it is. Joined with the folder's own separator.
 */
export function resolveIn(folder: string, path: string): string {
	const clean = path.trim();
	if (!clean || isAbsolutePath(clean) || !folder.trim()) return clean;
	const base = folder.trim().replace(/[\\/]+$/, '');
	const sep = base.includes('\\') || !base.includes('/') ? '\\' : '/';
	const rest = clean.replace(/^\.[\\/]/, '').replace(/[\\/]+/g, sep);
	return `${base}${sep}${rest}`;
}

/** Same folder, however its case or trailing separator is written. */
export function sameFolder(a: string, b: string): boolean {
	const norm = (p: string) => p.trim().replace(/[\\/]+$/, '').toLowerCase();
	return norm(a) === norm(b);
}

/** The rows of a stored folder list that are usable, as written. */
export function readFolders(raw: unknown): WatchFolder[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(f): f is WatchFolder => Boolean(f) && typeof f.id === 'string' && typeof f.path === 'string'
	);
}

/**
 * The watch folders of a `general` row, in the one-list form. A row written
 * before the lists merged has a single NAS `watchFolder` and a list of
 * `localFolders`: the NAS one comes first, so it stays where local picks are
 * copied, then the local ones. `id` is for the NAS folder's new row.
 */
export function migrateWatchFolders(
	stored: { watchFolders?: unknown; watchFolder?: unknown; localFolders?: unknown },
	id: () => string
): WatchFolder[] {
	if (Array.isArray(stored.watchFolders)) return readFolders(stored.watchFolders);
	const out: WatchFolder[] = [];
	const nas = typeof stored.watchFolder === 'string' ? stored.watchFolder.trim() : '';
	if (nas) out.push({ id: id(), path: nas });
	for (const folder of readFolders(stored.localFolders)) {
		// The local ones could only ever be picked in the dialog.
		if (!out.some((f) => sameFolder(f.path, folder.path))) out.push({ ...folder, chosen: true });
	}
	return out;
}

/**
 * The network folder local picks are copied into: the one chosen, else the
 * first network folder in the list; null when there is none.
 */
export function importFolder(folders: WatchFolder[], chosenId: string | null): WatchFolder | null {
	const network = folders.filter((f) => f.path.trim() && folderKind(f.path) === 'network');
	return network.find((f) => f.id === chosenId) ?? network[0] ?? null;
}

/**
 * The keys a worker from before the merge reads, written beside the list so
 * one not yet updated — the PC's is carried over by hand — keeps scanning
 * and importing: `watchFolder` is where local picks go, `localFolders` the
 * local ones. Nothing in this build reads them.
 */
export function legacyWatchKeys(
	folders: WatchFolder[],
	chosenId: string | null
): { watchFolder: string; localFolders: WatchFolder[] } {
	return {
		watchFolder: importFolder(folders, chosenId)?.path.trim() ?? '',
		localFolders: folders
			.filter((f) => f.path.trim() && folderKind(f.path) === 'local')
			.map(({ id, path }) => ({ id, path }))
	};
}
