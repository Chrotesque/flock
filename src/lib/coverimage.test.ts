import { describe, expect, it } from 'vitest';
import { acceptedTypes, imageFits, imageProblem, largestAccepted } from './coverimage';

const MB = 1024 * 1024;

describe('imageProblem', () => {
	it('passes an image both platforms take', () => {
		const png = { type: 'image/png', size: 1 * MB };
		expect(imageProblem(png, 'youtube')).toBe('');
		expect(imageProblem(png, 'instagram')).toBe('');
	});

	it('holds each platform to its own cap', () => {
		const big = { type: 'image/jpeg', size: 5 * MB };
		expect(imageProblem(big, 'youtube')).toBe('over its 2 MB limit');
		expect(imageProblem(big, 'instagram')).toBe('');
	});

	it('holds each platform to its own formats', () => {
		const webp = { type: 'image/webp', size: 100_000 };
		expect(imageProblem(webp, 'youtube')).toBe('');
		expect(imageProblem(webp, 'instagram')).toBe('JPEG or PNG only');
	});
});

describe('imageFits', () => {
	it('is false without an image', () => {
		expect(imageFits(null, 'youtube')).toBe(false);
	});
});

describe('what the picker accepts', () => {
	it('is the union of the platforms served', () => {
		expect(acceptedTypes(['instagram'])).toEqual(['image/jpeg', 'image/png']);
		expect(acceptedTypes(['youtube', 'instagram'])).toHaveLength(4);
		expect(largestAccepted(['youtube'])).toBe(2 * MB);
		expect(largestAccepted(['youtube', 'instagram'])).toBe(8 * MB);
	});

	it('falls back to both when none is active', () => {
		expect(largestAccepted([])).toBe(8 * MB);
	});
});
