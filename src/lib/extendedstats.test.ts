import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTENDED, percentWords, perView, pooledPerView, readExtended, viewFilter } from './extendedstats';
import { DEFAULT_FILTER } from './releases';

describe('readExtended', () => {
	it('starts off on YouTube with nothing stored', () => {
		expect(readExtended(null)).toEqual(DEFAULT_EXTENDED);
		expect(readExtended('junk')).toEqual({ on: false, platform: 'youtube' });
	});

	it('keeps a stored choice and drops what it does not know', () => {
		expect(readExtended({ on: true, platform: 'tiktok' })).toEqual({ on: true, platform: 'tiktok' });
		expect(readExtended({ on: 'yes', platform: 'myspace' })).toEqual({ on: false, platform: 'youtube' });
	});
});

describe('viewFilter', () => {
	const filter = { ...DEFAULT_FILTER, kinds: ['short' as const], days: 90 };

	it('is the filter itself while off', () => {
		expect(viewFilter(filter, { on: false, platform: 'instagram' })).toBe(filter);
	});

	it('puts the one platform in place of the filter’s, keeping every other choice', () => {
		expect(viewFilter(filter, { on: true, platform: 'instagram' })).toEqual({ ...filter, platforms: ['instagram'] });
		expect(filter.platforms).toEqual(DEFAULT_FILTER.platforms);
	});
});

describe('per view', () => {
	it('is a share of the views in percent', () => {
		expect(perView(12, 1100)).toBeCloseTo(1.0909, 4);
		expect(perView(0, 50)).toBe(0);
	});

	it('is unknown without views to divide by, or the counter unread', () => {
		expect(perView(3, 0)).toBeNull();
		expect(perView(3, null)).toBeNull();
		expect(perView(null, 400)).toBeNull();
	});

	it('pools by the views, leaving out videos with either number unread', () => {
		expect(pooledPerView([{ count: 12, views: 1100 }, { count: 8, views: 900 }, { count: null, views: 5000 }, { count: 4, views: 0 }])).toBe(1);
		expect(pooledPerView([{ count: null, views: 10 }])).toBeNull();
		expect(pooledPerView([])).toBeNull();
	});

	it('says a share with two decimals in the decimal mark asked for', () => {
		expect(percentWords(perView(12, 1100)!, 'de-DE')).toBe('1,09 %');
		expect(percentWords(perView(12, 1100)!, 'en-GB')).toBe('1.09 %');
		expect(percentWords(4, 'en-GB')).toBe('4.00 %');
	});
});
