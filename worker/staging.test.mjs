import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyOf, readStaged, safeFolder, servable, splitTyped, stageFolder, stagedName, stagingNeed } from './staging.mjs';

const now = Date.parse('2026-11-20T12:00:00Z');
const video = (name, modified, size = 100) => ({ name, size, modified, path: String.raw`C:\proj` + '\\' + name });
const row = (over = {}) => ({ local: true, missing: false, archived_at: '', status: 'started', videos: [], staged: null, ...over });

test('stagingNeed picks the newest settled video of an open local project', () => {
	const r = row({ videos: [video('a.mp4', '2026-11-20T10:00:00.000Z'), video('b.mp4', '2026-11-20T11:00:00.000Z')] });
	assert.equal(stagingNeed(r, now).name, 'b.mp4');
});

test('stagingNeed waits while the newest may still be written', () => {
	const r = row({ videos: [video('a.mp4', '2026-11-20T11:59:30.000Z')] });
	assert.equal(stagingNeed(r, now), null);
});

test('stagingNeed leaves sent, dismissed, missing and LAN projects alone', () => {
	const videos = [video('a.mp4', '2026-11-20T10:00:00.000Z')];
	for (const over of [{ status: 'uploaded' }, { status: 'dismissed' }, { missing: true }, { local: false }, { archived_at: 'x' }]) {
		assert.equal(stagingNeed(row({ videos, ...over }), now), null);
	}
});

test('a file copied already is not copied again, a re-export is', () => {
	const v = video('a.mp4', '2026-11-20T10:00:00.000Z');
	const staged = { copies: [{ from: v.path, name: 'a.mp4', size: 100, modified: v.modified, path: 'x/a.mp4' }] };
	assert.equal(stagingNeed(row({ videos: [v], staged }), now), null);
	const again = { ...v, size: 200, modified: '2026-11-20T11:00:00.000Z' };
	assert.equal(stagingNeed(row({ videos: [again], staged }), now), again);
	assert.equal(copyOf(staged, v).name, 'a.mp4');
	assert.equal(copyOf(staged, again), null);
});

test('stagedName: own name first, then _2, _3, never a taken one', () => {
	assert.equal(stagedName('cut.mp4', 0, []), 'cut.mp4');
	assert.equal(stagedName('cut.mp4', 1, ['cut.mp4']), 'cut_2.mp4');
	assert.equal(stagedName('cut.mp4', 1, ['cut.mp4', 'CUT_2.mp4']), 'cut_3.mp4');
	assert.equal(stagedName('other.mov', 2, []), 'other_3.mov');
	assert.equal(stagedName('cut.mp4', 0, ['cut.mp4']), 'cut_2.mp4');
});

test('folders and servable paths', () => {
	const root = String.raw`\\fileserver\media\in`;
	const sep = '\\';
	assert.equal(safeFolder('A: B?.'), 'A_ B_');
	assert.equal(safeFolder(''), 'project');
	const dir = stageFolder(root, 'Game');
	assert.equal(dir, root + sep + 'flock-projects' + sep + 'Game');
	assert.equal(servable(dir + sep + 'a.mp4', root), true);
	assert.equal(servable(dir + sep + '..' + sep + '..' + sep + 'x.mp4', root), false);
	assert.equal(servable(dir + sep + 'a.json', root), false);
	assert.equal(servable(root + sep + 'a.mp4', root), false);
	assert.deepEqual(splitTyped(dir + sep + 'a.mp4'), { dir, name: 'a.mp4' });
});

test('readStaged drops what is not a copy', () => {
	assert.deepEqual(readStaged(null), { copies: [], copying: null, error: '' });
	assert.equal(readStaged({ copies: [{ from: 'x' }, 5] }).copies.length, 0);
});
