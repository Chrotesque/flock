import { describe, expect, it } from 'vitest';
import { ageWords, brandReleases, celebrationKey, celebrationsOf, CELEBRATE_FROM_MS, type PostRows } from './celebrate';
import { NONE_HIDDEN } from './hiddenvideos';
import type { Post, Release, StatPlatform } from './releases';
import type { Account, Brand } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-21T12:00:00Z');

/** A post out `ago` ms before NOW with `views` now, read from release: one sample per hour at `perHour`. */
function post(platform: StatPlatform, id: string, ago: number, views: number, perHour = 0): Post {
	const at = NOW - ago;
	const samples: [number, number][] = [];
	if (perHour > 0) for (let t = HOUR; t <= ago; t += HOUR) samples.push([at + t, Math.round((perHour * t) / HOUR)]);
	return { platform, record: `r-${id}`, id, url: `https://example.com/${id}`, at, views, likes: 0, comments: 0, followers: null, samples };
}

function release(key: string, posts: Post[], extra: Partial<Release> = {}): Release {
	return {
		key,
		title: `Video ${key}`,
		at: Math.min(...posts.map((p) => p.at)),
		kind: 'short',
		privacy: 'public',
		duration: 30,
		thumb: `https://img.example/${key}.jpg`,
		posts: Object.fromEntries(posts.map((p) => [p.platform, p])),
		links: {},
		job: '',
		matched: '',
		...extra
	};
}

/** Three older Shorts that each had 100 views per hour: usual at 5 h is 500. */
const peers = () => [1, 2, 3].map((n) => release(`p${n}`, [post('youtube', `yt-p${n}`, (5 + n) * DAY, 900, 100)]));

describe('celebrationsOf', () => {
	it('celebrates a post at least half as much again as usual, with the whole per cent rounded down', () => {
		const list = celebrationsOf([...peers(), release('a', [post('youtube', 'yt-a', 5 * HOUR, 1914)])], 'b1', NOW);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			key: celebrationKey('youtube', 'yt-a'),
			platform: 'youtube',
			brand: 'b1',
			views: 1914,
			usual: 500,
			percent: 282,
			upright: true,
			thumb: 'https://img.example/a.jpg'
		});
	});

	it('takes exactly 50% and leaves 49% out', () => {
		expect(celebrationsOf([...peers(), release('a', [post('youtube', 'yt-a', 5 * HOUR, 750)])], 'b', NOW)).toHaveLength(1);
		expect(celebrationsOf([...peers(), release('a', [post('youtube', 'yt-a', 5 * HOUR, 749)])], 'b', NOW)).toHaveLength(0);
	});

	it('waits three hours, and stops after the week usual compares over', () => {
		const young = release('a', [post('youtube', 'yt-a', CELEBRATE_FROM_MS - 60_000, 5000)]);
		const old = release('b', [post('youtube', 'yt-b', 8 * DAY, 99_000, 1000)]);
		expect(celebrationsOf([...peers(), young, old], 'b', NOW)).toEqual([]);
	});

	it('leaves out private and hidden posts, and posts with fewer than three peers', () => {
		const hot = (key: string, extra: Partial<Release> = {}) => release(key, [post('youtube', `yt-${key}`, 5 * HOUR, 5000)], extra);
		expect(celebrationsOf([...peers(), hot('a', { privacy: 'private' }), hot('b', { hidden: true })], 'b', NOW)).toEqual([]);
		expect(celebrationsOf([...peers().slice(0, 2), hot('c')], 'b', NOW)).toEqual([]);
	});

	it('judges each platform against its own peers, best first', () => {
		const igPeers = [1, 2, 3].map((n) => release(`i${n}`, [post('instagram', `ig-p${n}`, (5 + n) * DAY, 900, 20)]));
		const both = release('a', [post('youtube', 'yt-a', 5 * HOUR, 800), post('instagram', 'ig-a', 5 * HOUR, 400)]);
		const list = celebrationsOf([...peers(), ...igPeers, both], 'b', NOW);
		expect(list.map((c) => [c.platform, c.percent])).toEqual([
			['instagram', 300],
			['youtube', 60]
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

	it("never celebrates another brand's post", () => {
		const hot = { ...rows, videos: [...rows.videos, { ...video('yt-hot', 'UC-b'), views: 99_999 }] };
		const list = brandReleases(brands[0], brands, accounts, hot, NONE_HIDDEN);
		expect(ids(list)).not.toContain('yt-hot');
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
