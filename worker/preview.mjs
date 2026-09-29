// Streaming a listed video to the Upload step's player.
//
// The one place the worker answers the browser directly instead of through
// PocketBase, because nothing else can reach these files: the local folders
// are on this PC's disks, the watch folder is behind SMB, and a local video
// can run to tens of gigabytes — far past anything worth copying into
// PocketBase just to look at it. So the worker, which already reads both
// folders for the listings, streams them too.
//
// Deliberately narrow. It listens on the loopback address only, it is
// read-only, and it serves a path only when that exact path is in the
// worker's own latest listing — the request names a file, it never supplies
// one to open.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { mimeFromName } from './upload.mjs';

/**
 * What to send for a `Range` header against a file of `size` bytes:
 * `{ status: 206, start, end }` for one satisfiable range (inclusive, as the
 * header counts), `{ status: 416 }` for one that starts past the end, and
 * `{ status: 200 }` — the whole file — for no header, several ranges, another
 * unit or nonsense. A server may always ignore a Range header, and every
 * player copes with getting everything; one byte range is all they ask for.
 */
export function parseRange(header, size) {
	if (!header) return { status: 200 };
	const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
	if (!match || (match[1] === '' && match[2] === '')) return { status: 200 };

	let start;
	let end;
	if (match[1] === '') {
		// "-500" is the last 500 bytes.
		const suffix = Number(match[2]);
		if (suffix === 0) return { status: 416 };
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(match[1]);
		if (match[2] !== '' && Number(match[2]) < start) return { status: 200 };
		end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
	}
	if (size === 0 || start >= size) return { status: 416 };
	return { status: 206, start, end };
}

function json(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
	res.end(JSON.stringify(body));
}

async function statOrNull(path) {
	try {
		return await stat(path);
	} catch {
		return null;
	}
}

async function handle(req, res, lookup) {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const source = url.searchParams.get('source') ?? '';
	const path = url.searchParams.get('path') ?? '';

	// Asked by the page before it points a player here, so a failure can be
	// explained: a player that cannot load a source says only that it could
	// not. It carries no bytes, which is why any origin may read it.
	if (url.pathname === '/check') {
		res.setHeader('Access-Control-Allow-Origin', '*');
		const file = lookup(source, path);
		if (!file) return json(res, 404, { ok: false, error: 'not-listed' });
		const info = await statOrNull(file.path);
		if (!info?.isFile()) return json(res, 404, { ok: false, error: 'gone' });
		return json(res, 200, { ok: true, name: file.name, size: info.size });
	}

	if (url.pathname !== '/video') return json(res, 404, { ok: false, error: 'not-found' });
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405, { Allow: 'GET, HEAD' });
		return res.end();
	}

	const file = lookup(source, path);
	const info = file ? await statOrNull(file.path) : null;
	if (!file || !info?.isFile()) {
		res.writeHead(404);
		return res.end();
	}

	const range = parseRange(req.headers.range, info.size);
	const headers = {
		'Content-Type': mimeFromName(file.name, 'application/octet-stream'),
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'no-store',
		'Last-Modified': info.mtime.toUTCString()
	};
	if (range.status === 416) {
		res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
		return res.end();
	}

	const start = range.status === 206 ? range.start : 0;
	const end = range.status === 206 ? range.end : info.size - 1;
	res.writeHead(range.status, {
		...headers,
		'Content-Length': String(end - start + 1),
		...(range.status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {})
	});
	if (req.method === 'HEAD') return res.end();

	const stream = createReadStream(file.path, { start, end });
	// A player drops a range the moment it seeks; stop reading when it goes.
	res.on('close', () => stream.destroy());
	stream.on('error', () => res.destroy());
	stream.pipe(res);
}

/**
 * Starts the server. `lookup(source, path)` returns the listed file for that
 * list and exact path, or null; `onListening` gets the port actually bound,
 * which is what the address published for the page is built from. A port
 * already taken is logged rather than thrown: the player is a convenience,
 * and the worker's real work carries on without it.
 */
export function startPreviewServer({ port, lookup, log, onListening }) {
	const server = createServer((req, res) => {
		handle(req, res, lookup).catch((err) => {
			if (!res.headersSent) json(res, 500, { ok: false, error: err.message });
			else res.destroy();
		});
	});
	server.on('error', (err) => {
		log(
			err.code === 'EADDRINUSE'
				? `preview: port ${port} is taken, so the Upload step cannot play listed videos`
				: `preview: ${err.message}`
		);
	});
	server.listen(port, '127.0.0.1', () => onListening?.(server.address().port));
	return server;
}
