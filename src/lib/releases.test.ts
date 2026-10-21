import { describe, expect, it } from 'vitest';
import {
	COMPARE_AT_MS,
	DEFAULT_FILTER,
	DASH_SPANS,
	buildReleases,
	captionTitle,
	curve,
	filterCounts,
	inSpan,
	inView,
	judge,
	peerGroups,
	periodStats,
	pooledSkipRate,
	ratioOf,
	readFilter,
	readSkipRate,
	reelPost,
	linkKey,
	sameLink,
	skipPosts,
	skipRateOf,
	sortRows,
	sortWords,
	storedFilter,
	sumOf,
	thin,
	tiktokId,
	verdictOf,
	viewsAt,
	visibilityOf,
	youtubeId,
	type Post,
	type ReelRow,
	type Release,
	type Sample,
	type TargetLink,
	type YouTubeRow
} from './releases';

const H = 3600_000;
const D = 24 * H;
const T0 = Date.parse('2026-10-01T12:00:00Z');
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
		duration: 40,
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

function fbReel(id: string, at: number, extra: Partial<ReelRow> = {}): ReelRow {
	return reel(id, at, { id: `rec-fb-${id}`, permalink: `https://www.facebook.com/reel/${id}/`, reach: null, ...extra });
}

function ttVideo(id: string, at: number, extra: Partial<ReelRow> = {}): ReelRow {
	return reel(id, at, {
		id: `rec-tt-${id}`,
		permalink: `https://www.tiktok.com/@owlsnest/video/${id}`,
		reach: null,
		duration: 30,
		thumb: `https://p16.example/${id}.jpeg`,
		...extra
	});
}

function post(at: number, samples: [number, number][], views: number | null = null): Post {
	return {
		platform: 'youtube',
		record: 'r',
		id: 'x',
		url: '',
		at,
		views: views ?? samples[samples.length - 1]?.[1] ?? null,
		likes: null,
		comments: null,
		followers: null,
		samples
	};
}

describe('links', () => {
	it('finds the video id in every YouTube link form', () => {
		expect(youtubeId('https://www.youtube.com/watch?v=Ab3dE6gH9jK')).toBe('Ab3dE6gH9jK');
		expect(youtubeId('https://www.youtube.com/shorts/Zy-_x0w1v2U?feature=share')).toBe('Zy-_x0w1v2U');
		expect(youtubeId('https://youtu.be/Qr5sT7uV9wX')).toBe('Qr5sT7uV9wX');
		expect(youtubeId('https://www.instagram.com/reel/Cx1-Yz2Ab3/')).toBe('');
		expect(youtubeId(undefined)).toBe('');
	});

	it('compares links without scheme, www, query or trailing slash', () => {
		expect(sameLink('https://www.instagram.com/reel/Cx1-Yz2Ab3/')).toBe(sameLink('http://instagram.com/reel/Cx1-Yz2Ab3?igsh=1'));
	});

	it('titles a reel by its first line that is not an ad notice or hashtags', () => {
		expect(captionTitle('Werbung – in Zusammenarbeit mit Paper Moon\n\nThe owls built a tunnel?\n#owlsnest')).toBe('The owls built a tunnel?');
		expect(captionTitle('[Werbung] Sponsored by Paper Moon 🏨\nA moth the size of a dog')).toBe('A moth the size of a dog');
		expect(captionTitle('Adventure time')).toBe('Adventure time');
		expect(captionTitle('#only #tags')).toBe('#only #tags');
		expect(captionTitle('')).toBe('');
		expect(captionTitle('x'.repeat(200))).toHaveLength(108);
	});
});

describe('viewsAt', () => {
	const p = post(T0, [
		[T0 + H, 10],
		[T0 + 3 * H, 40],
		[T0 + 5 * H, 90]
	]);

	it('is 0 before release and null before the first read', () => {
		expect(viewsAt(p, T0 - 1)).toBe(0);
		expect(viewsAt(p, T0 + H / 2)).toBeNull();
	});

	it('holds the last sample at or before the moment', () => {
		expect(viewsAt(p, T0 + H)).toBe(10);
		expect(viewsAt(p, T0 + 4 * H)).toBe(40);
		expect(viewsAt(p, T0 + 10 * H)).toBe(90);
	});
});

describe('buildReleases', () => {
	it('pairs a video and a reel of the same flock upload, whatever the gap', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'youtube', remote_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', jobTitle: 'Job one' },
			{ job: 'j1', platform: 'instagram', remote_url: 'https://www.instagram.com/reel/R1/', jobTitle: 'Job one' },
			{ job: 'j1', platform: 'facebook', remote_url: 'https://www.facebook.com/reel/1/', jobTitle: 'Job one' }
		];
		const out = buildReleases([video('aaaaaaaaaaa', T0)], [reel('R1', T0 + 6 * H)], targets);
		expect(out).toHaveLength(1);
		expect(out[0].matched).toBe('job');
		expect(out[0].job).toBe('j1');
		expect(out[0].posts.instagram?.id).toBe('R1');
		expect(out[0].links.facebook).toBe('https://www.facebook.com/reel/1/');
	});

	it('pairs a Short and a reel within two hours, closest first, one to one', () => {
		const out = buildReleases(
			[video('aaaaaaaaaaa', T0), video('bbbbbbbbbbb', T0 + 90 * 60_000)],
			[reel('R1', T0 + 80 * 60_000), reel('R2', T0 + 10 * 60_000)],
			[]
		);
		const a = out.find((r) => r.key === 'yt:aaaaaaaaaaa')!;
		const b = out.find((r) => r.key === 'yt:bbbbbbbbbbb')!;
		expect(a.posts.instagram?.id).toBe('R2');
		expect(b.posts.instagram?.id).toBe('R1');
		expect(a.matched).toBe('time');
		expect(out).toHaveLength(2);
	});

	it('does not pair long form by time, and keeps a lone reel as a Short of its own', () => {
		const out = buildReleases([video('aaaaaaaaaaa', T0, { duration: 600 })], [reel('R1', T0 + 60_000)], []);
		expect(out).toHaveLength(2);
		const lone = out.find((r) => r.key === 'ig:R1')!;
		expect(lone.kind).toBe('short');
		expect(lone.privacy).toBe('public');
		expect(lone.title).toBe('Caption R1');
	});

	it('never guesses past an upload that names its own reel or video', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'youtube', remote_url: 'https://youtu.be/aaaaaaaaaaa', jobTitle: '' },
			{ job: 'j1', platform: 'instagram', remote_url: 'https://www.instagram.com/reel/GONE/', jobTitle: '' },
			{ job: 'j2', platform: 'youtube', remote_url: 'https://youtu.be/ccccccccccc', jobTitle: '' },
			{ job: 'j2', platform: 'instagram', remote_url: 'https://www.instagram.com/reel/R2/', jobTitle: '' }
		];
		// R1 is close to video a, but a's upload says its reel is GONE (not read);
		// R2 belongs to j2, whose video is not on this channel.
		const out = buildReleases(
			[video('aaaaaaaaaaa', T0)],
			[reel('R1', T0 + 60_000), reel('R2', T0 + 2 * 60_000)],
			targets
		);
		const a = out.find((r) => r.key === 'yt:aaaaaaaaaaa')!;
		expect(a.posts.instagram).toBeUndefined();
		expect(a.links.instagram).toBe('https://www.instagram.com/reel/GONE/');
		expect(out.find((r) => r.key === 'ig:R2')?.links.youtube).toBe('https://youtu.be/ccccccccccc');
	});

	it('pairs a reel from an upload of its own (a platform with its own file) by time', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'youtube', remote_url: 'https://youtu.be/aaaaaaaaaaa', jobTitle: '' },
			{ job: 'j2', platform: 'instagram', remote_url: 'https://www.instagram.com/reel/R1/', jobTitle: '' }
		];
		const out = buildReleases([video('aaaaaaaaaaa', T0)], [reel('R1', T0 + 60_000)], targets);
		expect(out).toHaveLength(1);
		expect(out[0].matched).toBe('time');
	});
});

describe('buildReleases with Facebook reels', () => {
	it('joins a Short and its Instagram reel by time, closest first', () => {
		const out = buildReleases(
			[video('aaaaaaaaaaa', T0), video('bbbbbbbbbbb', T0 + 3 * H)],
			[reel('R1', T0 + 5 * 60_000)],
			[],
			[fbReel('F1', T0 + 3 * H + 20 * 60_000), fbReel('F2', T0 + 6 * 60_000)]
		);
		expect(out).toHaveLength(2);
		const a = out.find((r) => r.key === 'yt:aaaaaaaaaaa')!;
		const b = out.find((r) => r.key === 'yt:bbbbbbbbbbb')!;
		expect(a.posts.instagram?.id).toBe('R1');
		expect(a.posts.facebook?.id).toBe('F2');
		expect(a.posts.facebook?.platform).toBe('facebook');
		expect(a.links.facebook).toBe('https://www.facebook.com/reel/F2/');
		expect(b.posts.facebook?.id).toBe('F1');
		expect(b.matched).toBe('time');
	});

	it('joins an Instagram reel that had no Short — a reel shared over to Facebook', () => {
		const out = buildReleases([], [reel('R1', T0)], [], [fbReel('F1', T0 + 30_000)]);
		expect(out).toHaveLength(1);
		expect(out[0].key).toBe('ig:R1');
		expect(out[0].posts.facebook?.id).toBe('F1');
		expect(out[0].matched).toBe('time');
	});

	it('takes the reel of the same flock upload, whatever the gap, and keeps the rest apart', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'youtube', remote_url: 'https://youtu.be/aaaaaaaaaaa', jobTitle: 'Job one' },
			{ job: 'j1', platform: 'facebook', remote_url: 'https://www.facebook.com/reel/F1', jobTitle: 'Job one' }
		];
		const out = buildReleases(
			[video('aaaaaaaaaaa', T0)],
			[],
			targets,
			[fbReel('F1', T0 + 5 * H), fbReel('F2', T0 + 60_000, { caption: 'Werbung\nA lone one' })]
		);
		const a = out.find((r) => r.key === 'yt:aaaaaaaaaaa')!;
		expect(a.posts.facebook?.id).toBe('F1');
		expect(a.matched).toBe('job');
		// F2 is close to a, but a's upload named its own Facebook reel.
		const lone = out.find((r) => r.key === 'fb:F2')!;
		expect(lone.kind).toBe('short');
		expect(lone.title).toBe('A lone one');
		expect(out).toHaveLength(2);
	});

	it('gives an Instagram-only upload its Facebook reel by the upload, and never pairs one another upload made', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'instagram', remote_url: 'https://www.instagram.com/reel/R1/', jobTitle: 'Reels only' },
			{ job: 'j1', platform: 'facebook', remote_url: 'https://www.facebook.com/reel/F1/', jobTitle: 'Reels only' },
			{ job: 'j2', platform: 'youtube', remote_url: 'https://youtu.be/zzzzzzzzzzz', jobTitle: '' },
			{ job: 'j2', platform: 'facebook', remote_url: 'https://www.facebook.com/reel/F2/', jobTitle: '' }
		];
		const out = buildReleases(
			[video('aaaaaaaaaaa', T0)],
			[reel('R1', T0 + 3 * H)],
			targets,
			[fbReel('F1', T0 + 9 * H), fbReel('F2', T0 + 60_000)]
		);
		const r1 = out.find((r) => r.key === 'ig:R1')!;
		expect(r1.title).toBe('Reels only');
		expect(r1.posts.facebook?.id).toBe('F1');
		expect(r1.matched).toBe('job');
		// F2's upload went to a YouTube video not on this channel: not a's.
		expect(out.find((r) => r.key === 'yt:aaaaaaaaaaa')!.posts.facebook).toBeUndefined();
		expect(out.find((r) => r.key === 'fb:F2')).toBeDefined();
	});

	it('adds Facebook up with the others', () => {
		const [a] = buildReleases([video('aaaaaaaaaaa', T0)], [reel('R1', T0)], [], [fbReel('F1', T0, { views: 7, likes: 1 })]);
		expect(sumOf(a, ['youtube', 'instagram', 'facebook'], 'views')).toBe(157);
		expect(sumOf(a, ['facebook'], 'likes')).toBe(1);
		const [today] = periodStats([a], DEFAULT_FILTER, new Date(T0 + H));
		expect(today.byPlatform.facebook.views).toBe(7);
	});
});

describe('buildReleases with TikTok videos', () => {
	it('compares TikTok links by video id, and a profile link not at all', () => {
		expect(tiktokId('https://www.tiktok.com/@OwlsNest/video/7400000000000000001?lang=en')).toBe('7400000000000000001');
		expect(tiktokId('https://www.tiktok.com/@owlsnest')).toBe('');
		expect(linkKey('tiktok', 'https://www.tiktok.com/@OwlsNest/video/7')).toBe(linkKey('tiktok', 'https://tiktok.com/@owlsnest/video/7/'));
		expect(linkKey('tiktok', 'https://www.tiktok.com/@owlsnest')).toBe('');
		expect(linkKey('instagram', 'https://www.instagram.com/reel/R1/')).toBe(sameLink('https://www.instagram.com/reel/R1/'));
	});

	it('takes the video of the same flock upload by its id, whatever the gap and the spelling of the handle', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'youtube', remote_url: 'https://youtu.be/aaaaaaaaaaa', jobTitle: 'Job one' },
			{ job: 'j1', platform: 'tiktok', remote_url: 'https://www.tiktok.com/@OwlsNest/video/71', jobTitle: 'Job one' }
		];
		const out = buildReleases([video('aaaaaaaaaaa', T0)], [], targets, [], [ttVideo('71', T0 + 6 * H), ttVideo('72', T0 + 60_000)]);
		const a = out.find((r) => r.key === 'yt:aaaaaaaaaaa')!;
		expect(a.posts.tiktok?.id).toBe('71');
		expect(a.posts.tiktok?.platform).toBe('tiktok');
		expect(a.links.tiktok).toBe('https://www.tiktok.com/@owlsnest/video/71');
		expect(a.matched).toBe('job');
		// 72 is close to it, but its upload named its own TikTok video.
		expect(out.find((r) => r.key === 'tt:72')).toBeDefined();
	});

	it('pairs by time past an upload whose TikTok link names only the profile', () => {
		const targets: TargetLink[] = [
			{ job: 'j1', platform: 'youtube', remote_url: 'https://youtu.be/aaaaaaaaaaa', jobTitle: 'Job one' },
			{ job: 'j1', platform: 'tiktok', remote_url: 'https://www.tiktok.com/@owlsnest', jobTitle: 'Job one' }
		];
		const [a, ...rest] = buildReleases([video('aaaaaaaaaaa', T0)], [], targets, [], [ttVideo('71', T0 + 10 * 60_000)]);
		expect(a.posts.tiktok?.id).toBe('71');
		expect(a.matched).toBe('time');
		expect(rest).toHaveLength(0);
	});

	it('joins a Short, or reels without one, by time; one left over is a release of its own, kind by its length', () => {
		const out = buildReleases(
			[video('aaaaaaaaaaa', T0)],
			[reel('R1', T0 + 3 * H)],
			[],
			[],
			[ttVideo('71', T0 + 5 * 60_000), ttVideo('72', T0 + 3 * H + 60_000), ttVideo('73', T0 + 9 * H, { duration: 600, caption: 'A long one' })]
		);
		expect(out.find((r) => r.key === 'yt:aaaaaaaaaaa')!.posts.tiktok?.id).toBe('71');
		// A release of a reel alone takes the TikTok video's picture and length.
		const r1 = out.find((r) => r.key === 'ig:R1')!;
		expect(r1.posts.tiktok?.id).toBe('72');
		expect(r1.thumb).toBe('https://p16.example/72.jpeg');
		expect(r1.duration).toBe(30);
		const lone = out.find((r) => r.key === 'tt:73')!;
		expect(lone.kind).toBe('long');
		expect(lone.title).toBe('A long one');
		expect(lone.thumb).toBe('https://p16.example/73.jpeg');
		expect(out).toHaveLength(3);
	});

	it('adds TikTok up with the others, in the periods too', () => {
		const [a] = buildReleases([video('aaaaaaaaaaa', T0)], [], [], [], [ttVideo('71', T0, { views: 9 })]);
		expect(sumOf(a, ['youtube', 'tiktok'], 'views')).toBe(109);
		const [today] = periodStats([a], DEFAULT_FILTER, new Date(T0 + H));
		expect(today.byPlatform.tiktok.views).toBe(9);
		expect(filterCounts([a], DEFAULT_FILTER).platforms.tiktok).toBe(1);
	});
});

describe('the filter', () => {
	const releases = buildReleases(
		[
			video('aaaaaaaaaaa', T0),
			video('bbbbbbbbbbb', T0 + D, { privacy: 'unlisted', duration: 600 }),
			video('ccccccccccc', T0 + 2 * D, { privacy: 'private' })
		],
		[reel('R1', T0 + 60_000), reel('R2', T0 + 5 * D)],
		[]
	);

	it('rebuilds a stored filter and falls back on what is wrong', () => {
		expect(readFilter(null)).toEqual(DEFAULT_FILTER);
		expect(readFilter({ platforms: [], kinds: ['short', 'bogus'], unlisted: 'yes' })).toEqual({
			...DEFAULT_FILTER,
			kinds: ['short']
		});
		expect(readFilter({ platforms: ['instagram', 'tiktok', 'bogus'] }).platforms).toEqual(['instagram', 'tiktok']);
		// Stored before there was a Hidden choice, and after.
		expect(readFilter({ unlisted: true }).hidden).toBe(false);
		expect(readFilter({ hidden: true }).hidden).toBe(true);
	});

	it('keeps a timeframe from the list, 30 days otherwise', () => {
		expect(DEFAULT_FILTER.days).toBe(30);
		expect(DASH_SPANS).toEqual([30, 60, 90, 120, 150, 180]);
		expect(readFilter({ days: 120 }).days).toBe(120);
		expect(readFilter({ days: '90' }).days).toBe(90);
		expect(readFilter({ days: 45 }).days).toBe(30);
		// Stored before there was a timeframe.
		expect(readFilter({ platforms: ['youtube'], kinds: ['short'] }).days).toBe(30);
	});

	it('takes in releases of the last days and those still to come', () => {
		const now = T0 + 100 * D;
		expect(inSpan({ at: now - 29 * D }, 30, now)).toBe(true);
		expect(inSpan({ at: now - 31 * D }, 30, now)).toBe(false);
		expect(inSpan({ at: now - 31 * D }, 60, now)).toBe(true);
		expect(inSpan({ at: now + 2 * D }, 30, now)).toBe(true);
	});

	it('lets a platform read since the filter was saved join a combined view only', () => {
		// Saved before Facebook was read: combined then, combined now.
		expect(readFilter({ platforms: ['youtube', 'instagram'] }).platforms).toEqual(['youtube', 'instagram', 'tiktok', 'facebook']);
		// Saved before TikTok's numbers, knowing the other three: combined, TikTok joins; a pick of some, it stays out.
		const known = ['youtube', 'instagram', 'facebook'];
		expect(readFilter({ platforms: ['youtube', 'instagram', 'facebook'], known }).platforms).toEqual([
			'youtube',
			'instagram',
			'tiktok',
			'facebook'
		]);
		expect(readFilter({ platforms: ['youtube', 'facebook'], known }).platforms).toEqual(['youtube', 'facebook']);
		expect(readFilter({ platforms: ['youtube'] }).platforms).toEqual(['youtube']);
		// Saved knowing Facebook and leaving it out: it stays out.
		const saved = JSON.parse(JSON.stringify(storedFilter({ ...DEFAULT_FILTER, platforms: ['youtube', 'instagram'] })));
		expect(readFilter(saved).platforms).toEqual(['youtube', 'instagram']);
		expect(readFilter(JSON.parse(JSON.stringify(storedFilter(DEFAULT_FILTER))))).toEqual(DEFAULT_FILTER);
	});

	it('reads visibility from YouTube only while YouTube is chosen', () => {
		const c = releases.find((r) => r.key === 'yt:ccccccccccc')!;
		expect(visibilityOf(c, ['youtube', 'instagram'])).toBe('private');
		expect(visibilityOf(c, ['instagram'])).toBe('public');
	});

	it('shows what is on a chosen platform, of a chosen kind, of an allowed visibility', () => {
		const shown = (f = DEFAULT_FILTER) => releases.filter((r) => inView(r, f)).map((r) => r.key);
		expect(shown()).toEqual(['yt:aaaaaaaaaaa', 'ig:R2']);
		expect(shown({ ...DEFAULT_FILTER, platforms: ['youtube'] })).toEqual(['yt:aaaaaaaaaaa']);
		expect(shown({ ...DEFAULT_FILTER, unlisted: true, private: true })).toHaveLength(4);
		expect(shown({ ...DEFAULT_FILTER, kinds: ['long'], unlisted: true })).toEqual(['yt:bbbbbbbbbbb']);
	});

	it('counts what each choice would add', () => {
		const counts = filterCounts(releases, DEFAULT_FILTER);
		expect(counts.kinds).toEqual({ short: 2, long: 0, live: 0, other: 0 });
		expect(counts.unlisted).toBe(1);
		expect(counts.private).toBe(1);
		expect(counts.platforms).toEqual({ youtube: 1, instagram: 2, tiktok: 0, facebook: 0 });
	});

	it('adds a counter up over the chosen platforms only', () => {
		const a = releases.find((r) => r.key === 'yt:aaaaaaaaaaa')!;
		expect(sumOf(a, ['youtube', 'instagram'], 'views')).toBe(150);
		expect(sumOf(a, ['instagram'], 'likes')).toBe(2);
		expect(sumOf(releases.find((r) => r.key === 'ig:R2')!, ['youtube'], 'views')).toBeNull();
	});
});

describe('judging against usual', () => {
	// Three peers watched from release, each with 100 views at 1 h and 400 at a week.
	const peers = [0, 1, 2].map((i) =>
		post(T0 + i * H, [
			[T0 + i * H + 10 * 60_000, 5],
			[T0 + i * H + H, 100],
			[T0 + i * H + 7 * D, 400]
		])
	);

	it('compares a young video at its own age', () => {
		const now = T0 + 30 * D;
		const young = post(now - H, [[now - H + 60_000, 0]], 150);
		const j = judge(young, [...peers, young], now);
		expect(j.age).toBe(H);
		expect(j.usual).toBe(100);
		expect(j.peers).toBe(3);
		expect(j.verdict).toBe('ahead');
	});

	it('compares an old video on its first week', () => {
		const now = T0 + 60 * D;
		const old = post(T0 + 10 * D, [
			[T0 + 10 * D + 60_000, 0],
			[T0 + 12 * D, 300],
			[T0 + 40 * D, 2000]
		]);
		const j = judge(old, [...peers, old], now);
		expect(j.age).toBe(COMPARE_AT_MS);
		expect(j.views).toBe(300);
		expect(j.verdict).toBe('behind');
	});

	it('has no verdict with too few peers or no read at that age', () => {
		const now = T0 + 30 * D;
		expect(judge(post(now - H, [], 50), peers.slice(0, 2), now).verdict).toBeNull();
		expect(verdictOf(null, 100)).toBeNull();
		expect(verdictOf(110, 100)).toBe('usual');
		expect(verdictOf(10, 0)).toBeNull();
	});

	it('groups peers by platform and kind, public only', () => {
		const releases = buildReleases(
			[video('aaaaaaaaaaa', T0), video('bbbbbbbbbbb', T0, { privacy: 'private' }), video('ccccccccccc', T0, { duration: 900 })],
			[],
			[]
		);
		const groups = peerGroups(releases);
		expect(groups.get('youtube:short')).toHaveLength(1);
		expect(groups.get('youtube:long')).toHaveLength(1);
	});

	it('works out views over usual across platforms judged on both', () => {
		const j = (views: number | null, usual: number | null) => ({
			platform: 'youtube' as const,
			age: H,
			views,
			usual,
			peers: 3,
			verdict: null
		});
		expect(ratioOf([j(150, 100), j(50, 100)])).toBe(1);
		expect(ratioOf([j(null, 100)])).toBeNull();
	});
});

describe('curve', () => {
	it('starts at 0 when read from release, and ends on the views now', () => {
		const now = T0 + 2 * H;
		const p = post(T0, [[T0 + 5 * 60_000, 3], [T0 + H, 50]], 70);
		const c = curve(p, [], now, 4);
		expect(c.span).toBe(2 * H);
		expect(c.line[0]).toEqual([0, 0]);
		expect(c.line[c.line.length - 1]).toEqual([2 * H, 70]);
		expect(c.usual).toEqual([]);
	});

	it('starts at the first read when flock came later, and draws nothing read after the week', () => {
		const late = post(T0, [[T0 + 2 * D, 500]], 600);
		const c = curve(late, [], T0 + 3 * D, 4);
		expect(c.line[0]).toEqual([2 * D, 500]);
		expect(curve(post(T0, [[T0 + 9 * D, 500]]), [], T0 + 20 * D).line).toEqual([]);
	});

	it('draws the peers’ middle over the same stretch', () => {
		const peers = [0, 1, 2].map((i) => post(T0 - 10 * D + i * H, [[T0 - 10 * D + i * H + 60_000, 0], [T0 - 10 * D + i * H + H, 100]]));
		const p = post(T0, [[T0 + 60_000, 0]], 10);
		const c = curve(p, peers, T0 + 2 * H, 2);
		expect(c.usual).toEqual([
			[0, 0],
			[H, 100],
			[2 * H, 100]
		]);
	});

	it('thins long lines and keeps the last point', () => {
		const points = Array.from({ length: 100 }, (_, i) => i);
		const out = thin(points, 10);
		expect(out).toHaveLength(10);
		expect(out[0]).toBe(0);
		expect(out[9]).toBe(99);
	});
});

describe('periodStats', () => {
	it('counts releases out in each period and the views gained, partly when unread at the start', () => {
		const now = new Date(2026, 9, 14, 12, 0); // Wednesday 14 Oct, local
		const today = new Date(2026, 9, 14, 8, 0).getTime();
		const lastWeek = new Date(2026, 9, 9, 8, 0).getTime();
		const history = (at: number, values: [number, number][]): Sample[] =>
			values.map(([offset, views]) => [iso(at + offset), views, null, null]);
		const releases = buildReleases(
			[
				video('aaaaaaaaaaa', today, { views: 300, history: history(today, [[60_000, 0], [H, 300]]) }),
				video('bbbbbbbbbbb', lastWeek, {
					views: 1000,
					history: history(lastWeek, [[60_000, 0], [D, 800], [4 * D + 12 * H, 1000]])
				})
			],
			[reel('R1', today + 30 * 60_000, { views: 40, history: history(today, [[H, 40]]) })],
			[]
		);
		const [day, week, month] = periodStats(releases, DEFAULT_FILTER, now);
		expect(day.released).toBe(1);
		expect(day.views).toBe(340);
		expect(day.byPlatform.instagram.views).toBe(40);
		// Since midnight: a 300 and its reel 40; b stood at 1000 from yesterday evening.
		expect(day.gained).toBe(340);
		expect(day.partly).toBe(false);
		expect(week.released).toBe(1);
		// Since Monday b also moved from 800 to 1000.
		expect(week.gained).toBe(540);
		expect(month.released).toBe(2);
		expect(month.views).toBe(1340);
	});

	it('runs from today to this year, quarters on the calendar', () => {
		const periods = periodStats([], DEFAULT_FILTER, new Date(2026, 10, 3, 12, 0));
		expect(periods.map((p) => p.key)).toEqual(['today', 'week', 'month', 'quarter', 'year']);
		expect(periods[3].from).toEqual(new Date(2026, 9, 1));
		expect(periods[4].from).toEqual(new Date(2026, 0, 1));
	});

	it("adds up the accounts' follower moves over the platforms in view", () => {
		const now = new Date(2026, 9, 14, 12, 0);
		const at = (d: number, h: number) => iso(new Date(2026, 9, d, h, 0).getTime());
		const state = (platform: 'youtube' | 'instagram' | 'facebook', history: [string, number][]) => ({
			platform,
			account: platform,
			name: platform,
			count: history[history.length - 1][1],
			at: iso(now.getTime()),
			since: history[0][0],
			history,
			credits: {},
			analytics: null,
			engaged: null,
			analyticsThrough: ''
		});
		const followers = [
			// Since midnight +3, since Monday the 12th +5.
			state('youtube', [[at(11, 9), 700], [at(13, 9), 702], [at(14, 9), 705]]),
			// First read this morning: counts from there, partly.
			state('instagram', [[at(14, 7), 50], [at(14, 10), 49]]),
			state('facebook', [[at(1, 0), 1016]])
		];
		const [day, week] = periodStats([], DEFAULT_FILTER, now, followers);
		expect(day.byPlatform.youtube.followers).toEqual({ gained: 3, partly: false });
		expect(day.byPlatform.instagram.followers).toEqual({ gained: -1, partly: true });
		expect(day.byPlatform.facebook.followers).toEqual({ gained: 0, partly: false });
		expect(day.followers).toEqual({ gained: 2, partly: true });
		expect(week.byPlatform.youtube.followers).toEqual({ gained: 5, partly: false });
		const ytOnly = periodStats([], { ...DEFAULT_FILTER, platforms: ['youtube'] }, now, followers);
		expect(ytOnly[0].followers).toEqual({ gained: 3, partly: false });
		expect(periodStats([], DEFAULT_FILTER, now)[0].followers).toBeNull();
	});
});

describe('sortRows', () => {
	const r = (key: string, at: number): Release => ({
		key,
		title: key,
		at,
		kind: 'short',
		privacy: 'public',
		duration: 0,
		thumb: '',
		posts: {},
		links: {},
		job: '',
		matched: ''
	});
	const rows = [
		{ release: r('old', 1), views: 50, likes: null, comments: 1, ratio: 2 },
		{ release: r('new', 3), views: 10, likes: 4, comments: 1, ratio: null },
		{ release: r('mid', 2), views: 90, likes: 2, comments: 1, ratio: 0.5 }
	];

	it('sorts by followers most first, unknown last either way', () => {
		const followed = rows.map((row, i) => ({ ...row, followers: [3, null, 7][i] }));
		expect(sortRows(followed, 'followers').map((x) => x.release.key)).toEqual(['mid', 'old', 'new']);
		expect(sortRows(followed, 'followers', true).map((x) => x.release.key)).toEqual(['old', 'mid', 'new']);
		expect(sortWords('followers', false)).toBe('most first');
	});

	it('sorts newest or most first, missing last, ties newest first', () => {
		expect(sortRows(rows, 'date').map((x) => x.release.key)).toEqual(['new', 'mid', 'old']);
		expect(sortRows(rows, 'views').map((x) => x.release.key)).toEqual(['mid', 'old', 'new']);
		expect(sortRows(rows, 'likes').map((x) => x.release.key)).toEqual(['new', 'mid', 'old']);
		expect(sortRows(rows, 'comments').map((x) => x.release.key)).toEqual(['new', 'mid', 'old']);
		expect(sortRows(rows, 'usual').map((x) => x.release.key)).toEqual(['old', 'mid', 'new']);
	});

	it('sorts the skip rate fewest first, missing last', () => {
		const skips = [
			{ ...rows[0], skip: 45 },
			{ ...rows[1], skip: null },
			{ ...rows[2], skip: 30 }
		];
		expect(sortRows(skips, 'skip').map((x) => x.release.key)).toEqual(['mid', 'old', 'new']);
	});

	it('turns round when reversed, still missing last', () => {
		expect(sortRows(rows, 'date', true).map((x) => x.release.key)).toEqual(['old', 'mid', 'new']);
		expect(sortRows(rows, 'views', true).map((x) => x.release.key)).toEqual(['new', 'old', 'mid']);
		// No likes on 'old': last either way.
		expect(sortRows(rows, 'likes', true).map((x) => x.release.key)).toEqual(['mid', 'new', 'old']);
		expect(sortRows(rows, 'usual', true).map((x) => x.release.key)).toEqual(['mid', 'old', 'new']);
		const skips = [
			{ ...rows[0], skip: 45 },
			{ ...rows[1], skip: null },
			{ ...rows[2], skip: 30 }
		];
		expect(sortRows(skips, 'skip', true).map((x) => x.release.key)).toEqual(['old', 'mid', 'new']);
	});

	it('says which way a column sorts', () => {
		expect(sortWords('views', false)).toBe('most first');
		expect(sortWords('views', true)).toBe('fewest first');
		expect(sortWords('date', true)).toBe('oldest first');
		expect(sortWords('skip', false)).toBe('fewest skipped first');
	});
});

describe('skip rate', () => {
	it("reads Instagram's rate, 0 and nonsense as not given", () => {
		expect(readSkipRate(37.3)).toBe(37.3);
		expect(readSkipRate(0)).toBeNull();
		expect(readSkipRate(null)).toBeNull();
		expect(readSkipRate('40')).toBeNull();
		expect(readSkipRate(140)).toBeNull();
	});

	it("carries a reel's rate onto its post, and a release's only while Instagram is in view", () => {
		const ig = reelPost(reel('R1', T0, { skipRate: 41.2 }));
		expect(ig.skipRate).toBe(41.2);
		expect(reelPost(reel('R2', T0)).skipRate).toBeNull();
		const [release] = buildReleases([], [reel('R1', T0, { skipRate: 41.2 })], []);
		expect(skipRateOf(release, ['youtube', 'instagram'])).toBe(41.2);
		expect(skipRateOf(release, ['youtube', 'facebook'])).toBeNull();
	});

	it("pools a Short's rate with its reel's over the platforms in view, never Facebook's", () => {
		const [release] = buildReleases(
			[video('S1', T0, { duration: 30, views: 1000, skipRate: 80 })],
			[reel('R1', T0 + 60_000, { views: 500, skipRate: 40 })],
			[],
			[fbReel('F1', T0 + 60_000, { views: 300 })]
		);
		expect(release.posts.youtube?.skipRate).toBe(80);
		expect(skipRateOf(release, ['youtube', 'instagram', 'facebook'])).toBeCloseTo(((800 + 200) / 1500) * 100);
		expect(skipRateOf(release, ['instagram'])).toBe(40);
		expect(skipRateOf(release, ['youtube'])).toBe(80);
		expect(skipRateOf(release, ['facebook'])).toBeNull();
		expect(skipPosts(release, ['facebook', 'instagram', 'youtube']).map((p) => p.platform)).toEqual(['youtube', 'instagram']);
	});

	it('pools rates by views, leaving out reels without both', () => {
		expect(
			pooledSkipRate([
				{ views: 1000, skipRate: 30 },
				{ views: 100, skipRate: 80 },
				{ views: 500, skipRate: null },
				{ views: null, skipRate: 50 }
			])
		).toBeCloseTo((300 + 80) / 1100 * 100);
		expect(pooledSkipRate([{ views: 10, skipRate: null }])).toBeNull();
	});
});
