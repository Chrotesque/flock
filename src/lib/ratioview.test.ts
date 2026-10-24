import { describe, expect, it } from 'vitest';
import {
	engagedRate,
	engagementsOf,
	percentWords,
	perView,
	platformTotal,
	pooledPerView,
	readRatioPlatforms,
	shortTitle,
	slotPlatforms,
	toggleRatioPlatform,
	viewFilter
} from './ratioview';
import { DEFAULT_FILTER, STAT_PLATFORMS, type Post } from './releases';

const post = (views: number | null, likes: number | null, comments: number | null, skipRate: number | null = null): Post => ({
	platform: 'youtube',
	record: 'r',
	id: 'i',
	url: '',
	at: 0,
	views,
	likes,
	comments,
	followers: null,
	samples: [],
	skipRate
});

describe('viewFilter', () => {
	const filter = { ...DEFAULT_FILTER, platforms: ['youtube' as const], kinds: ['short' as const], days: 90 };

	it('is the filter itself while off', () => {
		expect(viewFilter(filter, false)).toBe(filter);
	});

	it('puts every platform in place of the filter’s, keeping every other choice', () => {
		expect(viewFilter(filter, true)).toEqual({ ...filter, platforms: STAT_PLATFORMS });
		expect(viewFilter(filter, true, ['instagram', 'tiktok'])).toEqual({ ...filter, platforms: ['instagram', 'tiktok'] });
		expect(filter.platforms).toEqual(['youtube']);
	});
});

describe('the platforms Ratio View shows', () => {
	it('reads a stored list in display order, every platform when it holds none', () => {
		expect(readRatioPlatforms(['tiktok', 'youtube', 'myspace'])).toEqual(['youtube', 'tiktok']);
		expect(readRatioPlatforms([])).toEqual(STAT_PLATFORMS);
		expect(readRatioPlatforms(null)).toEqual(STAT_PLATFORMS);
	});

	it('adds and takes away, in display order, keeping the last one', () => {
		expect(toggleRatioPlatform(['tiktok'], 'youtube')).toEqual(['youtube', 'tiktok']);
		expect(toggleRatioPlatform(['youtube', 'tiktok'], 'youtube')).toEqual(['tiktok']);
		const last: ['facebook'] = ['facebook'];
		expect(toggleRatioPlatform(last, 'facebook')).toBe(last);
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
		expect(percentWords(perView(12, 1100)!, 'de-DE')).toBe('1,09%');
		expect(percentWords(perView(12, 1100)!, 'en-GB')).toBe('1.09%');
		expect(percentWords(4, 'en-GB')).toBe('4.00%');
	});
});

describe('shortTitle', () => {
	it('keeps the first 20 characters and ends in ...', () => {
		expect(shortTitle("I'm the worst airport security officer ever")).toBe("I'm the worst airpor...");
		expect(shortTitle('Exactly twenty chars')).toBe('Exactly twenty chars');
	});

	it('never cuts a character in two, nor leaves a space before the dots', () => {
		expect(shortTitle('🔴 Surprise! Missed me? Again')).toBe('🔴 Surprise! Missed m...');
		expect(shortTitle('Nineteen characters and more')).toBe('Nineteen characters...');
	});
});

describe('engagement rate by views', () => {
	it('counts likes and comments as engagements, only where both were read', () => {
		expect(engagementsOf({ likes: 15, comments: 5 })).toBe(20);
		expect(engagementsOf({ likes: 15, comments: null })).toBeNull();
	});

	it('is engagements over views × 100, pooled by the views', () => {
		expect(engagedRate([post(529, 15, 5)])).toBeCloseTo(3.7807, 4);
		expect(engagedRate([post(1000, 8, 2), post(1000, 28, 2), post(500, 9, null), post(0, 3, 1)])).toBe(2);
		expect(engagedRate([post(null, 1, 1)])).toBeNull();
	});
});

describe('slots and totals', () => {
	it('gives a slot to every platform any video is on, in display order', () => {
		expect(slotPlatforms([{ posts: { facebook: post(1, 1, 1) } }, { posts: { youtube: post(1, 1, 1) } }])).toEqual(['youtube', 'facebook']);
		expect(slotPlatforms([])).toEqual([]);
		expect(slotPlatforms([{ posts: { facebook: post(1, 1, 1), youtube: post(1, 1, 1) } }], ['facebook', 'tiktok'])).toEqual(['facebook']);
	});

	it('adds a platform’s counters up and pools its shares by the views', () => {
		const total = platformTotal([post(1100, 12, 3, 40), post(900, 8, null, 20), post(null, 5, 1)]);
		expect(total).toMatchObject({ views: 2000, likes: 25, comments: 4, likeRate: 1, engagedRate: 15 / 11 });
		expect(total.commentRate).toBeCloseTo(3 / 11, 9);
		expect(total.skip).toBeCloseTo(31, 6);
		expect(platformTotal([post(null, null, null)])).toMatchObject({ views: null, likes: null, likeRate: null, skip: null });
	});
});
