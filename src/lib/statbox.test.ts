import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LAYOUT,
	FLOCK_BOXES,
	boxFilter,
	boxName,
	boxPeriod,
	canEditBox,
	copyBox,
	creatorWords,
	howFits,
	moveBox,
	moveMetric,
	newBox,
	placeBox,
	placedBoxes,
	readLayout,
	readStatBox,
	readStatBoxes,
	suggestedName,
	toggleIn,
	twinOf,
	boxRates,
	toggleMetric,
	unplaceBox,
	withHow,
	withTimeframe,
	type StatBox
} from './statbox';
import type { Post, Release } from './releases';

const me = { id: 'p1', name: 'Pat' };
const box = (over: Partial<StatBox> = {}): StatBox => ({ ...newBox('b1', me), ...over });

describe('flock boxes', () => {
	it('are the strip as it was: today to this year, videos, views and follows', () => {
		expect(FLOCK_BOXES.map((b) => b.name)).toEqual(['Today', 'This week', 'This month', 'This quarter', 'This year']);
		expect(FLOCK_BOXES.every((b) => b.how === 'total' && b.metrics.join() === 'videos,views,follows')).toBe(true);
		expect(DEFAULT_LAYOUT).toEqual(['flock:today', 'flock:week', 'flock:month', 'flock:quarter', 'flock:year']);
	});

	it('cannot be changed by anyone, only copied', () => {
		expect(canEditBox(FLOCK_BOXES[0], 'p1', ['p1'])).toBe(false);
		const copy = copyBox(FLOCK_BOXES[2], 'c1', me);
		expect(copy).toMatchObject({ id: 'c1', name: 'This month (copy)', creator: 'p1', creatorName: 'Pat' });
		expect(creatorWords(FLOCK_BOXES[0], [])).toBe('flock');
	});
});

describe('what fits', () => {
	it('an average period needs a calendar period, an average video at least a week', () => {
		expect(howFits('average', { kind: 'period', period: 'month' })).toBe(true);
		expect(howFits('average', { kind: 'period', period: 'lifetime' })).toBe(false);
		expect(howFits('average', { kind: 'days', days: 30 })).toBe(false);
		expect(howFits('video', { kind: 'period', period: 'today' })).toBe(false);
		expect(howFits('video', { kind: 'range', from: '2026-11-01', to: 'today' })).toBe(true);
	});

	it('a timeframe the way does not fit makes the box a total', () => {
		const b = withTimeframe(box({ how: 'average', metrics: ['views'] }), { kind: 'days', days: 7 });
		expect(b.how).toBe('total');
	});

	it('an average video has no count of videos; views stand in when nothing is left', () => {
		expect(withHow(box({ metrics: ['videos', 'likes'] }), 'video').metrics).toEqual(['likes']);
		expect(withHow(box({ metrics: ['videos'] }), 'video').metrics).toEqual(['views']);
		expect(toggleMetric(box({ how: 'video', metrics: ['views'] }), 'videos').metrics).toEqual(['views']);
	});
});

describe('building', () => {
	it('adds numbers at the end, keeps the last, moves them', () => {
		let b = box({ metrics: ['views'] });
		b = toggleMetric(b, 'comments');
		expect(b.metrics).toEqual(['views', 'comments']);
		expect(moveMetric(b, 'comments', -1).metrics).toEqual(['comments', 'views']);
		expect(moveMetric(b, 'views', -1).metrics).toEqual(['views', 'comments']);
		expect(toggleMetric(box({ metrics: ['views'] }), 'views').metrics).toEqual(['views']);
	});

	it('keeps platforms and kinds in their order and never empty', () => {
		expect(toggleIn(['tiktok'], 'youtube', ['youtube', 'instagram', 'tiktok'])).toEqual(['youtube', 'tiktok']);
		expect(toggleIn(['tiktok'], 'tiktok', ['youtube', 'tiktok'])).toEqual(['tiktok']);
	});

	it('suggests a name from what it counts', () => {
		expect(suggestedName(box())).toBe('This month');
		expect(suggestedName(box({ how: 'average', timeframe: { kind: 'period', period: 'week' } }))).toBe('Average week');
		expect(suggestedName(box({ how: 'video', timeframe: { kind: 'period', period: 'lifetime' } }))).toBe('Video · lifetime');
		expect(suggestedName(box({ how: 'video', timeframe: { kind: 'days', days: 30 } }))).toBe('Video · last 30 days');
		expect(suggestedName(box({ kinds: ['short'], platforms: ['youtube', 'tiktok'] }))).toBe('This month · Shorts · YouTube, TikTok');
		expect(boxName(box({ name: '  Mine ' }))).toBe('Mine');
	});
});

describe('who may change a box', () => {
	it('its maker, or anyone once the maker is gone', () => {
		expect(canEditBox(box(), 'p1', ['p1', 'p2'])).toBe(true);
		expect(canEditBox(box(), 'p2', ['p1', 'p2'])).toBe(false);
		expect(canEditBox(box(), 'p2', ['p2'])).toBe(true);
		expect(creatorWords(box(), [{ id: 'p1', name: 'Pat R.' }])).toBe('Pat R.');
		expect(creatorWords(box(), [])).toBe('Pat');
	});
});

describe('reading back', () => {
	it('rebuilds a box field by field', () => {
		const read = readStatBox({
			id: 'x',
			name: 'Shorts',
			timeframe: { kind: 'days', days: 30 },
			how: 'average',
			metrics: ['views', 'views', 'nonsense'],
			platforms: [],
			kinds: ['short', 'odd'],
			creator: 'p1',
			creatorName: 'Pat'
		});
		expect(read).toMatchObject({ how: 'total', metrics: ['views'], kinds: ['short'] });
		expect(read?.platforms).toHaveLength(4);
		expect(readStatBox({ id: 'x', timeframe: { kind: 'days', days: 0 } })).toBeNull();
		expect(readStatBox({ id: 'x', timeframe: { kind: 'range', from: '2026-11-05', to: '2026-11-01' } })).toBeNull();
	});

	it('never takes flock’s ids or a second copy of an id from the row, nor a box claiming to be flock’s', () => {
		const t = { kind: 'period', period: 'month' };
		const boxes = readStatBoxes({
			boxes: [
				{ id: 'flock:month', timeframe: t },
				{ id: 'a', timeframe: t, creator: 'flock' },
				{ id: 'a', timeframe: t }
			]
		});
		expect(boxes.map((b) => b.id)).toEqual(['a']);
		expect(boxes[0].creator).toBe('unknown');
		expect(readStatBoxes(null)).toEqual([]);
	});

	it('a layout: flock’s boxes until one is stored, each id once', () => {
		expect(readLayout(undefined)).toEqual(DEFAULT_LAYOUT);
		expect(readLayout([])).toEqual([]);
		expect(readLayout(['a', 'b', 'a', 3])).toEqual(['a', 'b']);
	});
});

describe('the row', () => {
	it('places, takes off and moves boxes', () => {
		expect(placeBox(['a'], 'b')).toEqual(['a', 'b']);
		expect(placeBox(['a'], 'a')).toEqual(['a']);
		expect(unplaceBox(['a', 'b'], 'a')).toEqual(['b']);
		expect(moveBox(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
		expect(moveBox(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
	});

	it('skips a box deleted since', () => {
		expect(placedBoxes(['flock:week', 'gone'], FLOCK_BOXES).map((b) => b.id)).toEqual(['flock:week']);
	});
});

describe('counting', () => {
	const now = new Date(2026, 10, 4, 15);

	it('the last N days are local days, today the last', () => {
		const f = boxFilter(box({ timeframe: { kind: 'days', days: 3 } }), now);
		expect(f.range).toEqual({ from: '2026-11-02', to: 'today' });
		expect(boxPeriod(box({ timeframe: { kind: 'days', days: 3 } }))).toBe('lifetime');
	});

	it('a period box has no range, and its own platforms and kinds', () => {
		const f = boxFilter(box({ platforms: ['tiktok'], kinds: ['short'] }), now);
		expect(f).toMatchObject({ range: null, platforms: ['tiktok'], kinds: ['short'], hidden: false });
		expect(boxPeriod(box())).toBe('month');
	});
});

describe('twins', () => {
	it('counts two boxes alike by everything but name, id and maker', () => {
		const a = box({ name: 'Mine' });
		const b = { ...box(), id: 'b2', name: 'Other', creator: 'p9' };
		expect(twinOf(b, [a])?.id).toBe('b1');
		expect(twinOf({ ...b, metrics: ['likes', 'videos', 'views', 'follows'] }, [a])).toBeUndefined();
		expect(twinOf(a, [a])).toBeUndefined();
		expect(twinOf(copyBox(FLOCK_BOXES[1], 'c', me), FLOCK_BOXES)?.id).toBe('flock:week');
	});
});

describe('rates', () => {
	const T = Date.parse('2026-10-20T12:00:00Z');
	const H = 3600_000;
	const post = (platform: Post['platform'], at: number, views: number, likes: number, comments: number, skipRate?: number): Post => ({
		platform,
		record: `${platform}${at}`,
		id: `${platform}${at}`,
		url: '',
		at,
		views,
		likes,
		comments,
		followers: null,
		samples: [[at + 7 * 24 * H, views]],
		skipRate
	});
	const rel = (at: number, posts: Post[]): Release => ({
		key: String(at),
		title: '',
		at,
		kind: 'short',
		privacy: 'public',
		duration: 30,
		thumb: '',
		posts: Object.fromEntries(posts.map((p) => [p.platform, p])),
		links: {},
		job: '',
		matched: ''
	});
	const all = boxFilter(box(), new Date(T));

	it('pools skip and engagement by views over the videos in the stretch only', () => {
		const a = rel(T, [post('youtube', T, 1000, 40, 10, 20), post('instagram', T, 1000, 10, 0, 40)]);
		const late = rel(T + 10 * H, [post('youtube', T + 10 * H, 5000, 0, 0, 90)]);
		const r = boxRates([a, late], all, T - H, T + H, T + 20 * H, [a, late]);
		expect(r.videos).toBe(1);
		expect(r.skip).toBeCloseTo(30);
		expect(r.engaged).toBeCloseTo(3);
		expect(r.byPlatform.youtube.engaged).toBeCloseTo(5);
		expect(r.byPlatform.tiktok.engaged).toBeNull();
	});

	it('has no usual without peers to compare with', () => {
		const a = rel(T, [post('youtube', T, 1000, 0, 0)]);
		expect(boxRates([a], all, T - H, T + H, T + 9 * 24 * H, [a]).usual).toBeNull();
	});
});
