import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFolderWatcher } from './folderwatch.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in for fs.watch: remembers each folder's callback, and what was closed. */
function fakeWatch() {
	const live = new Map();
	const closed = [];
	const watch = (path, _opts, onEvent) => {
		if (path.includes('missing')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
		const handle = { close: () => closed.push(path), on: () => handle };
		live.set(path, onEvent);
		return handle;
	};
	return { watch, live, closed, poke: (path) => live.get(path)?.() };
}

describe('makeFolderWatcher', () => {
	it('settles a burst of changes into one call for its kind', async () => {
		const fake = fakeWatch();
		const calls = [];
		const watcher = makeFolderWatcher({ onChange: (kind) => calls.push(kind), quietMs: 40, maxWaitMs: 500, watch: fake.watch });
		watcher.sync('local', ['D:/P', 'D:/P/Cats']);
		watcher.sync('network', ['/mnt/p']);
		fake.poke('D:/P');
		fake.poke('D:/P/Cats');
		await wait(15);
		fake.poke('D:/P/Cats');
		await wait(80);
		assert.deepEqual(calls, ['local']);
		fake.poke('/mnt/p');
		await wait(80);
		assert.deepEqual(calls, ['local', 'network']);
		watcher.close();
	});

	it('does not wait past maxWaitMs while changes keep coming', async () => {
		const fake = fakeWatch();
		const calls = [];
		const watcher = makeFolderWatcher({ onChange: (kind) => calls.push(kind), quietMs: 50, maxWaitMs: 120, watch: fake.watch });
		watcher.sync('local', ['D:/P/Cats']);
		const started = Date.now();
		while (Date.now() - started < 200) {
			fake.poke('D:/P/Cats');
			await wait(20);
		}
		// A copy that never stops still gets scanned along the way.
		assert.ok(calls.length >= 1, `expected a call during the burst, got ${calls.length}`);
		watcher.close();
	});

	it('keeps exactly the folders asked for, per kind, and skips what cannot be watched', () => {
		const fake = fakeWatch();
		const watcher = makeFolderWatcher({ onChange: () => {}, watch: fake.watch });
		watcher.sync('local', ['D:/P', 'D:/P/Cats', 'D:/missing']);
		watcher.sync('network', ['/mnt/p']);
		assert.equal(watcher.count('local'), 2);
		watcher.sync('local', ['D:/P', 'D:/P/Dogs']);
		assert.deepEqual(fake.closed, ['D:/P/Cats']);
		assert.equal(watcher.count('local'), 2);
		assert.equal(watcher.count('network'), 1);
		watcher.sync('local', []);
		assert.equal(watcher.count('local'), 0);
		assert.equal(watcher.count('network'), 1);
		watcher.close();
		assert.equal(watcher.count('network'), 0);
	});

	it('notices a flock.json saved into a real project folder', async () => {
		const root = await mkdtemp(join(tmpdir(), 'flock-watch-'));
		try {
			await mkdir(join(root, 'Cats'));
			const calls = [];
			const watcher = makeFolderWatcher({ onChange: (kind) => calls.push(kind), quietMs: 100 });
			watcher.sync('local', [root, join(root, 'Cats')]);
			await wait(50);
			await writeFile(join(root, 'Cats', 'flock.json'), '{"flock":1}');
			for (let i = 0; i < 40 && calls.length === 0; i++) await wait(50);
			assert.deepEqual(calls, ['local']);
			watcher.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
