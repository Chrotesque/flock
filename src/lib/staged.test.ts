import { describe, expect, it } from 'vitest';
import { readStaged, stagedIndex, stagedWords } from './staged';

const file = { name: 'cut.mp4', path: 'C:/p/cut.mp4', size: 10, modified: '2026-11-20T10:00:00.000Z' };
const copy = { from: file.path, name: 'cut_2.mp4', size: 10, modified: file.modified, path: '//nas/in/flock-projects/p/cut_2.mp4', at: '' };

describe('staged copies', () => {
	it('reads only whole copies', () => {
		expect(readStaged(null)).toEqual({ copies: [], copying: null, error: '' });
		expect(readStaged({ copies: [{ from: 'x' }, copy] }).copies).toEqual([copy]);
	});

	it('finds the copy of exactly this file', () => {
		const staged = readStaged({ copies: [copy] });
		expect(stagedIndex(staged, file)).toBe(0);
		expect(stagedIndex(staged, { ...file, size: 11 })).toBe(-1);
		expect(stagedIndex(staged, { ...file, modified: '2026-11-20T11:00:00.000Z' })).toBe(-1);
	});

	it('says where the newest video stands', () => {
		expect(stagedWords(readStaged({ copies: [copy] }), file)).toBe('cut.mp4 is on the NAS as cut_2.mp4.');
		expect(stagedWords(readStaged({ copying: { from: file.path } }), file)).toBe('Copying cut.mp4 to the NAS…');
		expect(stagedWords(readStaged({ error: 'no share' }), file)).toMatch(/failed: no share/);
		expect(stagedWords(readStaged(null), undefined)).toBe('');
	});
});
