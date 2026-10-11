// One worker of a role per machine, and a way to stop one that has no window.
//
// On Windows a running worker holds a named pipe for its role. A second one
// started on the same machine cannot take the name and leaves (the duplicate
// that once ran 25 s after the first, both picking up the same work), and
// `--stop` connects to the pipe and asks the running one to shut down
// cleanly — the only way short of Task Manager for the background build,
// which has no console to press ctrl-c in. The pipe goes with the process, so
// a crash leaves no stale lock behind. Elsewhere (the NAS container) there is
// one worker per container by construction, and nothing is held.

import { createConnection, createServer } from 'node:net';

export function pipeName(role, suffix = '') {
	return `\\\\.\\pipe\\flock-worker-${role}${suffix}`;
}

/**
 * Takes the pipe for `role`. Resolves true when this is the only worker of
 * the role here, false when another holds it. `onStop` runs when `--stop`
 * asks. `name` is for the tests.
 */
export function holdInstance(role, onStop, { name = pipeName(role), platform = process.platform } = {}) {
	if (platform !== 'win32') return Promise.resolve(true);
	return new Promise((resolve, reject) => {
		const server = createServer((socket) => {
			socket.setEncoding('utf8');
			socket.on('data', (text) => {
				if (text.trim() !== 'stop') return;
				socket.end('stopping\n');
				onStop();
			});
			socket.on('error', () => {});
		});
		server.once('error', (err) => (err.code === 'EADDRINUSE' ? resolve(false) : reject(err)));
		server.listen(name, () => {
			server.unref();
			resolve(true);
		});
	});
}

/** Asks the running worker of `role` to stop; resolves to what to tell the person. */
export function askToStop(role, { name = pipeName(role), timeoutMs = 5000 } = {}) {
	return new Promise((resolve) => {
		const socket = createConnection(name);
		const done = (message) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(message);
		};
		const timer = setTimeout(() => done(`the ${role} worker did not answer`), timeoutMs);
		socket.setEncoding('utf8');
		socket.on('connect', () => socket.write('stop\n'));
		socket.on('data', (text) => {
			if (text.includes('stopping')) done(`the ${role} worker is stopping`);
		});
		socket.on('error', (err) =>
			done(err.code === 'ENOENT' ? `no ${role} worker is running on this machine` : `could not reach the ${role} worker: ${err.code || err.message}`)
		);
	});
}
