import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, truncate, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMAGE_MAX_BYTES, imageType, localPath, readLocalImage } from './localfile.mjs';

describe('localPath', () => {
	it('drops the quotes of "Copy as path"', () => {
		assert.equal(localPath('  "C:\\Users\\me\\a.png" '), 'C:\\Users\\me\\a.png');
	});

	it('expands a leading ~ to the home folder', () => {
		assert.equal(localPath('~/Pictures/a.png', '/home/me'), join('/home/me', 'Pictures/a.png'));
		assert.equal(localPath('~x/a.png', '/home/me'), '~x/a.png');
	});

	it('reads a file:// address', () => {
		const path = join(tmpdir(), 'a.png');
		assert.equal(localPath(pathToFileURL(path).href), path);
	});
});

describe('imageType', () => {
	it('types images by extension, in any case', () => {
		assert.equal(imageType('x.JPG'), 'image/jpeg');
		assert.equal(imageType('x.webp'), 'image/webp');
		assert.equal(imageType('x.txt'), null);
		assert.equal(imageType('png'), null);
	});
});

describe('readLocalImage', () => {
	let dir;
	before(async () => {
		dir = await mkdtemp(join(tmpdir(), 'flock-localfile-'));
		await writeFile(join(dir, 'thumb.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		await writeFile(join(dir, 'notes.txt'), 'secret');
		await writeFile(join(dir, 'empty.png'), '');
		await writeFile(join(dir, 'huge.png'), '');
		await truncate(join(dir, 'huge.png'), IMAGE_MAX_BYTES + 1);
		await mkdir(join(dir, 'folder.png'));
	});
	after(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('reads an image with its name and type', async () => {
		const image = await readLocalImage(join(dir, 'thumb.png'));
		assert.equal(image.name, 'thumb.png');
		assert.equal(image.type, 'image/png');
		assert.equal(image.bytes.length, 4);
	});

	it('refuses anything that is not an image, before touching it', async () => {
		await assert.rejects(readLocalImage(join(dir, 'notes.txt')), /Not an image/);
	});

	it('refuses a relative path', async () => {
		await assert.rejects(readLocalImage('thumb.png'), /Not a full path/);
	});

	it('says when the file is missing, empty, too large or a folder', async () => {
		await assert.rejects(readLocalImage(join(dir, 'gone.png')), /Not found/);
		await assert.rejects(readLocalImage(join(dir, 'empty.png')), /empty/);
		await assert.rejects(readLocalImage(join(dir, 'huge.png')), /over the 8 MB/);
		await assert.rejects(readLocalImage(join(dir, 'folder.png')), /Not a file/);
	});

	it('refuses an empty path', async () => {
		await assert.rejects(readLocalImage('  '), /No path/);
	});
});
