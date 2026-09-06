// Plumbing shared by the adapters that hand the bytes over themselves.
//
// YouTube takes one streamed PUT and has its own copy of that in youtube.mjs.
// TikTok wants the file cut into numbered ranges, Instagram one POST with the
// length declared up front, and both refuse a MIME type they do not know — so
// the pieces those two share live here rather than in either adapter.

import { request as httpsRequest } from 'node:https';
import { extname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MIME_BY_EXTENSION = {
	'.mp4': 'video/mp4',
	'.m4v': 'video/mp4',
	'.mov': 'video/quicktime',
	'.webm': 'video/webm',
	'.mkv': 'video/x-matroska',
	'.avi': 'video/x-msvideo',
	'.wmv': 'video/x-ms-wmv',
	'.flv': 'video/x-flv',
	'.mpg': 'video/mpeg',
	'.mpeg': 'video/mpeg',
	'.ts': 'video/mp2t'
};

/** The MIME type a file name implies, or the fallback for an unknown extension. */
export function mimeFromName(name, fallback = 'video/mp4') {
	return MIME_BY_EXTENSION[extname(name || '').toLowerCase()] ?? fallback;
}

/**
 * The type to declare for a job's video.
 *
 * PocketBase reports a real type for a file it stores; a referenced file comes
 * back as `video/*`, which both TikTok and Instagram reject, so the name is
 * what decides then.
 */
export function videoMime(video, name) {
	const reported = String(video?.mimeType || '');
	if (reported && !reported.endsWith('/*') && reported !== 'application/octet-stream') {
		return reported;
	}
	return mimeFromName(name);
}

export const MiB = 1024 * 1024;

/**
 * Cuts a file of `size` bytes into TikTok's chunks.
 *
 * TikTok's rules: a chunk is between 5 MB and 64 MB, the count is the size
 * divided by the chunk size rounded *down*, and the last chunk absorbs the
 * remainder (so it can run to twice the chunk size, under their 128 MB cap
 * for it). A file under 5 MB goes up as one chunk the exact size of the file.
 * Every range is inclusive, ready for a Content-Range header.
 */
export function planChunks(size, chunk = 32 * MiB, min = 5 * MiB) {
	if (!Number.isInteger(size) || size <= 0) throw new Error(`Cannot chunk a file of ${size} bytes`);
	const chunkSize = size < min ? size : Math.min(chunk, size);
	const count = Math.max(1, Math.floor(size / chunkSize));
	const ranges = [];
	for (let i = 0; i < count; i++) {
		const start = i * chunkSize;
		const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
		ranges.push({ start, end, length: end - start + 1 });
	}
	return { chunkSize, count, ranges };
}

/**
 * Yields the stream as Buffers of exactly the planned lengths, in order.
 *
 * Holds one chunk in memory at a time — tens of megabytes, not the file — and
 * refuses to finish quietly if the stream ends early or runs long, because a
 * short read handed to a platform as a complete video is worse than a failure.
 */
export async function* readChunks(stream, ranges) {
	let pending = [];
	let held = 0;
	let index = 0;

	const take = (length) => {
		const out = Buffer.concat(pending, held).subarray(0, length);
		const rest = Buffer.concat(pending, held).subarray(length);
		pending = rest.length > 0 ? [Buffer.from(rest)] : [];
		held = rest.length;
		return Buffer.from(out);
	};

	for await (const piece of stream) {
		const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
		pending.push(chunk);
		held += chunk.length;
		while (index < ranges.length && held >= ranges[index].length) {
			yield take(ranges[index].length);
			index++;
		}
	}

	if (index < ranges.length) {
		const expected = ranges[ranges.length - 1].end + 1;
		const got = ranges.slice(0, index).reduce((sum, r) => sum + r.length, 0) + held;
		throw new Error(`Short read: got ${got} of ${expected} bytes`);
	}
	if (held > 0) throw new Error(`The file ran ${held} bytes past its declared size`);
}

/** Counts bytes through a pipe, reporting every ten percent. */
export function progressMeter(size, onProgress) {
	let sent = 0;
	let reported = 0;
	return new Transform({
		transform(chunk, _enc, done) {
			sent += chunk.length;
			const pct = Math.floor((sent / size) * 100);
			if (pct >= reported + 10) {
				reported = pct;
				onProgress(pct);
			}
			done(null, chunk);
		}
	});
}

/**
 * Sends a stream as one request with its length declared.
 *
 * node:https rather than fetch for the same reason youtube.mjs uses it: a
 * stream body through fetch goes out chunked, and an upload endpoint that
 * wants the size up front refuses that. Resolves with the status and body
 * text whatever the status — the caller decides what counts as success.
 */
export function streamRequest({ url, method = 'POST', headers = {}, body, size, onProgress }) {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const req = httpsRequest(
			{
				hostname: target.hostname,
				port: target.port || 443,
				path: target.pathname + target.search,
				method,
				headers: { 'Content-Length': size, ...headers }
			},
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => (text += chunk));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
			}
		);
		req.on('error', reject);
		const meter = onProgress ? progressMeter(size, onProgress) : null;
		pipeline(...(meter ? [body, meter, req] : [body, req])).catch(reject);
	});
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Milliseconds until an instant; zero or negative once it has passed. */
export function msUntil(instant) {
	const at = Date.parse(instant);
	return Number.isFinite(at) ? at - Date.now() : 0;
}

/** "2026-09-06 12:00:00.000Z", the form PocketBase compares dates in. */
export function pbDate(date) {
	return new Date(date).toISOString().replace('T', ' ');
}
