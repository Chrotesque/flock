import { describe, expect, it } from 'vitest';
import { nameProblem, newestByPost, readTitleRequest, renameChoices, renameNotes, type TitleRequest } from './retitle';
import type { Post } from './releases';

const post = (platform: Post['platform'], record: string, id: string): Post => ({
	platform,
	record,
	id,
	url: '',
	at: 0,
	views: null,
	likes: null,
	comments: null,
	samples: []
});

const release = {
	posts: { youtube: post('youtube', 'v1', 'Ab3dE6gH9jK'), facebook: post('facebook', 'f1', '2229') },
	links: {
		youtube: 'https://www.youtube.com/shorts/Ab3dE6gH9jK',
		instagram: 'https://www.instagram.com/reel/x/',
		tiktok: 'https://www.tiktok.com/@owls/video/1',
		facebook: 'https://www.facebook.com/reel/2229/'
	}
};
const videos = [{ id: 'v1', title: 'Owls at dusk', channelId: 'UC1' }];
const reels = [{ id: 'f1', caption: 'Werbung\nOwls at dusk on Facebook\n#owls', account: 'P1' }];

describe('renameChoices', () => {
	it('lists every platform the video is on, with its name there', () => {
		const choices = renameChoices(release, videos, reels);
		expect(choices.map((c) => c.platform)).toEqual(['youtube', 'instagram', 'tiktok', 'facebook']);
		expect(choices[0]).toEqual({ platform: 'youtube', videoId: 'Ab3dE6gH9jK', account: 'UC1', current: 'Owls at dusk', refusal: '' });
		// A reel's name is its caption's title line.
		expect(choices[3]).toMatchObject({ videoId: '2229', account: 'P1', current: 'Owls at dusk on Facebook', refusal: '' });
	});

	it('offers neither Instagram nor TikTok, nor a post flock has not read', () => {
		const [, instagram, tiktok] = renameChoices(release, videos, reels);
		expect(instagram.refusal).toMatch(/Instagram/);
		expect(tiktok.refusal).toMatch(/TikTok/);
		const unread = renameChoices({ posts: {}, links: { youtube: release.links.youtube } }, [], []);
		expect(unread[0]).toMatchObject({ videoId: '', refusal: 'flock has not read this post yet.' });
	});
});

describe('nameProblem', () => {
	it("holds YouTube's rules only when YouTube is ticked", () => {
		expect(nameProblem('Owls', ['youtube'])).toBe('');
		expect(nameProblem('x'.repeat(101), ['youtube'])).toMatch(/100 characters/);
		expect(nameProblem('x'.repeat(101), ['facebook'])).toBe('');
		expect(nameProblem('Owls <3', ['youtube', 'facebook'])).toMatch(/< or >/);
	});

	it('wants a name and a platform', () => {
		expect(nameProblem('  \n ', ['youtube'])).toBe('Enter a name.');
		expect(nameProblem('Owls', [])).toBe('Tick at least one platform.');
	});
});

const ask = (over: Partial<TitleRequest>): TitleRequest =>
	readTitleRequest({
		id: 'r1',
		platform: 'youtube',
		video_id: 'Ab3dE6gH9jK',
		title: 'New',
		status: 'pending',
		created: '2026-10-15 08:00:00.000Z',
		updated: '2026-10-15 08:00:00.000Z',
		...over
	});

describe('renameNotes', () => {
	const now = Date.parse('2026-10-15T09:00:00Z');
	const posts = Object.values(release.posts);

	it('says which posts wait for the worker, by their newest ask', () => {
		const newest = newestByPost([
			ask({ id: 'old', status: 'failed', created: '2026-10-15 07:00:00.000Z' }),
			ask({ id: 'new' })
		]);
		expect(renameNotes(posts, newest, now).waiting.map((r) => r.id)).toEqual(['new']);
		expect(renameNotes(posts, newest, now).refused).toEqual([]);
	});

	it('shows a refusal for a day, and nothing once renamed', () => {
		const refused = ask({ platform: 'facebook', video_id: '2229', status: 'failed', updated: '2026-10-15 08:30:00.000Z' });
		expect(renameNotes(posts, newestByPost([refused]), now).refused).toHaveLength(1);
		expect(renameNotes(posts, newestByPost([refused]), now + 24 * 3_600_000).refused).toHaveLength(0);
		expect(renameNotes(posts, newestByPost([ask({ status: 'done' })]), now)).toEqual({ waiting: [], refused: [] });
	});

	it('reads an unknown status as waiting', () => {
		expect(readTitleRequest({ status: 'odd' }).status).toBe('pending');
	});
});
