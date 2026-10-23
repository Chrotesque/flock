// The local worker extensions found beside the checkout's worker (see
// extensions.mjs). This file alone is replaced in the bundle
// (scripts/bundle-worker.mjs), by one with the same files built in.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The extension files in a folder, in name order: `.mjs`, not tests. */
export function extensionFiles(dir) {
	if (!dir || !existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
		.sort();
}

/** The folder's modules' default exports, in name order. */
export async function foundExtensions() {
	const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'local-devtest', 'worker');
	const found = [];
	for (const name of extensionFiles(dir)) found.push((await import(pathToFileURL(join(dir, name)).href)).default);
	return found;
}
