// Run with:  node --test worker/
// The player opens a path read from an open-rules row, so what it agrees to
// open is pinned down here: only a video, only in the upload's own folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { copyNames, isRecordId, openStoredCopy, sameFolder, storedCopyOf } from './storedcopy.mjs';

const job = (fields = {}) => ({
	destination_path: '\\\\nas\\shared\\testing',
	stored_path: '\\\\nas\\shared\\testing\\clip (2).mp4',
	video_name: 'clip.mp4',
	video_size: 100,
	status: 'done',
	...fields
});

test('a record id is 15 lower-case letters and digits', () => {
	assert.equal(isRecordId('abc123def456ghi'), true);
	assert.equal(isRecordId('ABC123def456ghi'), false);
	assert.equal(isRecordId('abc123'), false);
	assert.equal(isRecordId('../../etc/passwd'), false);
	assert.equal(isRecordId(undefined), false);
});

test('folders compare as written, case and a trailing separator aside', () => {
	assert.equal(sameFolder('\\\\nas\\Shared\\Testing\\', '\\\\nas\\shared\\testing'), true);
	assert.equal(sameFolder('/mnt/user/Shared/x', '/mnt/user/shared/x/'), true);
	assert.equal(sameFolder('\\\\nas\\shared\\testing\\..', '\\\\nas\\shared\\testing'), false);
	assert.equal(sameFolder('', ''), false);
});

test('the recorded path is the copy', () => {
	assert.deepEqual(storedCopyOf(job()), { path: '\\\\nas\\shared\\testing\\clip (2).mp4', guessed: false });
});

test('a copy made before the path was recorded is guessed from the folder and name', () => {
	assert.deepEqual(storedCopyOf(job({ stored_path: '' })), { path: '\\\\nas\\shared\\testing\\clip.mp4', guessed: true });
	assert.deepEqual(storedCopyOf(job({ stored_path: undefined, video_name: '', video: 'clip_x1y2.mp4' })), {
		path: '\\\\nas\\shared\\testing\\clip_x1y2.mp4',
		guessed: true
	});
});

test('nothing to play without a destination, or before the copy', () => {
	assert.deepEqual(storedCopyOf(null), { error: 'no-job' });
	assert.deepEqual(storedCopyOf(job({ stored_path: '', destination_path: '' })), { error: 'not-stored' });
	assert.deepEqual(storedCopyOf(job({ stored_path: '', status: 'stored' })), { error: 'not-stored' });
});

test('a path outside the upload folder, or not a video, is refused', () => {
	assert.deepEqual(storedCopyOf(job({ stored_path: '/config/.worker-config.json' })), { error: 'refused' });
	assert.deepEqual(storedCopyOf(job({ stored_path: '\\\\nas\\shared\\testing\\notes.json' })), { error: 'refused' });
	assert.deepEqual(storedCopyOf(job({ stored_path: '\\\\nas\\shared\\testing\\..\\..\\secret.mp4' })), {
		error: 'refused'
	});
	assert.deepEqual(storedCopyOf(job({ stored_path: '\\\\nas\\shared\\testing\\sub\\clip.mp4' })), { error: 'refused' });
	assert.deepEqual(storedCopyOf(job({ stored_path: '', video_name: '..\\..\\clip.mp4' })), { error: 'refused' });
	assert.deepEqual(storedCopyOf(job({ destination_path: '/config', stored_path: '/config/.worker-config.json' })), {
		error: 'refused'
	});
});

/** A folder holding `files` (name → size), wherever the folder resolves. */
function folder(files, dir = '/mnt/user/shared/testing') {
	const opened = [];
	return {
		opened,
		io: {
			resolve: async () => dir,
			stat: async (path) => {
				opened.push(path);
				const name = path.split(/[\\/]/).pop();
				if (!(name in files)) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
				return { isFile: () => true, size: files[name] };
			}
		}
	};
}

const at = (name) => ({ name, path: join('/mnt/user/shared/testing', name) });

test('copyNames follows the free-name order of the copy', () => {
	assert.deepEqual(copyNames('clip.mp4', 3), ['clip.mp4', 'clip (2).mp4', 'clip (3).mp4']);
	assert.deepEqual(copyNames('a.b.mov', 2), ['a.b.mov', 'a.b (2).mov']);
});

test('a recorded copy opens in the folder as it resolves here, whatever its size', async () => {
	const { io } = folder({ 'clip (2).mp4': 5 });
	assert.deepEqual(await openStoredCopy(job(), io), at('clip (2).mp4'));
	assert.deepEqual(await openStoredCopy(job(), folder({}).io), { error: 'gone' });
});

test('a guessed copy is the file of its name with its size, renamed or not', async () => {
	const files = { 'clip.mp4': 70, 'clip (2).mp4': 100, 'clip (3).mp4': 90 };
	assert.deepEqual(await openStoredCopy(job({ stored_path: '' }), folder(files).io), at('clip (2).mp4'));
	assert.deepEqual(await openStoredCopy(job({ stored_path: '', video_size: 90 }), folder(files).io), at('clip (3).mp4'));
});

test('a lone file under the name itself counts, whatever its size', async () => {
	assert.deepEqual(await openStoredCopy(job({ stored_path: '' }), folder({ 'clip.mp4': 123 }).io), at('clip.mp4'));
	// Not a lone " (2)", though: the name itself went to someone else first.
	assert.deepEqual(await openStoredCopy(job({ stored_path: '' }), folder({ 'clip (2).mp4': 123 }).io), {
		error: 'differs'
	});
});

test('several files of its name and none of its size cannot be told apart', async () => {
	const files = { 'clip.mp4': 70, 'clip (2).mp4': 80 };
	assert.deepEqual(await openStoredCopy(job({ stored_path: '' }), folder(files).io), { error: 'differs' });
	assert.deepEqual(await openStoredCopy(job({ stored_path: '' }), folder({}).io), { error: 'gone' });
});

test('nothing is opened for a refused path, and nothing outside the folder ever', async () => {
	const { io, opened } = folder({ '.worker-config.json': 10 });
	assert.deepEqual(await openStoredCopy(job({ stored_path: '/config/.worker-config.json' }), io), { error: 'refused' });
	assert.deepEqual(opened, []);
	const fine = folder({ 'clip (2).mp4': 5 });
	await openStoredCopy(job(), fine.io);
	assert.ok(fine.opened.every((p) => p.startsWith(join('/mnt/user/shared/testing'))));
});
