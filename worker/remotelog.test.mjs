import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepeatFilter, makeRemoteLog, redact } from './remotelog.mjs';

test('a repeated top-level line is written once per window', () => {
	let now = 0;
	const keep = makeRepeatFilter(1000, () => now);
	assert.equal(keep('watch folder: 3 video(s)'), true);
	now = 500;
	assert.equal(keep('watch folder: 3 video(s)'), false);
	assert.equal(keep('watch folder: 4 video(s)'), true);
	now = 1000;
	assert.equal(keep('watch folder: 3 video(s)'), true);
});

test('indented lines are always written', () => {
	const keep = makeRepeatFilter(1000, () => 0);
	assert.equal(keep('  10%'), true);
	assert.equal(keep('  10%'), true);
});

test('redact strips tokens in queries, JSON and headers', () => {
	assert.equal(redact('GET /me?fields=x&access_token=IGQabc123&y=1'), 'GET /me?fields=x&access_token=…&y=1');
	assert.equal(redact('{"refresh_token":"1//0abc"}'), '{"refresh_token":"…"}');
	assert.equal(redact('Authorization: Bearer ya29.a0AfH6SMB'), 'Authorization: Bearer …');
	assert.equal(redact('thumbnail set (120 KB)'), 'thumbnail set (120 KB)');
});

test('lines pushed before PocketBase is known are written in order once attached', async () => {
	const written = [];
	const log = makeRemoteLog({ run: 'r1', warn: () => {} });
	log.push('first');
	log.push('  second');
	log.attach({
		appendWorkerLog: async (row) => written.push(row),
		pruneWorkerLog: async () => {}
	});
	await log.flush();
	assert.deepEqual(written, [
		{ message: 'first', run: 'r1' },
		{ message: '  second', run: 'r1' }
	]);
});

test('a PocketBase without the collection stops the copy, not the worker', async () => {
	let warned = 0;
	let calls = 0;
	const log = makeRemoteLog({ run: 'r1', warn: () => warned++ });
	log.attach({
		appendWorkerLog: async () => {
			calls++;
			throw new Error('POST /api/collections/worker_log/records -> 404\n{}');
		},
		pruneWorkerLog: async () => {}
	});
	log.push('a');
	await log.flush();
	log.push('b');
	await log.flush();
	assert.equal(calls, 1);
	assert.equal(warned, 1);
});

test('a failed write keeps the line for the next attempt', async () => {
	const written = [];
	let fail = true;
	const log = makeRemoteLog({ run: 'r1', warn: () => {} });
	log.attach({
		appendWorkerLog: async (row) => {
			if (fail) throw new Error('Cannot reach PocketBase');
			written.push(row.message);
		},
		pruneWorkerLog: async () => {}
	});
	log.push('kept');
	await log.flush();
	assert.deepEqual(written, []);
	fail = false;
	await log.flush();
	assert.deepEqual(written, ['kept']);
});
