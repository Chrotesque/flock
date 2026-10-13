import { describe, expect, it } from 'vitest';
import {
	ago,
	latestReleases,
	periodTotals,
	periods,
	postsPerPlatform,
	upcoming,
	viewsAt,
	type DashTarget,
	type StatsVideo
} from './dashboard';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = new Date(2026, 9, 14, 15, 0); // Wed 14 Oct 2026, 15:00 local
const now = NOW.getTime();

function video(id: string, publishedAgoH: number, samples: [number, number][], privacy = 'public'): StatsVideo {
	const out = now - publishedAgoH * H;
	return {
		video_id: id,
		title: id,
		published_at: iso(out),
		privacy,
		views: samples.length ? samples[samples.length - 1][1] : 0,
		duration: 30,
		history: samples.map(([h, v]) => [iso(out + h * H), v, 0, 0])
	};
}

describe('periods', () => {
	it('starts today at midnight, the week on Monday and the month on the 1st', () => {
		const [today, week, month] = periods(NOW);
		expect(today.from).toEqual(new Date(2026, 9, 14));
		expect(week.from).toEqual(new Date(2026, 9, 12));
		expect(month.from).toEqual(new Date(2026, 9, 1));
	});
});

describe('viewsAt', () => {
	const v = video('a', 10, [[0, 0], [1, 50], [5, 200]]);
	it('holds the last sample at or before the moment', () => {
		expect(viewsAt(v, now - 10 * H + 3 * H)).toBe(50);
		expect(viewsAt(v, now)).toBe(200);
	});
	it('is 0 before release and null before flock was watching', () => {
		expect(viewsAt(v, now - 11 * H)).toBe(0);
		const late = video('b', 10, [[4, 100], [6, 150]]);
		expect(viewsAt(late, now - 10 * H + 2 * H)).toBeNull();
	});
});

describe('periodTotals', () => {
	it('counts what went out in the period and the views on it, and what everything gained', () => {
		const videos = [
			video('today', 3, [[0, 0], [2, 40]]),
			video('monday', 40, [[0, 0], [10, 300], [30, 500]]),
			video('old', 24 * 30, [[0, 0], [24 * 29, 1000], [24 * 30 - 1, 1100]]),
			video('private', 2, [[0, 0]], 'private')
		];
		const [today, week] = periods(NOW).map((p) => periodTotals(videos, p.from, NOW));
		expect(today).toMatchObject({ released: 1, viewsOnReleased: 40, gainedPartly: false });
		// Today (since 00:00, 15 h ago): today 40 + monday 200 (300 → 500, 10 h ago) + old 100.
		expect(today.gained).toBe(340);
		expect(week).toMatchObject({ released: 2, viewsOnReleased: 540 });
	});

	it('says when a count at the start was not known', () => {
		const late = video('late', 24 * 20, [[24 * 19, 500], [24 * 20 - 1, 600]]);
		const [, week] = periods(NOW).map((p) => periodTotals([late], p.from, NOW));
		expect(week).toMatchObject({ gained: 100, gainedPartly: true });
	});
});

const target = (over: Partial<DashTarget>): DashTarget => ({
	id: 't',
	job: 'j',
	platform: 'tiktok',
	status: 'pending',
	scheduled_at: iso(now + H),
	title: 'Clip',
	visibility: '',
	jobTitle: 'Clip',
	jobCreated: iso(now - 2 * H),
	importing: false,
	jobError: '',
	...over
});
describe('postsPerPlatform', () => {
	it('counts published posts in the period per platform asked for', () => {
		const counts = postsPerPlatform(
			[
				target({ status: 'published', published_at: iso(now - H) }),
				target({ status: 'published', platform: 'instagram', published_at: iso(now - 30 * 24 * H) }),
				target({ status: 'pending' }),
				target({ status: 'published', platform: 'youtube', published_at: iso(now - H) })
			],
			new Date(2026, 9, 14),
			NOW,
			['instagram', 'tiktok']
		);
		expect(counts).toEqual({ tiktok: 1 });
	});
});

describe('upcoming', () => {
	it('lists the next days with their posts in order, empty days kept', () => {
		const days = upcoming(
			[
				target({ id: 'b', scheduled_at: iso(new Date(2026, 9, 15, 18).getTime()) }),
				target({ id: 'a', scheduled_at: iso(new Date(2026, 9, 15, 9).getTime()) }),
				target({ id: 'past', scheduled_at: iso(now - H) }),
				target({ id: 'done', status: 'published', scheduled_at: iso(now + H) }),
				target({ id: 'far', scheduled_at: iso(new Date(2026, 9, 22, 9).getTime()) })
			],
			NOW
		);
		expect(days).toHaveLength(7);
		expect(days[0].posts).toEqual([]);
		expect(days[1].posts.map((p) => p.id)).toEqual(['a', 'b']);
		expect(days.flatMap((d) => d.posts).map((p) => p.id)).toEqual(['a', 'b']);
	});
});

describe('latestReleases', () => {
	it('sets each new video against the channel at the same age', () => {
		const peers = [1, 2, 3].map((n) => video(`p${n}`, 100 + n, [[0, 0], [2, 100], [24, 1000]]));
		const fast = video('fast', 2, [[0, 0], [1, 150], [2, 300]]);
		const slow = video('slow', 3, [[0, 0], [2, 20]]);
		const [first, second] = latestReleases([...peers, fast, slow], NOW);
		expect(first.video.video_id).toBe('fast');
		expect(first.usual).toBe(100);
		expect(first.verdict).toBe('ahead');
		expect(second.verdict).toBe('behind');
		expect(first.points[0]).toEqual([0, 0]);
		expect(first.points[first.points.length - 1]).toEqual([2 * H, 300]);
	});

	it('gives no verdict without three videos watched from release', () => {
		const unwatched = [1, 2, 3].map((n) => video(`u${n}`, 100 + n, [[50, 900]]));
		const [latest] = latestReleases([...unwatched, video('new', 2, [[0, 0], [2, 50]])], NOW);
		expect(latest.usual).toBeNull();
		expect(latest.verdict).toBeNull();
	});
});

describe('ago', () => {
	it('words a span', () => {
		expect(ago(12 * 60_000)).toBe('12 min');
		expect(ago(3 * H)).toBe('3 h');
		expect(ago(72 * H)).toBe('3 days');
	});
});
