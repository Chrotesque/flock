// Serving a reel's cover image to Instagram.
//
// Instagram takes a custom cover only as `cover_url`, an address its servers
// fetch while the container is processed; it takes no image bytes. flock's
// PocketBase is not public, and should not be, so the worker serves the one
// image itself: it listens on the loopback address, something like Tailscale
// Funnel forwards one public hostname to it, and `coverPublicBase` is that
// hostname. An image is leased under a random token for the length of one
// publish and forgotten afterwards, so nothing is reachable at a guessable
// address and nothing stays reachable once the reel is out.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

// How long a leased cover stays served if the publish never releases it.
const LEASE_MS = 60 * 60_000;

/**
 * Starts the server and returns the handle the Instagram adapter uses.
 * `publicBase` is the address the world reaches this port by, without a
 * trailing slash; `onListening` gets the port actually bound. A port already
 * taken is logged rather than thrown, and covers then fall back to the frame
 * at the cover time, which is what happens with no server at all.
 */
export function startCoverServer({ port, publicBase, log, onListening }) {
	const leases = new Map();
	const base = String(publicBase).replace(/\/+$/, '');

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const match = /^\/cover\/([a-f0-9]{32})\.(jpg|png)$/.exec(url.pathname);
		const lease = match ? leases.get(match[1]) : null;
		if (!lease || (req.method !== 'GET' && req.method !== 'HEAD')) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, {
			'Content-Type': lease.mimeType,
			'Content-Length': String(lease.bytes.length),
			'Cache-Control': 'no-store'
		});
		if (req.method === 'HEAD') return res.end();
		res.end(lease.bytes);
	});

	server.on('error', (err) => {
		log(
			err.code === 'EADDRINUSE'
				? `covers: port ${port} is taken, so Instagram covers fall back to the cover time`
				: `covers: ${err.message}`
		);
	});
	server.listen(port, '127.0.0.1', () => onListening?.(server.address().port));

	return {
		base,

		/** Makes one image fetchable at a fresh address until `release()` or an hour. */
		lease(bytes, mimeType) {
			const token = randomBytes(16).toString('hex');
			const ext = mimeType === 'image/png' ? 'png' : 'jpg';
			leases.set(token, { bytes, mimeType: ext === 'png' ? 'image/png' : 'image/jpeg' });
			const timer = setTimeout(() => leases.delete(token), LEASE_MS);
			timer.unref();
			return {
				url: `${base}/cover/${token}.${ext}`,
				release() {
					clearTimeout(timer);
					leases.delete(token);
				}
			};
		},

		close() {
			server.close();
		}
	};
}
