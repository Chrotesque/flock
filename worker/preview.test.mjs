// Run with:  node --test worker/
// A player seeks by asking for byte ranges, so a range answered one byte off
// is a video that stutters or will not start. The parsing is pinned down
// here, and the server is run against a real file to check what it sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRange, startPreviewServer } from './preview.mjs';

test('no Range header is the whole file', () => {
	assert.deepEqual(parseRange(undefined, 100), { status: 200 });
	assert.deepEqual(parseRange('', 100), { status: 200 });
});

test('an open-ended range runs to the last byte', () => {
	assert.deepEqual(parseRange('bytes=0-', 100), { status: 206, start: 0, end: 99 });
	assert.deepEqual(parseRange('bytes=40-', 100), { status: 206, start: 40, end: 99 });
});

test('a closed range is inclusive, and one past the end is cut to the last byte', () => {
	assert.deepEqual(parseRange('bytes=10-19', 100), { status: 206, start: 10, end: 19 });
	assert.deepEqual(parseRange('bytes=90-500', 100), { status: 206, start: 90, end: 99 });
});

test('a suffix range is the last n bytes, or all of a shorter file', () => {
	assert.deepEqual(parseRange('bytes=-10', 100), { status: 206, start: 90, end: 99 });
	assert.deepEqual(parseRange('bytes=-500', 100), { status: 206, start: 0, end: 99 });
});

test('a range starting at or past the end cannot be satisfied', () => {
	assert.deepEqual(parseRange('bytes=100-', 100), { status: 416 });
	assert.deepEqual(parseRange('bytes=-0', 100), { status: 416 });
});

test('anything else is ignored in favour of the whole file', () => {
	assert.deepEqual(parseRange('bytes=0-1,5-6', 100), { status: 200 });
	assert.deepEqual(parseRange('bytes=20-10', 100), { status: 200 });
	assert.deepEqual(parseRange('items=0-5', 100), { status: 200 });
	assert.deepEqual(parseRange('bytes=-', 100), { status: 200 });
});

test('the server streams listed files by range and refuses everything else', async (t) => {
	const dir = await mkdtemp(join(tmpdir(), 'flock-preview-'));
	const path = join(dir, 'clip.mp4');
	const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
	await writeFile(path, bytes);
	const listed = new Map([[path, { name: 'clip.mp4', path, size: bytes.length }]]);

	const server = await new Promise((resolve) => {
		const s = startPreviewServer({
			port: 0,
			lookup: (source, asked) => (source === 'local' ? (listed.get(asked) ?? null) : null),
			log: () => {},
			onListening: () => resolve(s)
		});
	});
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		await rm(dir, { recursive: true, force: true });
	});

	const base = `http://127.0.0.1:${server.address().port}`;
	const query = (source, p) => new URLSearchParams({ source, path: p }).toString();

	const check = await fetch(`${base}/check?${query('local', path)}`);
	assert.equal(check.status, 200);
	assert.equal(check.headers.get('access-control-allow-origin'), '*');
	assert.deepEqual(await check.json(), { ok: true, name: 'clip.mp4', size: 256 });

	const part = await fetch(`${base}/video?${query('local', path)}`, { headers: { Range: 'bytes=10-19' } });
	assert.equal(part.status, 206);
	assert.equal(part.headers.get('content-range'), 'bytes 10-19/256');
	assert.equal(part.headers.get('content-type'), 'video/mp4');
	assert.equal(part.headers.get('access-control-allow-origin'), null);
	assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(10, 20));

	const whole = await fetch(`${base}/video?${query('local', path)}`);
	assert.equal(whole.status, 200);
	assert.equal(whole.headers.get('accept-ranges'), 'bytes');
	assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes);

	const past = await fetch(`${base}/video?${query('local', path)}`, { headers: { Range: 'bytes=300-' } });
	assert.equal(past.status, 416);
	assert.equal(past.headers.get('content-range'), 'bytes */256');
	await past.arrayBuffer();

	// Listed under the other list, or not listed at all: nothing is opened.
	const wrongList = await fetch(`${base}/check?${query('nas', path)}`);
	assert.deepEqual(await wrongList.json(), { ok: false, error: 'not-listed' });
	const unlisted = await fetch(`${base}/video?${query('local', join(dir, '..', 'other.mp4'))}`);
	assert.equal(unlisted.status, 404);
	await unlisted.arrayBuffer();

	// Listed once, deleted since.
	await rm(path);
	const gone = await fetch(`${base}/check?${query('local', path)}`);
	assert.deepEqual(await gone.json(), { ok: false, error: 'gone' });
});
