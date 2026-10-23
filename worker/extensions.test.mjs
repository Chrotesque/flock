import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionFiles } from './extensions-found.mjs';
import { isExtension } from './extensions.mjs';

test('an extension folder offers its .mjs files in name order, never the tests', () => {
	const dir = mkdtempSync(join(tmpdir(), 'flock-ext-'));
	try {
		for (const name of ['b.mjs', 'a.mjs', 'a.test.mjs', 'notes.md', 'c.js']) writeFileSync(join(dir, name), '');
		assert.deepEqual(extensionFiles(dir), ['a.mjs', 'b.mjs']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	assert.deepEqual(extensionFiles(join(tmpdir(), 'flock-no-such-folder')), []);
	assert.deepEqual(extensionFiles(''), []);
});

test('an extension names itself and can be started; anything else is left out', () => {
	assert.equal(isExtension({ name: 'x', start() {} }), true);
	assert.equal(isExtension({ name: 'x' }), false);
	assert.equal(isExtension({ start() {} }), false);
	assert.equal(isExtension(undefined), false);
});
