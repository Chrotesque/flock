import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchCase, uncToUnraid } from './paths.mjs';

/** A fake disk: the set of paths that exist, case-sensitive like Linux. */
function fakeDisk(paths) {
	const all = new Set(['/']);
	for (const path of paths) {
		let current = '';
		for (const part of path.split('/').filter(Boolean)) {
			current += `/${part}`;
			all.add(current);
		}
	}
	return {
		exists: async (path) => all.has(path),
		list: async (dir) => {
			if (!all.has(dir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			const prefix = dir === '/' ? '/' : `${dir}/`;
			return [...all]
				.filter((p) => p.startsWith(prefix) && p !== dir && !p.slice(prefix.length).includes('/'))
				.map((p) => p.slice(prefix.length));
		}
	};
}

describe('uncToUnraid', () => {
	it('maps a share and its folders under /mnt/user', () => {
		assert.equal(uncToUnraid('\\\\nas\\shared\\flock-incoming'), '/mnt/user/shared/flock-incoming');
		assert.equal(uncToUnraid('\\\\nas\\shared'), '/mnt/user/shared');
	});

	it('leaves anything that is not a UNC path alone', () => {
		assert.equal(uncToUnraid('D:\\Echo'), null);
		assert.equal(uncToUnraid('/mnt/user/x'), null);
	});
});

describe('matchCase', () => {
	const disk = fakeDisk(['/mnt/user/Shared/flock-incoming/a.mp4', '/mnt/user/Shared/Testing']);

	it('keeps a path spelled as on disk', async () => {
		assert.equal(await matchCase('/mnt/user/Shared/Testing', disk), '/mnt/user/Shared/Testing');
	});

	it('finds a share whose case differs from the UNC path', async () => {
		assert.equal(await matchCase('/mnt/user/shared/flock-incoming', disk), '/mnt/user/Shared/flock-incoming');
	});

	it('matches every part, files included', async () => {
		assert.equal(
			await matchCase('/MNT/user/SHARED/Flock-Incoming/A.MP4', disk),
			'/mnt/user/Shared/flock-incoming/a.mp4'
		);
	});

	it('prefers the exact spelling when two differ only in case', async () => {
		const both = fakeDisk(['/mnt/user/Shared/x', '/mnt/user/shared/y']);
		assert.equal(await matchCase('/mnt/user/shared/y', both), '/mnt/user/shared/y');
		assert.equal(await matchCase('/mnt/user/Shared/x', both), '/mnt/user/Shared/x');
	});

	it('gives null when a part is missing in any case', async () => {
		assert.equal(await matchCase('/mnt/user/shared/nothing', disk), null);
		assert.equal(await matchCase('/mnt/other/x', disk), null);
	});

	it('only takes absolute POSIX paths', async () => {
		assert.equal(await matchCase('\\\\nas\\shared', disk), null);
	});
});
