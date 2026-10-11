import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import {
	archiveManifest,
	canonical,
	detachedKey,
	isUploadedName,
	planProjectWrites,
	projectKey,
	scanProjectRoot,
	uploadedName
} from './projects.mjs';
import { readWatchConfig, folderKind } from './folders.mjs';
import { scanFolders, typedJoin, published } from './watch.mjs';

describe('folderKind', () => {
	it('splits network paths from the PC', () => {
		assert.equal(folderKind('\\\\nas\\media\\x'), 'network');
		assert.equal(folderKind('/mnt/user/media'), 'network');
		assert.equal(folderKind('D:\\Projects'), 'local');
		assert.equal(folderKind(undefined), 'local');
	});
});

describe('readWatchConfig', () => {
	it('reads the merged lists, by kind', () => {
		const out = readWatchConfig({
			watchFolders: [
				{ id: 'l', path: 'D:\\rec' },
				{ id: 'a', path: '\\\\nas\\a' },
				{ id: 'b', path: ' \\\\nas\\b ' },
				{ id: 'dup', path: '\\\\NAS\\A' },
				{ id: 'e', path: '' }
			],
			importFolderId: 'b',
			projectFolders: [{ id: 'p', path: 'D:\\Projects\\Monetized' }, { id: 'q', path: '\\\\nas\\projects' }]
		});
		assert.deepEqual(out, {
			network: ['\\\\nas\\a', '\\\\nas\\b'],
			local: ['D:\\rec'],
			importTo: '\\\\nas\\b',
			projects: { network: ['\\\\nas\\projects'], local: ['D:\\Projects\\Monetized'] }
		});
	});

	it('copies local picks into the first network folder when none is chosen', () => {
		const out = readWatchConfig({ watchFolders: [{ id: 'l', path: 'D:\\x' }, { id: 'n', path: '\\\\nas\\in' }], importFolderId: 'l' });
		assert.equal(out.importTo, '\\\\nas\\in');
	});

	it('reads a row from before the lists merged', () => {
		const out = readWatchConfig({ watchFolder: '\\\\nas\\in', localFolders: [{ id: 'l', path: 'D:\\rec' }] });
		assert.deepEqual(out.network, ['\\\\nas\\in']);
		assert.deepEqual(out.local, ['D:\\rec']);
		assert.equal(out.importTo, '\\\\nas\\in');
		assert.deepEqual(out.projects, { network: [], local: [] });
	});

	it('copes with no row at all', () => {
		assert.deepEqual(readWatchConfig(null), { network: [], local: [], importTo: '', projects: { network: [], local: [] } });
	});
});

describe('typedJoin', () => {
	it('joins a UNC folder with backslashes on any machine', () => {
		assert.equal(typedJoin('\\\\nas\\media\\in\\', 'Cats', 'a.mp4'), '\\\\nas\\media\\in\\Cats\\a.mp4');
	});
});

describe('scanning a project folder', () => {
	let root;

	before(async () => {
		root = await mkdtemp(join(tmpdir(), 'flock-projects-'));
		// A project with flock.json and two videos, one still empty.
		await mkdir(join(root, 'Cats'));
		await writeFile(join(root, 'Cats', 'flock.json'), '\uFEFF{"flock": 1, "youtube": {"title": "Cats"}}');
		await writeFile(join(root, 'Cats', 'final.mp4'), 'x'.repeat(10));
		await writeFile(join(root, 'Cats', 'copying.mp4'), '');
		await writeFile(join(root, 'Cats', 'notes.txt'), 'hi');
		// A project whose file has another name.
		await mkdir(join(root, 'Dogs'));
		await writeFile(join(root, 'Dogs', 'upload.json'), '{ "flock": 1 }');
		await writeFile(join(root, 'Dogs', 'project.json'), '{ "name": "editor state" }');
		// Not a project: JSON that is not flock's.
		await mkdir(join(root, 'Editing'));
		await writeFile(join(root, 'Editing', 'draft_content.json'), '{"tracks": []}');
		await writeFile(join(root, 'Editing', 'raw.mov'), 'x');
		// Not a project: nothing at all, and a hidden folder.
		await mkdir(join(root, 'Empty'));
		await mkdir(join(root, '.trash'));
		await writeFile(join(root, '.trash', 'flock.json'), '{"flock":1}');
		// A broken flock.json still makes a project, so it can be reported.
		await mkdir(join(root, 'Broken'));
		await writeFile(join(root, 'Broken', 'flock.json'), '{"flock": 1, "youtube": {');
		// Sent: the renamed file, flock block and all, is not a project.
		await mkdir(join(root, 'Sent'));
		await writeFile(join(root, 'Sent', 'flock_uploaded.json'), '{"flock": 1}');
		await writeFile(join(root, 'Sent', 'final.mp4'), 'x');
		// Sent once, and a new flock.json written since: a project again.
		await mkdir(join(root, 'Again'));
		await writeFile(join(root, 'Again', 'flock_uploaded.json'), '{"flock": 1, "brand": "old"}');
		await writeFile(join(root, 'Again', 'flock.json'), '{"flock": 1, "brand": "new"}');
		await utimes(join(root, 'Cats', 'final.mp4'), new Date('2026-10-01'), new Date('2026-10-01'));
	});

	after(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('finds the subfolders holding a flock JSON, and their videos', async () => {
		const scan = await scanProjectRoot(root);
		assert.equal(scan.error, undefined);
		const byName = Object.fromEntries(scan.projects.map((p) => [p.name, p]));
		assert.deepEqual(Object.keys(byName).sort(), ['Again', 'Broken', 'Cats', 'Dogs']);
		assert.equal(byName.Again.manifest, '{"flock": 1, "brand": "new"}');

		assert.equal(byName.Cats.manifestName, 'flock.json');
		assert.equal(byName.Cats.manifest, '{"flock": 1, "youtube": {"title": "Cats"}}');
		assert.equal(byName.Cats.path, join(root, 'Cats'));
		assert.deepEqual(
			byName.Cats.videos.map(published),
			[{ name: 'final.mp4', size: 10, modified: '2026-10-01T00:00:00.000Z', path: join(root, 'Cats', 'final.mp4') }]
		);
		assert.equal(byName.Cats.videos[0].opened, join(root, 'Cats', 'final.mp4'));

		assert.equal(byName.Dogs.manifestName, 'upload.json');
		assert.equal(byName.Broken.manifest, '{"flock": 1, "youtube": {');
	});

	it('says why a folder cannot be read', async () => {
		const scan = await scanProjectRoot(join(root, 'nope'));
		assert.match(scan.error, /^Project folder not found: /);
		assert.deepEqual(scan.projects, []);
	});

	it('pools watch folders and names files the typed way', async () => {
		const index = await scanFolders([join(root, 'Editing'), join(root, 'Editing'), join(root, 'gone')]);
		assert.deepEqual(index.files.map((f) => f.name), ['raw.mov']);
		assert.equal(index.folders.length, 3);
		assert.match(index.folders[2].error, /^Folder not found: /);
	});
});

describe('planProjectWrites', () => {
	const project = (patch = {}) => ({
		path: 'D:\\P\\Cats',
		name: 'Cats',
		manifest: '{"flock":1}',
		manifestName: 'flock.json',
		manifestModified: '2026-10-11T10:00:00.000Z',
		error: '',
		videos: [{ name: 'a.mp4', size: 3, modified: 'm', path: 'D:\\P\\Cats\\a.mp4', opened: 'D:\\P\\Cats\\a.mp4' }],
		...patch
	});
	const rowOf = (data, patch = {}) => ({ id: 'r1', ...data, ...patch });

	it('creates a row for a new project, without the path that only works here', () => {
		const plan = planProjectWrites([], [{ folder: 'D:\\P', projects: [project()] }], true);
		assert.equal(plan.create.length, 1);
		assert.deepEqual(plan.create[0], {
			key: 'd:\\p\\cats',
			path: 'D:\\P\\Cats',
			name: 'Cats',
			root: 'D:\\P',
			local: true,
			manifest: '{"flock":1}',
			manifest_name: 'flock.json',
			manifest_modified: '2026-10-11T10:00:00.000Z',
			videos: [{ name: 'a.mp4', size: 3, modified: 'm', path: 'D:\\P\\Cats\\a.mp4' }],
			missing: false,
			error: ''
		});
		assert.deepEqual(plan.update, []);
	});

	it('writes nothing for a project that did not change', () => {
		const data = planProjectWrites([], [{ folder: 'D:\\P', projects: [project()] }], true).create[0];
		// PocketBase hands the json back with its keys sorted.
		const stored = rowOf({ ...data, videos: JSON.parse(canonical(data.videos)) });
		const plan = planProjectWrites([stored], [{ folder: 'D:\\P', projects: [project()] }], true);
		assert.deepEqual(plan, { create: [], update: [] });
	});

	it('patches a project whose file or videos changed', () => {
		const data = planProjectWrites([], [{ folder: 'D:\\P', projects: [project()] }], true).create[0];
		const stored = rowOf(data);
		const changed = project({ manifest: '{"flock":1,"brand":"x"}', videos: [] });
		const plan = planProjectWrites([stored], [{ folder: 'D:\\P', projects: [changed] }], true);
		assert.equal(plan.update.length, 1);
		assert.equal(plan.update[0].id, 'r1');
		assert.equal(plan.update[0].data.manifest, '{"flock":1,"brand":"x"}');
		assert.deepEqual(plan.update[0].data.videos, []);
	});

	it('marks a project gone only under a folder read cleanly, of its own kind', () => {
		const stored = [
			{ id: 'gone', key: 'd:\\p\\old', root: 'D:\\P', local: true, missing: false },
			{ id: 'already', key: 'd:\\p\\older', root: 'D:\\P', local: true, missing: true },
			{ id: 'unread', key: 'd:\\q\\x', root: 'D:\\Q', local: true, missing: false },
			{ id: 'lan', key: '\\\\nas\\p\\x', root: '\\\\nas\\p', local: false, missing: false }
		];
		const plan = planProjectWrites(
			stored,
			[
				{ folder: 'd:\\p\\', projects: [] },
				{ folder: 'D:\\Q', error: 'Cannot read', projects: [] }
			],
			true
		);
		assert.deepEqual(plan.update, [{ id: 'gone', data: { missing: true } }]);
	});

	it('brings back a project that was gone', () => {
		const data = planProjectWrites([], [{ folder: 'D:\\P', projects: [project()] }], true).create[0];
		const plan = planProjectWrites([rowOf(data, { missing: true })], [{ folder: 'D:\\P', projects: [project()] }], true);
		assert.equal(plan.update[0].data.missing, false);
	});

	it('leaves a row whose file was renamed alone, and lets a new file there be a new project', () => {
		const sent = { id: 'old', key: '\\nas\p\cats#old', root: '\\nas\p', local: false, missing: false, archived_at: '2026-10-11 20:00:00.000Z' };
		const plan = planProjectWrites([sent], [{ folder: '\\nas\p', projects: [project({ path: '\\nas\p\cats' })] }], false);
		assert.equal(plan.create.length, 1);
		assert.equal(plan.create[0].key, '\\nas\p\cats');
		assert.deepEqual(plan.update, []);
	});

	it('keys a project by its path, whatever the case', () => {
		assert.equal(projectKey('\\\\NAS\\P\\Cats\\'), '\\\\nas\\p\\cats');
	});
});

describe('renaming a sent project file', () => {
	it('knows a renamed file by its name', () => {
		assert.equal(isUploadedName('flock_uploaded.json'), true);
		assert.equal(isUploadedName('Flock_Uploaded-3.JSON'), true);
		assert.equal(isUploadedName('flock.json'), false);
		assert.equal(isUploadedName('uploaded.json'), false);
	});

	it('picks a free name', () => {
		assert.equal(uploadedName('flock.json', []), 'flock_uploaded.json');
		assert.equal(uploadedName('flock.json', ['FLOCK_uploaded.json', 'flock_uploaded-2.json']), 'flock_uploaded-3.json');
		assert.equal(uploadedName('upload.json', ['flock.json']), 'upload_uploaded.json');
	});

	it('renames the file and keeps what it holds', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'flock-archive-'));
		try {
			await writeFile(join(dir, 'flock.json'), '{"flock": 1, "brand": "x"}');
			await writeFile(join(dir, 'flock_uploaded.json'), '{"flock": 1, "brand": "earlier"}');
			assert.deepEqual(await archiveManifest(dir, 'flock.json'), { renamed: 'flock_uploaded-2.json' });
			assert.deepEqual((await readdir(dir)).sort(), ['flock_uploaded-2.json', 'flock_uploaded.json']);
			assert.equal(await readFile(join(dir, 'flock_uploaded-2.json'), 'utf8'), '{"flock": 1, "brand": "x"}');
			assert.deepEqual(await archiveManifest(dir, 'flock.json'), { gone: true });
			await assert.rejects(archiveManifest(join(dir, 'nope'), 'flock.json'));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('detaches the key from the folder', () => {
		assert.equal(detachedKey({ id: 'abc', key: 'd:\\p\\cats' }), 'd:\\p\\cats#abc');
	});
});
