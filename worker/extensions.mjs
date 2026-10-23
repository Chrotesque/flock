// Local worker extensions: the worker's side of local-devtest (src/lib/
// devtest.ts is the page's). Every `.mjs` file in `src/local-devtest/worker/`
// — the gitignored folder, so none ship with the repository — whose default
// export is `{ name, start(context) }` is started with a long-running worker.
// With the folder empty or absent this does nothing at all. Run from the
// checkout, the folder is read at the start (extensions-found.mjs); the
// bundle has the files built in instead (scripts/bundle-worker.mjs).

import { foundExtensions } from './extensions-found.mjs';

/** Whether a module's default export is an extension. */
export function isExtension(value) {
	return Boolean(value && typeof value.name === 'string' && typeof value.start === 'function');
}

/**
 * Starts each extension with what it may use: the PocketBase client, the
 * config and the folder it lives in (for files of its own beside it), the
 * log, and `active()` — whether this worker does the publishing work right
 * now, so a covering PC and the NAS never both act. A failing start is said
 * in the log and costs nothing else.
 */
export async function startExtensions(context, log) {
	let extensions = [];
	try {
		extensions = (await foundExtensions()).filter(isExtension);
	} catch (err) {
		log(`local extensions could not be loaded: ${err.message.split('\n')[0]}`);
		return;
	}
	for (const extension of extensions) {
		try {
			await extension.start({ ...context, log: (line) => log(`${extension.name}: ${line}`) });
			log(`local extension started: ${extension.name}`);
		} catch (err) {
			log(`local extension ${extension.name} did not start: ${err.message.split('\n')[0]}`);
		}
	}
}
