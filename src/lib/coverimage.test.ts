import { describe, expect, it } from 'vitest';
import {
	acceptedTypes,
	coverAt,
	imageFits,
	imageGroups,
	imageProblem,
	imageSlot,
	isImagePlatform,
	largestAccepted,
	tiktokImageNote,
	withCoverAt
} from './coverimage';

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

describe('which picture each platform gets', () => {
	const all = ['youtube', 'instagram', 'tiktok', 'facebook'] as const;

	it('is the one picture while linked', () => {
		expect(imageSlot('tiktok', true, all)).toBe('thumbnail');
		expect(imageGroups(all, true)).toEqual([{ slot: 'thumbnail', platforms: ['instagram', 'tiktok', 'facebook'] }]);
	});

	it("unlinked, gives TikTok Instagram's picture, or Facebook's without Instagram", () => {
		expect(imageSlot('instagram', false, all)).toBe('cover');
		expect(imageSlot('facebook', false, all)).toBe('thumbnail');
		expect(imageSlot('tiktok', false, all)).toBe('cover');
		expect(imageSlot('tiktok', false, ['tiktok', 'facebook'])).toBe('thumbnail');
		expect(imageGroups(all, false)).toEqual([
			{ slot: 'cover', platforms: ['instagram', 'tiktok'] },
			{ slot: 'thumbnail', platforms: ['facebook'] }
		]);
	});

	it('leaves out the platforms that take no picture', () => {
		expect(imageGroups(['youtube'], true)).toEqual([]);
		expect(imageGroups(['youtube', 'tiktok'], true)).toEqual([{ slot: 'thumbnail', platforms: ['tiktok'] }]);
	});
});

describe("TikTok's Cover box note", () => {
	const jpg = { name: 'cover.jpg', type: 'image/jpeg', size: 1024 };

	it('names where the picture comes from', () => {
		expect(tiktokImageNote(['instagram', 'tiktok', 'facebook'], true, jpg)).toBe(
			'Uses the cover picked for Instagram and Facebook: cover.jpg.'
		);
		expect(tiktokImageNote(['instagram', 'tiktok', 'facebook'], false, jpg)).toBe("Uses Instagram's cover: cover.jpg.");
		expect(tiktokImageNote(['tiktok', 'facebook'], false, jpg)).toBe("Uses Facebook's cover: cover.jpg.");
		expect(tiktokImageNote(['tiktok'], true, jpg)).toBe('Uses the cover image: cover.jpg.');
	});

	it('says where to pick one, or that there is nowhere to', () => {
		expect(tiktokImageNote(['instagram', 'tiktok'], true, null)).toMatch(/^No cover image yet: pick one while writing for Instagram\./);
		expect(tiktokImageNote(['tiktok'], true, null)).toMatch(/Neither is in this upload/);
	});

	it('says when the picture does not fit TikTok', () => {
		expect(tiktokImageNote(['tiktok', 'facebook'], true, { ...jpg, size: 11 * 1024 * 1024 })).toBe(
			'The cover picked for Facebook, cover.jpg, does not fit TikTok (over its 10 MB limit), so TikTok uses its cover frame.'
		);
	});
});
