import { describe, expect, it } from 'vitest';
import { acceptedTypes, imageFits, imageProblem, largestAccepted } from './coverimage';

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
});

describe('what the picker accepts', () => {
	it('is what the platforms served take', () => {
		expect(acceptedTypes(['instagram'])).toEqual(['image/jpeg', 'image/png']);
		expect(largestAccepted(['instagram'])).toBe(8 * MB);
	});

	it('falls back to every image platform when none is active', () => {
		expect(acceptedTypes([])).toEqual(['image/jpeg', 'image/png']);
		expect(largestAccepted([])).toBe(8 * MB);
	});
});
