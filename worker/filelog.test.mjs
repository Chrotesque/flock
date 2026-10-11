// Run in its own process by node --test, so patching console here touches
// nothing else.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logToFile } from './filelog.mjs';

let dir;
let path;
const quiet = { log: console.log, warn: console.warn, error: console.error };

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'flock-filelog-'));
	path = join(dir, 'worker.log');
	// The originals the patch calls through to, silenced for the test.
	console.log = console.warn = console.error = () => {};
	logToFile(path, { maxBytes: 200 });
});

after(async () => {
	Object.assign(console, quiet);
	await rm(dir, { recursive: true, force: true });
});

describe('logToFile', () => {
	it('writes every console line, dated', async () => {
		console.log('started %s', 'here');
		console.error('stopped:', 'no config');
		const text = await readFile(path, 'utf8');
		assert.match(text, /^\d{4}-\d\d-\d\dT[\d:.]+Z started here\n/);
		assert.match(text, /Z stopped: no config\n$/);
	});

	it('moves a full file to .old and starts again', async () => {
		for (let i = 0; i < 10; i++) console.log(`line ${i} ${'x'.repeat(30)}`);
		assert.ok(existsSync(`${path}.old`));
		const text = await readFile(path, 'utf8');
		assert.ok(Buffer.byteLength(text) <= 200);
		assert.match(text, /line 9/);
	});
});
