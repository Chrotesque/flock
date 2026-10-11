// The executable's console, kept in a file beside it as well.
//
// The background build has no console at all, and even the one with a window
// loses what it printed when the window closes. flock's Log screen has every
// line once PocketBase answers, but not what came before — a missing config,
// an unreachable PocketBase, a second worker refused — so those land here.
// Capped: past `maxBytes` the file becomes `.old` and a new one starts.

import { appendFileSync, renameSync, statSync } from 'node:fs';
import { format } from 'node:util';

export function logToFile(path, { maxBytes = 2 * 1024 * 1024 } = {}) {
	let size = 0;
	try {
		size = statSync(path).size;
	} catch {
		// No file yet.
	}

	const write = (args) => {
		const line = `${new Date().toISOString()} ${format(...args)}\n`;
		try {
			if (size + line.length > maxBytes) {
				renameSync(path, `${path}.old`);
				size = 0;
			}
			appendFileSync(path, line);
			size += Buffer.byteLength(line);
		} catch {
			// A log that cannot be written must not take the worker down.
		}
	};

	for (const method of ['log', 'warn', 'error']) {
		const original = console[method].bind(console);
		console[method] = (...args) => {
			original(...args);
			write(args);
		};
	}
}
