import { describe, expect, it } from 'vitest';
import {
	engagedRate,
	engagementsOf,
	MIN_VIEWS,
	percentWords,
	perView,
	pooledPerView,
	rateOf,
	rateWords,
	readRatioPlatforms,
	shortTitle,
	slotPlatforms,
	standing,
	toggleRatioPlatform,
	usualOf,
	viewFilter,
	vsUsual
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

});

describe('against the usual', () => {
	it('leaves a rate out below the views it takes to mean anything', () => {
		expect(MIN_VIEWS).toBe(100);
		expect(rateOf(post(15, 1, 0), 'likes')).toBeNull();
		expect(rateOf(post(919, 15, 5), 'likes')).toBeCloseTo(1.632, 3);
		expect(rateOf(post(919, 15, 5, 42), 'skip')).toBe(42);
		expect(rateOf(post(99, 15, 5, 42), 'skip')).toBeNull();
	});

	it('takes the usual as the middle rate of the posts with enough views', () => {
		const usual = usualOf([post(1000, 10, 2, 50), post(1000, 20, 0, 40), post(1000, 30, 1, null), post(20, 20, 20, 90)]);
		expect(usual).toEqual({ likes: 2, comments: 0.1, skip: 45 });
		expect(usualOf([])).toEqual({ likes: null, comments: null, skip: null });
	});

	it('says better, worse or about usual, fewer skips being better', () => {
		expect(standing(1.9, 1.5, 'likes')).toBe('up');
		expect(standing(1.1, 1.5, 'likes')).toBe('down');
		expect(standing(1.6, 1.5, 'likes')).toBe('usual');
		expect(standing(40, 46, 'skip')).toBe('up');
		expect(standing(52, 46, 'skip')).toBe('down');
		expect(standing(48, 46, 'skip')).toBe('usual');
		expect(standing(0.4, 0, 'comments')).toBe('up');
		expect(standing(0, 0, 'comments')).toBe('usual');
		expect(standing(null, 1, 'likes')).toBeNull();
	});

	it('measures a whole video by the mean of its platforms against theirs', () => {
		const yt = { ...post(1000, 30, 0), platform: 'youtube' as const };
		const ig = { ...post(1000, 10, 0), platform: 'instagram' as const };
		const tiny = { ...post(10, 5, 0), platform: 'tiktok' as const };
		const usual = { youtube: { likes: 1.5, comments: 0, skip: null }, instagram: { likes: 2, comments: 0, skip: null }, tiktok: { likes: 3, comments: 0, skip: null } };
		expect(vsUsual([yt, ig, tiny], usual, 'likes')).toBeCloseTo((2 + 0.5) / 2, 9);
		expect(vsUsual([yt], usual, 'comments')).toBeNull();
	});

	it('writes a rate with the decimals it needs', () => {
		expect(rateWords(0, 'en-GB')).toBe('0%');
		expect(rateWords(0.536, 'en-GB')).toBe('0.54%');
		expect(rateWords(1.632, 'en-GB')).toBe('1.6%');
		expect(rateWords(10.08, 'de-DE')).toBe('10,1%');
	});
});
