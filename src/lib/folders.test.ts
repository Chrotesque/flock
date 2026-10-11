import { describe, expect, it } from 'vitest';
import {
	folderKind,
	folderName,
	importFolder,
	isAbsolutePath,
	legacyWatchKeys,
	migrateWatchFolders,
	parentName,
	resolveIn,
	sameFolder
} from './folders';

describe('folderKind', () => {
	it('reads a UNC path as the network', () => {
		expect(folderKind('\\\\nas\\media\\incoming')).toBe('network');
		expect(folderKind('  \\\\nas\\x  ')).toBe('network');
	});

	it('reads an absolute POSIX path as the network', () => {
		expect(folderKind('/mnt/user/media/x')).toBe('network');
	});

	it('reads a drive path as this PC', () => {
		expect(folderKind('D:\\Videos\\Monetized')).toBe('local');
		expect(folderKind('C:/clips')).toBe('local');
	});
});

describe('folderName and parentName', () => {
	it('names the last part, whatever the separator', () => {
		expect(folderName('\\\\nas\\media\\Monetized\\')).toBe('Monetized');
		expect(folderName('D:/Projects/Non-monetized')).toBe('Non-monetized');
	});

	it('names the folder a file is in', () => {
		expect(parentName('D:\\clips\\a.mp4')).toBe('clips');
		expect(parentName('a.mp4')).toBe('');
	});
});

describe('resolveIn', () => {
	it('puts a bare name in the project folder', () => {
		expect(resolveIn('D:\\Projects\\Cats', 'thumb.png')).toBe('D:\\Projects\\Cats\\thumb.png');
		expect(resolveIn('\\\\nas\\media\\Cats\\', './art/thumb.png')).toBe('\\\\nas\\media\\Cats\\art\\thumb.png');
	});

	it('keeps an absolute path as it is', () => {
		expect(resolveIn('D:\\Projects\\Cats', 'C:\\Users\\me\\thumb.png')).toBe('C:\\Users\\me\\thumb.png');
		expect(resolveIn('D:\\Projects\\Cats', '\\\\nas\\x\\t.png')).toBe('\\\\nas\\x\\t.png');
		expect(resolveIn('D:\\Projects\\Cats', 'file:///C:/t.png')).toBe('file:///C:/t.png');
	});

	it('joins a POSIX folder with slashes', () => {
		expect(resolveIn('/mnt/user/media/Cats', 'thumb.png')).toBe('/mnt/user/media/Cats/thumb.png');
	});

	it('leaves an empty path empty', () => {
		expect(resolveIn('D:\\x', '  ')).toBe('');
	});
});

describe('isAbsolutePath', () => {
	it('knows a quoted "Copy as path" result', () => {
		expect(isAbsolutePath('"C:\\a\\b.png"')).toBe(true);
		expect(isAbsolutePath('b.png')).toBe(false);
	});
});

describe('sameFolder', () => {
	it('ignores case and a trailing separator', () => {
		expect(sameFolder('\\\\nas\\media\\X\\', '\\\\NAS\\Media\\x')).toBe(true);
		expect(sameFolder('D:\\a', 'D:\\b')).toBe(false);
	});
});

describe('migrateWatchFolders', () => {
	let n = 0;
	const id = () => `new${++n}`;

	it('keeps a list that already exists', () => {
		const list = [{ id: 'a', path: 'D:\\x' }];
		expect(migrateWatchFolders({ watchFolders: list, watchFolder: '\\\\nas\\y' }, id)).toEqual(list);
	});

	it('puts the old NAS folder first, then the local ones', () => {
		n = 0;
		const out = migrateWatchFolders(
			{ watchFolder: ' \\\\nas\\media\\in ', localFolders: [{ id: 'l1', path: 'D:\\rec' }, null, { id: 3 }] },
			id
		);
		expect(out).toEqual([
			{ id: 'new1', path: '\\\\nas\\media\\in' },
			{ id: 'l1', path: 'D:\\rec', chosen: true }
		]);
	});

	it('is empty for a row with neither', () => {
		expect(migrateWatchFolders({}, id)).toEqual([]);
	});
});

describe('importFolder', () => {
	const folders = [
		{ id: 'l', path: 'D:\\rec' },
		{ id: 'n1', path: '\\\\nas\\a' },
		{ id: 'n2', path: '\\\\nas\\b' }
	];

	it('takes the chosen network folder', () => {
		expect(importFolder(folders, 'n2')?.id).toBe('n2');
	});

	it('falls back to the first network folder, never a local one', () => {
		expect(importFolder(folders, null)?.id).toBe('n1');
		expect(importFolder(folders, 'l')?.id).toBe('n1');
	});

	it('is null without a network folder', () => {
		expect(importFolder([{ id: 'l', path: 'D:\\rec' }], null)).toBeNull();
	});
});

describe('legacyWatchKeys', () => {
	it('writes what an older worker reads', () => {
		const out = legacyWatchKeys(
			[
				{ id: 'l', path: 'D:\\rec', chosen: true },
				{ id: 'n', path: '\\\\nas\\a' },
				{ id: 'e', path: '  ' }
			],
			null
		);
		expect(out).toEqual({ watchFolder: '\\\\nas\\a', localFolders: [{ id: 'l', path: 'D:\\rec' }] });
	});
});
