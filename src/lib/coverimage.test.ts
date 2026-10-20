import { describe, expect, it } from 'vitest';
import { acceptedTypes, coverAt, imageFits, imageProblem, isImagePlatform, largestAccepted, withCoverAt } from './coverimage';

const MB = 1024 * 1024;

describe('imageProblem', () => {
	it("passes an image Instagram takes", () => {
		expect(imageProblem({ type: 'image/png', size: 1 * MB }, 'instagram')).toBe('');
		expect(imageProblem({ type: 'image/jpeg', size: 5 * MB }, 'instagram')).toBe('');
	});

	it('holds it to its cap', () => {
		expect(imageProblem({ type: 'image/jpeg', size: 9 * MB }, 'instagram')).toBe('over its 8 MB limit');
	});

	it('holds it to its formats', () => {
		expect(imageProblem({ type: 'image/webp', size: 100_000 }, 'instagram')).toBe('JPEG or PNG only');
	});
});

describe('imageFits', () => {
	it('is false without an image', () => {
		expect(imageFits(null, 'instagram')).toBe(false);
	});

	it('holds each platform to its own cap', () => {
		const nine = { type: 'image/jpeg', size: 9 * MB };
		expect(imageFits(nine, 'instagram')).toBe(false);
		expect(imageFits(nine, 'facebook')).toBe(true);
		expect(imageProblem({ type: 'image/png', size: 11 * MB }, 'facebook')).toBe('over its 10 MB limit');
	});
});

describe('what the picker accepts', () => {
	it('is what the platforms served take', () => {
		expect(acceptedTypes(['instagram'])).toEqual(['image/jpeg', 'image/png']);
		expect(largestAccepted(['instagram'])).toBe(8 * MB);
		expect(largestAccepted(['instagram', 'facebook'])).toBe(10 * MB);
	});

	it('falls back to every image platform when none is active', () => {
		expect(acceptedTypes([])).toEqual(['image/jpeg', 'image/png']);
		expect(largestAccepted([])).toBe(10 * MB);
	});
});

describe("TikTok's cover image", () => {
	it('takes JPEG or PNG up to 10 MB, like Facebook', () => {
		expect(imageProblem({ type: 'image/png', size: 9 * 1024 * 1024 }, 'tiktok')).toBe('');
		expect(imageProblem({ type: 'image/webp', size: 1000 }, 'tiktok')).toBe('JPEG or PNG only');
		expect(isImagePlatform('tiktok')).toBe(true);
	});

	it('goes at the end unless the upload chose the beginning', () => {
		expect(coverAt({})).toBe('end');
		const start = withCoverAt({ tiktok: { privacy: 'Public' } }, 'start');
		expect(start.tiktok).toEqual({ privacy: 'Public', coverImageAt: 'start' });
		expect(coverAt(start)).toBe('start');
		expect(coverAt(withCoverAt(start, 'end'))).toBe('end');
	});
});
