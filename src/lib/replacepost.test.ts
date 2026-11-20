import { describe, expect, it } from 'vitest';
import { readReplaced, replaceChoices, replaceDetail, replacingPost, withReplaced, NONE_REPLACED } from './replacepost';
import type { Post, Release } from './releases';

const post = (platform: Post['platform'], id: string, at: number, url = `https://x/${id}`): Post => ({
	platform,
	record: `r${id}`,
	id,
	url,
	at,
	views: 10,
	likes: 1,
	comments: 0,
	followers: null,
	samples: []
});

const release = (key: string, at: number, posts: Post[], job = '', links: Release['links'] = {}): Release => ({
	key,
	title: key,
	at,
	kind: 'short',
	privacy: 'public',
	duration: 30,
	thumb: '',
	posts: Object.fromEntries(posts.map((p) => [p.platform, p])),
	links: { ...Object.fromEntries(posts.map((p) => [p.platform, p.url])), ...links },
	job,
	matched: ''
});

describe('replacingPost', () => {
	it('offers a lone reel posted outside flock', () => {
		expect(replacingPost(release('ig:1', 5, [post('instagram', '1', 5)]))?.id).toBe('1');
	});
	it('not a flock upload, a YouTube video, a pair, or a hidden one', () => {
		expect(replacingPost(release('a', 5, [post('instagram', '1', 5)], 'job1'))).toBeNull();
		expect(replacingPost(release('b', 5, [post('youtube', '1', 5)]))).toBeNull();
		expect(replacingPost(release('c', 5, [post('instagram', '1', 5), post('youtube', 'y', 5)]))).toBeNull();
		expect(replacingPost({ ...release('d', 5, [post('instagram', '1', 5)]), hidden: true })).toBeNull();
	});
});

describe('replaceChoices', () => {
	const fresh = post('instagram', 'new', 1000) as Post & { platform: 'instagram' };
	it('flock uploads with that platform, before the new reel, nearest first', () => {
		const list = [
			release('far', 100, [post('youtube', 'y1', 100), post('instagram', 'o1', 100)], 'j1'),
			release('near', 900, [post('youtube', 'y2', 900)], 'j2', { instagram: 'https://x/gone' }),
			release('later', 2000, [post('instagram', 'o3', 2000)], 'j3'),
			release('noig', 950, [post('youtube', 'y4', 950)], 'j4'),
			release('hand', 990, [post('instagram', 'o5', 990)])
		];
		const got = replaceChoices(fresh, list);
		expect(got.map((c) => c.release.key)).toEqual(['near', 'far']);
		expect(got[0].old).toBeNull();
		expect(got[0].oldUrl).toBe('https://x/gone');
		expect(got[1].old?.id).toBe('o1');
	});
});

describe('stored row', () => {
	it('round-trips and drops junk', () => {
		const s = withReplaced(NONE_REPLACED, 'instagram', 'old', 'new', '2026-11-17T10:00:00Z');
		expect(readReplaced(JSON.parse(JSON.stringify(s)))).toEqual(s);
		expect(readReplaced({ instagram: { a: true, b: { by: 'c' } }, youtube: { x: { by: 'y' } } })).toEqual({
			instagram: { b: { by: 'c', at: '' } },
			facebook: {},
			tiktok: {}
		});
	});
});

it('names both reels in the Log', () => {
	const d = replaceDetail({ title: 'T', platform: 'instagram', oldUrl: 'u1', oldViews: 1234, newUrl: 'u2', newAt: 0 });
	expect(d).toContain('flock uploaded to Instagram — u1 (1,234 views, forgotten)');
	expect(d).toContain('posted on Instagram directly');
	expect(d).toContain('u2');
});
