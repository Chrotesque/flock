import { describe, expect, it } from 'vitest';
import { NONE_HIDDEN, hiddenCount, isHidden, readHidden, releasesWithHidden, setHidden } from './hiddenvideos';
import { DEFAULT_FILTER, filterCounts, inView, peerGroups, type ReelRow, type YouTubeRow } from './releases';

const MIN = 60_000;
const T0 = Date.parse('2026-10-20T00:38:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

function video(id: string, at: number, extra: Partial<YouTubeRow> = {}): YouTubeRow {
	return {
		id: `rec-${id}`,
		video_id: id,
		title: `Video ${id}`,
		published_at: iso(at),
		privacy: 'public',
		views: 100,
		likes: 5,
		comments: 1,
		duration: 37,
		history: [],
		live: false,
		thumb: '',
		...extra
	};
}

function reel(id: string, at: number, extra: Partial<ReelRow> = {}): ReelRow {
	return {
		id: `rec-${id}`,
		post_id: id,
		published_at: iso(at),
		views: 50,
		likes: 2,
		comments: 0,
		reach: 40,
		permalink: `https://www.instagram.com/reel/${id}/`,
		caption: `Caption ${id}`,
		history: [],
		...extra
	};
}

function fbReel(id: string, at: number): ReelRow {
	return reel(id, at, { id: `rec-fb-${id}`, permalink: `https://www.facebook.com/reel/${id}/`, reach: null });
}

describe('the marks', () => {
	it('reads a stored row field by field', () => {
		expect(readHidden(null)).toEqual(NONE_HIDDEN);
		expect(readHidden({ youtube: { a: true, b: false, c: 'yes' }, instagram: 'x', tiktok: { t: true } })).toEqual({
			youtube: { a: true },
			instagram: {},
			facebook: {}
		});
	});

	it('hides and shows again, dropping the mark', () => {
		const posts = [
			{ platform: 'instagram' as const, id: 'R1' },
			{ platform: 'facebook' as const, id: 'F1' }
		];
		const hidden = setHidden(NONE_HIDDEN, posts, true);
		expect(isHidden(hidden, posts[0])).toBe(true);
		expect(hiddenCount(hidden)).toBe(2);
		expect(NONE_HIDDEN.instagram).toEqual({});
		const back = setHidden(hidden, [posts[0]], false);
		expect(back).toEqual({ youtube: {}, instagram: {}, facebook: { F1: true } });
	});
});

describe('releases with hidden posts', () => {
	// A scheduled Short, a test reel 30 minutes after it, another 41 minutes after.
	const videos = [video('SHORTaaaaaa', T0, { privacy: 'private' })];
	const reels = [reel('TEST2', T0 + 30 * MIN), reel('TEST3', T0 + 41 * MIN)];

	it('pairs as before with nothing hidden', () => {
		const releases = releasesWithHidden(videos, reels, [], [], NONE_HIDDEN);
		expect(releases.find((r) => r.key === 'yt:SHORTaaaaaa')?.posts.instagram?.id).toBe('TEST2');
		expect(releases.some((r) => r.hidden)).toBe(false);
	});

	it('takes a hidden reel out of the pairing, so it never sits in a real video’s row', () => {
		const hidden = setHidden(NONE_HIDDEN, [{ platform: 'instagram', id: 'TEST2' }], true);
		const releases = releasesWithHidden(videos, reels, [], [], hidden);
		const short = releases.find((r) => r.key === 'yt:SHORTaaaaaa')!;
		expect(short.hidden).toBeUndefined();
		// The next reel within two hours takes the place, as it would have had the test never been posted.
		expect(short.posts.instagram?.id).toBe('TEST3');
		const away = releases.find((r) => r.key === 'ig:TEST2')!;
		expect(away.hidden).toBe(true);
		expect(away.posts.youtube).toBeUndefined();
	});

	it('pairs hidden posts among themselves', () => {
		const ig = reel('IG1', T0 + 30 * MIN);
		const fb = fbReel('FB1', T0 + 31 * MIN);
		const hidden = setHidden(
			NONE_HIDDEN,
			[
				{ platform: 'instagram', id: 'IG1' },
				{ platform: 'facebook', id: 'FB1' }
			],
			true
		);
		const releases = releasesWithHidden([], [ig], [], [fb], hidden);
		expect(releases).toHaveLength(1);
		expect(releases[0].hidden).toBe(true);
		expect(Object.keys(releases[0].posts)).toEqual(['instagram', 'facebook']);
	});

	it('keeps hidden ones out of the view, the counts and the usual until the filter shows them', () => {
		const hidden = setHidden(NONE_HIDDEN, [{ platform: 'instagram', id: 'TEST3' }], true);
		const releases = releasesWithHidden([video('PUBLICSHORT', T0)], reels, [], [], hidden);
		const away = releases.find((r) => r.key === 'ig:TEST3')!;
		expect(inView(away, DEFAULT_FILTER)).toBe(false);
		expect(inView(away, { ...DEFAULT_FILTER, hidden: true })).toBe(true);

		const counts = filterCounts(releases, DEFAULT_FILTER);
		expect(counts.hidden).toBe(1);
		expect(counts.kinds.short).toBe(1);
		expect(counts.platforms.instagram).toBe(1);
		const shown = filterCounts(releases, { ...DEFAULT_FILTER, hidden: true });
		expect(shown.kinds.short).toBe(2);
		expect(shown.platforms.instagram).toBe(2);

		// Never a peer, whatever the filter shows.
		expect(peerGroups(releases).get('instagram:short')?.map((p) => p.id)).toEqual(['TEST2']);
	});
});
