import { describe, expect, it } from 'vitest';
import { facebookProblems } from './facebook';

describe('facebookProblems', () => {
	it('takes a reel of 3 to 90 seconds', () => {
		expect(facebookProblems(3)).toEqual([]);
		expect(facebookProblems(13.1)).toEqual([]);
		expect(facebookProblems(90)).toEqual([]);
		// A frame or so over, as a 90-second edit often measures.
		expect(facebookProblems(90.4)).toEqual([]);
	});

	it('says what is wrong with a reel too long or too short', () => {
		expect(facebookProblems(135)).toEqual([
			'Facebook takes reels of up to 90 seconds; this video runs 2:15 min. Give Facebook a shorter cut of its own, or untick it.'
		]);
		expect(facebookProblems(2)).toEqual(['Facebook takes reels of at least 3 seconds; this video runs 2 s.']);
	});

	it('says nothing while the length is not known', () => {
		expect(facebookProblems(0)).toEqual([]);
		expect(facebookProblems(Number.NaN)).toEqual([]);
	});
});
