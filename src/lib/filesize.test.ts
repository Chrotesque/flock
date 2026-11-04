import { describe, expect, it } from 'vitest';
import { FILE_LIMITS, sizeProblems, sizeWords } from './filesize';

describe('sizeProblems', () => {
	it('refuses an Instagram reel over 300 MB', () => {
		const [problem] = sizeProblems('instagram', 371_626_803);
		expect(problem).toContain('372 MB');
		expect(problem).toContain('up to 300 MB');
	});

	it('takes a file at the limit, and one of unknown size', () => {
		expect(sizeProblems('instagram', FILE_LIMITS.instagram!)).toEqual([]);
		expect(sizeProblems('instagram', 0)).toEqual([]);
	});

	it('names no limit for Facebook', () => {
		expect(sizeProblems('facebook', 50 * 1000 ** 3)).toEqual([]);
	});

	it('refuses TikTok over 4 GB', () => {
		expect(sizeProblems('tiktok', 3 * 1024 ** 3)).toEqual([]);
		expect(sizeProblems('tiktok', 5 * 1024 ** 3)[0]).toContain('TikTok');
	});
});

describe('sizeWords', () => {
	it('reads MB below a gigabyte and GB from there', () => {
		expect(sizeWords(300_000_000)).toBe('300 MB');
		expect(sizeWords(4 * 1024 ** 3)).toBe('4.3 GB');
	});
});
