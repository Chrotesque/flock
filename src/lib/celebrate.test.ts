import { describe, expect, it } from 'vitest';
import {
	ageWords,
	brandReleases,
	celebrationKey,
	celebrationsOf,
	combinedViews,
	topMedian,
	type PostRows
} from './celebrate';
import { NONE_HIDDEN } from './hiddenvideos';
import type { Post, Release, StatPlatform } from './releases';
import type { Account, Brand } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-21T12:00:00Z');

function post(platform: StatPlatform, id: string, at: number, views: number): Post {
	return { platform, record: `r-${id}`, id, url: `https://example.com/${id}`, at, views, likes: 0, comments: 0, followers: null, samples: [] };
}

/** A Short `ago` ms old with its YouTube, Instagram, TikTok and Facebook views. */
function short(key: string, ago: number, [yt, ig, tt, fb]: (number | null)[], extra: Partial<Release> = {}): Release {
	const at = NOW - ago;
	const posts: Partial<Record<StatPlatform, Post>> = {};
	if (yt !== null) posts.youtube = post('youtube', `yt-${key}`, at, yt);
	if (ig != null) posts.instagram = post('instagram', `ig-${key}`, at, ig);
	if (tt != null) posts.tiktok = post('tiktok', `tt-${key}`, at, tt);
	if (fb != null) posts.facebook = post('facebook', `fb-${key}`, at, fb);
	return {
		key,
		title: `Video ${key}`,
		at,
		kind: 'short',
		privacy: 'public',
		duration: 30,
		thumb: `https://img.example/${key}.jpg`,
		posts,
		links: {},
		job: `job-${key}`,
		matched: '',
		...extra
	};
}

/**
 * Twelve settled submissions: the top two (15 % of 11 or 12, rounded) are
 * 2,000 and 1,800, so the middle of the top is 1,900 and the bar 2,850.
 */
const field = () => [
	short('a', 5 * DAY, [800, 1000, 200]),
	short('b', 6 * DAY, [700, 900, 200]),
	...Array.from({ length: 10 }, (_, i) => short(`p${i}`, (7 + i) * DAY, [500, 400, 100]))
];

describe('topMedian', () => {
	it('takes the middle of the best 15 %, at least the best one', () => {
		expect(topMedian([3882, 3384, 3337, 3276, 3038, 2960, 2954, 2928, ...Array(47).fill(1000)])).toBe(3157);
		expect(topMedian([10, 5])).toBe(10);
		expect(topMedian([])).toBeNull();
	});
});

describe('combinedViews', () => {
	it('adds up YouTube, Instagram and TikTok, never Facebook', () => {
		expect(combinedViews(short('x', DAY, [1000, 2000, 300, 900]))).toBe(3300);
		expect(combinedViews(short('x', DAY, [1000, null, null]))).toBe(1000);
	});
});

describe('celebrationsOf', () => {
	it('celebrates a submission half as much again as the middle of the top 15 % of the others', () => {
		const hit = short('hit', 2 * DAY, [1200, 1500, 150, 400]);
		const list = celebrationsOf([...field(), hit], 'b1', NOW);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			key: celebrationKey('yt-hit'),
			brand: 'b1',
			job: 'job-hit',
			url: 'https://example.com/yt-hit',
			combined: 2850,
			views: { youtube: 1200, instagram: 1500, tiktok: 150 },
			median: 1900,
			bar: 2850,
			percent: 50,
			age: 2 * DAY,
			thumb: 'https://img.example/hit.jpg'
		});
	});

	it('leaves one view short out, whatever Facebook adds', () => {
		expect(celebrationsOf([...field(), short('near', DAY, [1199, 1500, 150, 9000])], 'b', NOW)).toEqual([]);
	});

	it("does not let a submission raise its own bar", () => {
		// With itself counted, 10,000 would join the top two and lift their middle to 6,000.
		const list = celebrationsOf([...field(), short('huge', DAY, [4000, 5000, 1000])], 'b', NOW);
		expect(list.map((c) => [c.title, c.percent])).toEqual([['Video huge', 426]]);
	});

	it('needs ten other submissions in the 30 days', () => {
		const few = field().slice(0, 9);
		expect(celebrationsOf([...few, short('hit', DAY, [5000, 5000, 0])], 'b', NOW)).toEqual([]);
	});

	it('counts and celebrates only public Shorts on YouTube from the last 30 days, not hidden', () => {
		const huge = [9000, 9000, 9000];
		const out = [
			short('long', DAY, huge, { kind: 'long' }),
			short('private', DAY, huge, { privacy: 'private' }),
			short('hidden', DAY, huge, { hidden: true }),
			short('reel', DAY, [null, 9000, 9000]),
			short('old', 31 * DAY, huge)
		];
		expect(celebrationsOf([...field(), ...out], 'b', NOW)).toEqual([]);
		// Nor do they set the bar: with them left out, 2,850 still clears it.
		expect(celebrationsOf([...field(), ...out, short('hit', DAY, [1200, 1500, 150])], 'b', NOW)).toHaveLength(1);
	});

	it('lists the best first', () => {
		// Forty others, six of them at 2,000: each hit's top 15 % holds the other hit and five at 2,000.
		const wide = Array.from({ length: 40 }, (_, i) => short(`w${i}`, (3 + i * 0.5) * DAY, i < 6 ? [1000, 900, 100] : [500, 400, 100]));
		const list = celebrationsOf([...wide, short('x', DAY, [1500, 2000, 0]), short('y', DAY, [2000, 2500, 0])], 'b', NOW);
		expect(list.map((c) => [c.title, c.bar])).toEqual([
			['Video y', 3000],
			['Video x', 3000]
		]);
	});
});

describe('brandReleases', () => {
	const brands: Brand[] = [
		{ id: 'owls', name: 'A', sort_order: 0, accounts: { youtube: 'UC-a', instagram: 'ig-a', tiktok: 'tt-a' } },
		{ id: 'moon', name: 'B', sort_order: 1, accounts: { youtube: 'UC-b', instagram: 'ig-b' } }
	];
	const account = (platform: Account['platform'], id: string, handle: string): Account => ({
		id: `r-${id}`,
		platform,
		account_id: id,
		handle,
		name: handle,
		details: null,
		error: '',
		fetched_at: ''
	});
	const accounts = [
		account('youtube', 'UC-a', 'a'),
		account('youtube', 'UC-b', 'b'),
		account('instagram', 'ig-a', 'a'),
		account('instagram', 'ig-b', 'b'),
		account('tiktok', 'tt-a', 'owls_tt')
	];
	const video = (id: string, channelId: string) => ({
		id: `r-${id}`,
		video_id: id,
		title: id,
		published_at: '2026-10-21 06:00:00.000Z',
		privacy: 'public',
		views: 10,
		likes: 0,
		comments: 0,
		duration: 30,
		history: [],
		live: false,
		thumb: '',
		channelId
	});
	const reel = (id: string, platform: 'instagram' | 'tiktok', accountId: string, handle = '') => ({
		id: `r-${id}`,
		post_id: id,
		platform,
		account: accountId,
		handle,
		published_at: '2026-10-21 09:00:00.000Z',
		views: 10,
		likes: 0,
		comments: 0,
		reach: null,
		permalink: '',
		caption: id,
		history: []
	});
	const rows: PostRows = {
		videos: [video('yt-a', 'UC-a'), video('yt-b', 'UC-b')],
		reels: [
			reel('ig-1', 'instagram', 'ig-a'),
			reel('ig-2', 'instagram', 'ig-b'),
			// Read under the sandbox key: another open id, the brand's handle.
			reel('tt-1', 'tiktok', 'sandbox-id', 'owls_tt'),
			reel('tt-2', 'tiktok', 'someone-else', 'other')
		],
		targets: []
	};
	const ids = (list: Release[]) => list.flatMap((r) => Object.values(r.posts).map((p) => p!.id)).sort();

	it("takes only the brand's own accounts, TikTok's by handle too", () => {
		expect(ids(brandReleases(brands[0], brands, accounts, rows, NONE_HIDDEN))).toEqual(['ig-1', 'tt-1', 'yt-a']);
		expect(ids(brandReleases(brands[1], brands, accounts, rows, NONE_HIDDEN))).toEqual(['ig-2', 'yt-b']);
	});

	it("never counts another brand's post", () => {
		const hot = { ...rows, videos: [...rows.videos, { ...video('yt-hot', 'UC-b'), views: 99_999 }] };
		expect(ids(brandReleases(brands[0], brands, accounts, hot, NONE_HIDDEN))).not.toContain('yt-hot');
	});
});

describe('ageWords', () => {
	it('says hours for two days, then days to a tenth', () => {
		expect(ageWords(5.9 * HOUR)).toBe('5 h');
		expect(ageWords(31 * HOUR)).toBe('31 h');
		expect(ageWords(60 * HOUR)).toBe('2.5 days');
		expect(ageWords(7 * DAY)).toBe('7 days');
	});
});
