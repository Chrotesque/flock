// Run with:  node --test worker/
// The chunk maths is where an off-by-one would hand TikTok a truncated video,
// so it is pinned down here rather than discovered on a real upload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { planChunks, readChunks, mimeFromName, videoMime, MiB, pbDate } from './upload.mjs';

test('a file under 5 MB is one chunk the exact size of the file', () => {
	const plan = planChunks(3 * MiB);
	assert.equal(plan.count, 1);
	assert.equal(plan.chunkSize, 3 * MiB);
	assert.deepEqual(plan.ranges, [{ start: 0, end: 3 * MiB - 1, length: 3 * MiB }]);
});

test('a file between 5 MB and the chunk size is one chunk of its own size', () => {
	const plan = planChunks(10 * MiB);
	assert.equal(plan.count, 1);
	assert.equal(plan.chunkSize, 10 * MiB);
	assert.equal(plan.ranges[0].length, 10 * MiB);
});

test('the last chunk absorbs the remainder instead of becoming a short extra chunk', () => {
	const size = 50 * MiB + 123;
	const plan = planChunks(size);
	assert.equal(plan.chunkSize, 32 * MiB);
	assert.equal(plan.count, 1);
	assert.deepEqual(plan.ranges, [{ start: 0, end: size - 1, length: size }]);

	const bigger = planChunks(70 * MiB);
	assert.equal(bigger.count, 2);
	assert.deepEqual(bigger.ranges[0], { start: 0, end: 32 * MiB - 1, length: 32 * MiB });
	assert.deepEqual(bigger.ranges[1], { start: 32 * MiB, end: 70 * MiB - 1, length: 38 * MiB });
});

test("TikTok's documented example: 50,000,123 bytes in 10,000,000-byte chunks is five", () => {
	const plan = planChunks(50_000_123, 10_000_000);
	assert.equal(plan.count, 5);
	assert.equal(plan.ranges[4].start, 40_000_000);
	assert.equal(plan.ranges[4].end, 50_000_122);
	assert.equal(plan.ranges[4].length, 10_000_123);
});

test('ranges tile the file exactly, whatever the size', () => {
	for (const size of [1, 5 * MiB - 1, 5 * MiB, 32 * MiB, 64 * MiB - 1, 64 * MiB, 1_000_000_007]) {
		const plan = planChunks(size);
		let next = 0;
		for (const range of plan.ranges) {
			assert.equal(range.start, next);
			assert.equal(range.length, range.end - range.start + 1);
			next = range.end + 1;
		}
		assert.equal(next, size);
		// Never past TikTok's cap for the final chunk.
		assert.ok(plan.ranges[plan.ranges.length - 1].length < 128 * MiB);
	}
});

test('readChunks hands back exactly the planned buffers whatever the stream pieces are', async () => {
	const bytes = Buffer.alloc(1000, 0);
	for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
	const ranges = [
		{ start: 0, end: 299, length: 300 },
		{ start: 300, end: 599, length: 300 },
		{ start: 600, end: 999, length: 400 }
	];
	// Pieces that straddle every boundary.
	const pieces = [bytes.subarray(0, 7), bytes.subarray(7, 450), bytes.subarray(450, 999), bytes.subarray(999)];
	const out = [];
	for await (const chunk of readChunks(Readable.from(pieces), ranges)) out.push(chunk);
	assert.equal(out.length, 3);
	assert.deepEqual(out.map((c) => c.length), [300, 300, 400]);
	assert.ok(Buffer.concat(out).equals(bytes));
});

test('readChunks refuses a stream that ends early or runs long', async () => {
	const ranges = [{ start: 0, end: 99, length: 100 }];
	await assert.rejects(
		async () => {
			for await (const _ of readChunks(Readable.from([Buffer.alloc(60)]), ranges)) void _;
		},
		/Short read: got 60 of 100/
	);
	await assert.rejects(
		async () => {
			for await (const _ of readChunks(Readable.from([Buffer.alloc(130)]), ranges)) void _;
		},
		/30 bytes past/
	);
});

test('MIME comes from the extension only when PocketBase reported nothing usable', () => {
	assert.equal(mimeFromName('clip.MOV'), 'video/quicktime');
	assert.equal(mimeFromName('clip.unknown'), 'video/mp4');
	assert.equal(videoMime({ mimeType: 'video/webm' }, 'clip.mp4'), 'video/webm');
	assert.equal(videoMime({ mimeType: 'video/*' }, 'clip.mov'), 'video/quicktime');
	assert.equal(videoMime({ mimeType: 'application/octet-stream' }, 'clip.mp4'), 'video/mp4');
});

test('pbDate is the space-separated UTC form PocketBase compares', () => {
	assert.equal(pbDate('2026-09-06T12:34:56.789Z'), '2026-09-06 12:34:56.789Z');
});
