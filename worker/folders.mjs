// Which folders to list, as Settings has them.
//
// The watch folders are one list since 0.11.4, and so are the project
// folders: a folder's kind follows from how its path is written (the SPA's
// src/lib/folders.ts holds the same rule). A network path — UNC, or an
// absolute POSIX path — is listed by the worker that publishes, which reads
// a pick where it lies; anything else is on the PC and listed by the `local`
// worker, which copies a pick into a network watch folder first.

/** 'network' for \\host\share\… or /mnt/…, 'local' for D:\… and the rest. */
export function folderKind(path) {
	const clean = String(path ?? '').trim();
	return clean.startsWith('\\\\') || clean.startsWith('/') ? 'network' : 'local';
}

/** The paths of a stored folder list, trimmed, empty ones and repeats left out. */
function paths(list) {
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const entry of list) {
		const path = typeof entry?.path === 'string' ? entry.path.trim() : '';
		if (path && !out.some((p) => p.toLowerCase() === path.toLowerCase())) out.push(path);
	}
	return out;
}

/**
 * The `general` settings row's folders, split by kind. A row written before
 * the lists merged — or by an SPA not yet updated — has a NAS `watchFolder`
 * and `localFolders` instead, read the same way. `importTo` is the network
 * folder local picks are copied into: the one chosen, else the first.
 */
export function readWatchConfig(general) {
	const value = general && typeof general === 'object' ? general : {};
	let watch;
	let importTo;
	if (Array.isArray(value.watchFolders)) {
		watch = paths(value.watchFolders);
		const network = value.watchFolders.filter(
			(f) => typeof f?.path === 'string' && f.path.trim() && folderKind(f.path) === 'network'
		);
		importTo = (network.find((f) => f.id === value.importFolderId) ?? network[0])?.path.trim() ?? '';
	} else {
		const nas = typeof value.watchFolder === 'string' ? value.watchFolder.trim() : '';
		watch = paths([...(nas ? [{ path: nas }] : []), ...(Array.isArray(value.localFolders) ? value.localFolders : [])]);
		importTo = nas;
	}
	const projects = paths(value.projectFolders);
	return {
		network: watch.filter((p) => folderKind(p) === 'network'),
		local: watch.filter((p) => folderKind(p) === 'local'),
		importTo,
		projects: {
			network: projects.filter((p) => folderKind(p) === 'network'),
			local: projects.filter((p) => folderKind(p) === 'local')
		}
	};
}
