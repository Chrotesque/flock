/**
 * The Dashboard's stat boxes. A box is built under Settings → Dashboard →
 * Stat boxes and placed on the Dashboard in its Edit mode. It carries
 * everything it counts — a timeframe, how the numbers are taken (a total, an
 * average period, an average video), which numbers, and which platforms and
 * kinds of video — so the Dashboard's filter, which is the list's alone, never
 * reaches it. It follows the brand in view, like everything on the Dashboard.
 *
 * The boxes are shared by every profile (`app_settings` / `dashboard_boxes`),
 * each naming who made it; flock's own (FLOCK_BOXES, the strip as it was up to
 * 0.20.11) live here, not in the row, and cannot be changed — only copied.
 * Which boxes a profile's Dashboard shows, and in what order, is its own
 * (`general.dashboardBoxes`, a list of ids).
 *
 * The arithmetic is releases.ts's: a box only says which of `statsOfPeriod`,
 * `periodAverage` and `videoAverage` to run, over what.
 */
import { isoDate } from './format';
import { PLATFORMS } from './platforms';
import { engagedRate } from './ratioview';
import {
	PERIOD_KEYS,
	judge,
	overallOf,
	peerGroups,
	pooledSkipRate,
	skipPosts,
	visibilityOf,
	type Overall,
	type Post,
	PERIOD_LABELS,
	STAT_PLATFORMS,
	dayAt,
	inView,
	readRange,
	timeframeWords,
	type DashFilter,
	type DashRange,
	type PeriodKey,
	type Release,
	type StatPlatform
} from './releases';
import { KIND_LABELS, KIND_ORDER, type VideoKind } from './videokind';

/** A box's numbers as they are: a total over the timeframe, an average whole period, or an average video. */
export type BoxHow = 'total' | 'average' | 'video';

export const BOX_HOWS: BoxHow[] = ['total', 'average', 'video'];

export const HOW_LABELS: Record<BoxHow, string> = {
	total: 'Total',
	average: 'Average period',
	video: 'Per video'
};

export type BoxMetric = 'videos' | 'views' | 'likes' | 'comments' | 'follows' | 'skip' | 'engaged' | 'usual';

export const BOX_METRICS: BoxMetric[] = ['videos', 'views', 'likes', 'comments', 'follows', 'skip', 'engaged', 'usual'];

/** The unit under each number, and the metric's name in the builder. */
export const METRIC_LABELS: Record<BoxMetric, string> = {
	videos: 'videos',
	views: 'views',
	likes: 'likes',
	comments: 'comments',
	follows: 'follows',
	skip: 'skipped',
	engaged: 'engaged',
	usual: 'vs usual'
};

/** The numbers that are rates over the videos counted, not sums: the same however a box takes them. */
export const RATE_METRICS: BoxMetric[] = ['skip', 'engaged', 'usual'];

/** The day, week, month, quarter or year running, or the lifetime; the last N days; or a range of dates. */
export type BoxTimeframe =
	| { kind: 'period'; period: PeriodKey }
	| { kind: 'days'; days: number }
	| ({ kind: 'range' } & DashRange);

/** The last N days a box can count: up to two years. */
export const MAX_BOX_DAYS = 730;

export interface StatBox {
	id: string;
	/** What the Dashboard shows over it; empty is the suggested name (`suggestedName`). */
	name: string;
	timeframe: BoxTimeframe;
	how: BoxHow;
	/** In the order they are shown. */
	metrics: BoxMetric[];
	platforms: StatPlatform[];
	kinds: VideoKind[];
	/** The profile that made it, or FLOCK_CREATOR. */
	creator: string;
	/** Its name when the box was made, for a profile deleted since. */
	creatorName: string;
}

export const FLOCK_CREATOR = 'flock';

const flockBox = (period: PeriodKey): StatBox => ({
	id: `flock:${period}`,
	name: PERIOD_LABELS[period],
	timeframe: { kind: 'period', period },
	how: 'total',
	metrics: ['videos', 'views', 'follows'],
	platforms: [...STAT_PLATFORMS],
	kinds: [...KIND_ORDER],
	creator: FLOCK_CREATOR,
	creatorName: 'flock'
});

/** flock's own boxes: the strip the Dashboard had up to 0.20.11. */
export const FLOCK_BOXES: StatBox[] = (['today', 'week', 'month', 'quarter', 'year'] as const).map(flockBox);

/** A profile's Dashboard until it places boxes of its own. */
export const DEFAULT_LAYOUT: string[] = FLOCK_BOXES.map((b) => b.id);

export function isFlockBox(box: Pick<StatBox, 'creator'>): boolean {
	return box.creator === FLOCK_CREATOR;
}

/* ---- what goes with what ---- */

const AVERAGE_PERIODS: PeriodKey[] = ['today', 'week', 'month', 'quarter', 'year'];
const VIDEO_PERIODS: PeriodKey[] = ['week', 'month', 'quarter', 'year', 'lifetime'];

/** Whether a box over this timeframe can take its numbers this way: an average period needs a calendar period to repeat. */
export function howFits(how: BoxHow, timeframe: BoxTimeframe): boolean {
	if (how === 'total') return true;
	if (how === 'average') return timeframe.kind === 'period' && AVERAGE_PERIODS.includes(timeframe.period);
	return timeframe.kind !== 'period' || VIDEO_PERIODS.includes(timeframe.period);
}

/** Why a way does not fit a timeframe, for the builder; '' when it does. */
export function howRefusal(how: BoxHow, timeframe: BoxTimeframe): string {
	if (howFits(how, timeframe)) return '';
	if (how === 'average') return 'An average period needs a day, week, month, quarter or year to repeat.';
	return 'An average video needs at least a week: a day has too few.';
}

/** The numbers a way offers: an average video is one video, so it has no count of videos. */
export function metricFits(metric: BoxMetric, how: BoxHow): boolean {
	return !(metric === 'videos' && how === 'video');
}

/* ---- reading back ---- */

function readTimeframe(raw: unknown): BoxTimeframe | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (r.kind === 'period' && PERIOD_KEYS.includes(r.period as PeriodKey)) return { kind: 'period', period: r.period as PeriodKey };
	if (r.kind === 'days') {
		const days = Math.round(Number(r.days));
		return days >= 1 && days <= MAX_BOX_DAYS ? { kind: 'days', days } : null;
	}
	if (r.kind === 'range') {
		const range = readRange(r);
		return range && { kind: 'range', ...range };
	}
	return null;
}

/**
 * A box made whole: a way that does not fit its timeframe becomes a total,
 * numbers the way does not offer go (none left is views), no platform or
 * kind is every one, and repeats go.
 */
export function wholeBox(box: StatBox): StatBox {
	const how = howFits(box.how, box.timeframe) ? box.how : 'total';
	const metrics = [...new Set(box.metrics)].filter((m) => BOX_METRICS.includes(m) && metricFits(m, how));
	const platforms = STAT_PLATFORMS.filter((p) => box.platforms.includes(p));
	const kinds = KIND_ORDER.filter((k) => box.kinds.includes(k));
	return {
		...box,
		name: box.name.trim().slice(0, NAME_MAX),
		how,
		metrics: metrics.length > 0 ? metrics : ['views'],
		platforms: platforms.length > 0 ? platforms : [...STAT_PLATFORMS],
		kinds: kinds.length > 0 ? kinds : [...KIND_ORDER]
	};
}

export const NAME_MAX = 60;

/** A stored box, field by field; null when it is not one. */
export function readStatBox(raw: unknown): StatBox | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const timeframe = readTimeframe(r.timeframe);
	if (typeof r.id !== 'string' || !r.id || !timeframe) return null;
	const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
	return wholeBox({
		id: r.id,
		name: typeof r.name === 'string' ? r.name : '',
		timeframe,
		how: BOX_HOWS.includes(r.how as BoxHow) ? (r.how as BoxHow) : 'total',
		metrics: list(r.metrics) as BoxMetric[],
		platforms: list(r.platforms) as StatPlatform[],
		kinds: list(r.kinds) as VideoKind[],
		creator: typeof r.creator === 'string' && r.creator && r.creator !== FLOCK_CREATOR ? r.creator : 'unknown',
		creatorName: typeof r.creatorName === 'string' ? r.creatorName : ''
	});
}

/** The shared row's boxes; flock's ids are its own and never read from it. */
export function readStatBoxes(raw: unknown): StatBox[] {
	const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).boxes : null;
	if (!Array.isArray(list)) return [];
	const seen = new Set(DEFAULT_LAYOUT);
	const out: StatBox[] = [];
	for (const item of list) {
		const box = readStatBox(item);
		if (!box || seen.has(box.id)) continue;
		seen.add(box.id);
		out.push(box);
	}
	return out;
}

/** A stored layout: the ids in order, once each. Nothing stored is flock's boxes. */
export function readLayout(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [...DEFAULT_LAYOUT];
	return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/* ---- names ---- */

const PERIOD_NOUN: Record<PeriodKey, string> = {
	today: 'day',
	week: 'week',
	month: 'month',
	quarter: 'quarter',
	year: 'year',
	lifetime: 'lifetime'
};

export function timeframeLabel(timeframe: BoxTimeframe, locale?: string): string {
	if (timeframe.kind === 'period') return PERIOD_LABELS[timeframe.period];
	if (timeframe.kind === 'days') return timeframe.days === 1 ? 'Last day' : `Last ${timeframe.days} days`;
	return timeframeWords({ days: 0, range: { from: timeframe.from, to: timeframe.to } }, locale);
}

/** What a box would be called by what it counts: "This month", "Average week", "Video · average month · Shorts". */
export function suggestedName(box: Pick<StatBox, 'timeframe' | 'how' | 'platforms' | 'kinds'>, locale?: string): string {
	const t = box.timeframe;
	let name: string;
	if (box.how === 'average' && t.kind === 'period') name = `Average ${PERIOD_NOUN[t.period]}`;
	else if (box.how === 'video')
		name =
			t.kind === 'period'
				? t.period === 'lifetime'
					? 'Video · lifetime'
					: `Video · average ${PERIOD_NOUN[t.period]}`
				: `Video · ${t.kind === 'days' ? timeframeLabel(t, locale).toLowerCase() : timeframeLabel(t, locale)}`;
	else name = timeframeLabel(t, locale);
	const parts = [name];
	if (box.kinds.length < KIND_ORDER.length) parts.push(box.kinds.map((k) => KIND_LABELS[k]).join(', '));
	if (box.platforms.length < STAT_PLATFORMS.length) parts.push(box.platforms.map((p) => PLATFORMS[p].label).join(', '));
	return parts.join(' · ');
}

/** The name on the Dashboard: the one given, else the suggested one. */
export function boxName(box: StatBox, locale?: string): string {
	return box.name.trim() || suggestedName(box, locale);
}

/** What a box counts, in a line: "This month · total · videos, views, follows · every platform · Shorts". */
export function boxSummary(box: StatBox, locale?: string): string {
	const how =
		box.how === 'total'
			? 'total'
			: box.how === 'average'
				? 'an average period'
				: 'an average video';
	const platforms =
		box.platforms.length === STAT_PLATFORMS.length ? 'every platform' : box.platforms.map((p) => PLATFORMS[p].label).join(', ');
	const kinds = box.kinds.length === KIND_ORDER.length ? 'every kind' : box.kinds.map((k) => KIND_LABELS[k]).join(', ');
	return [timeframeLabel(box.timeframe, locale), how, box.metrics.map((m) => METRIC_LABELS[m]).join(', '), platforms, kinds].join(' · ');
}

/** Who made a box, in words: "flock", the profile's name now, or its name then. */
export function creatorWords(box: StatBox, profiles: { id: string; name: string }[]): string {
	if (isFlockBox(box)) return 'flock';
	return profiles.find((p) => p.id === box.creator)?.name ?? (box.creatorName || 'someone');
}

/** Whether this profile may change or delete a box: its own, or one whose maker is gone. flock's never. */
export function canEditBox(box: StatBox, profileId: string, profileIds: string[]): boolean {
	if (isFlockBox(box)) return false;
	return box.creator === profileId || !profileIds.includes(box.creator);
}

/* ---- building ---- */

/** A new box, made by `creator`: this month's videos, views, likes and follows on every platform. */
export function newBox(id: string, creator: { id: string; name: string }): StatBox {
	return {
		id,
		name: '',
		timeframe: { kind: 'period', period: 'month' },
		how: 'total',
		metrics: ['videos', 'views', 'likes', 'follows'],
		platforms: [...STAT_PLATFORMS],
		kinds: [...KIND_ORDER],
		creator: creator.id,
		creatorName: creator.name
	};
}

/** A copy of a box, made by `creator`: its name says it is one. */
export function copyBox(box: StatBox, id: string, creator: { id: string; name: string }, locale?: string): StatBox {
	return {
		...box,
		id,
		name: `${boxName(box, locale)} (copy)`.slice(0, NAME_MAX),
		metrics: [...box.metrics],
		platforms: [...box.platforms],
		kinds: [...box.kinds],
		timeframe: { ...box.timeframe },
		creator: creator.id,
		creatorName: creator.name
	};
}

/** A box with this way of counting; a way that drops the videos count gives the box views if nothing is left. */
export function withHow(box: StatBox, how: BoxHow): StatBox {
	return wholeBox({ ...box, how });
}

/** A box over another timeframe; a way that no longer fits becomes a total. */
export function withTimeframe(box: StatBox, timeframe: BoxTimeframe): StatBox {
	return wholeBox({ ...box, timeframe });
}

/** A number added at the end, or taken out (the last one stays). */
export function toggleMetric(box: StatBox, metric: BoxMetric): StatBox {
	if (box.metrics.includes(metric)) {
		return box.metrics.length > 1 ? { ...box, metrics: box.metrics.filter((m) => m !== metric) } : box;
	}
	return metricFits(metric, box.how) ? { ...box, metrics: [...box.metrics, metric] } : box;
}

/** A number moved one place earlier (-1) or later (+1). */
export function moveMetric(box: StatBox, metric: BoxMetric, by: -1 | 1): StatBox {
	const at = box.metrics.indexOf(metric);
	const to = at + by;
	if (at < 0 || to < 0 || to >= box.metrics.length) return box;
	const metrics = [...box.metrics];
	[metrics[at], metrics[to]] = [metrics[to], metrics[at]];
	return { ...box, metrics };
}

/** A platform or kind added or taken out; the last one stays. */
export function toggleIn<T>(list: T[], item: T, order: T[]): T[] {
	if (list.includes(item)) return list.length > 1 ? list.filter((x) => x !== item) : list;
	return order.filter((x) => list.includes(x) || x === item);
}

/* ---- counting ---- */

/**
 * The filter a box's numbers are worked out under (releases.ts): its
 * platforms and kinds, public videos only, and a date range for the last N
 * days (local days, today the last) or the range it names.
 */
export function boxFilter(box: StatBox, now: Date): DashFilter {
	const t = box.timeframe;
	let range: DashRange | null = null;
	if (t.kind === 'range') range = { from: t.from, to: t.to };
	if (t.kind === 'days') {
		const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (t.days - 1));
		range = { from: isoDate(from), to: 'today' };
	}
	return {
		platforms: [...box.platforms],
		kinds: [...box.kinds],
		unlisted: false,
		private: false,
		hidden: false,
		days: 30,
		range
	};
}

/** The period releases.ts is asked for: the box's own, or the lifetime that its range cuts. */
export function boxPeriod(box: StatBox): PeriodKey {
	return box.timeframe.kind === 'period' ? box.timeframe.period : 'lifetime';
}

/** The videos a box looks at: on its platforms, of its kinds, public, never one hidden on the Dashboard. */
export function boxReleases(releases: Release[], filter: DashFilter): Release[] {
	return releases.filter((r) => inView(r, filter));
}

/** Whether a range box names a day that is not a date any more (a stored row edited by hand). */
export function rangeBroken(timeframe: BoxTimeframe): boolean {
	return timeframe.kind === 'range' && !Number.isFinite(dayAt(timeframe.from));
}

/* ---- the Dashboard's row of them ---- */

/** The layout with a box added at the end (once). */
export function placeBox(layout: string[], id: string): string[] {
	return layout.includes(id) ? layout : [...layout, id];
}

export function unplaceBox(layout: string[], id: string): string[] {
	return layout.filter((x) => x !== id);
}

/** The layout with a box moved to `index` (among the others). */
export function moveBox(layout: string[], id: string, index: number): string[] {
	if (!layout.includes(id)) return layout;
	const rest = layout.filter((x) => x !== id);
	const at = Math.max(0, Math.min(rest.length, index));
	return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** The boxes a layout shows, in its order; ids no box has any more (deleted) are skipped. */
export function placedBoxes(layout: string[], boxes: StatBox[]): StatBox[] {
	return layout.map((id) => boxes.find((b) => b.id === id)).filter((b): b is StatBox => Boolean(b));
}

/** Whether two boxes count the same: everything but their names, ids and makers. */
export function sameCount(a: StatBox, b: StatBox): boolean {
	const key = (x: StatBox) => JSON.stringify([x.timeframe, x.how, x.metrics, x.platforms, x.kinds]);
	return key(wholeBox(a)) === key(wholeBox(b));
}

/** The box among `boxes` that counts exactly as `box` does (another id); undefined with none. */
export function twinOf(box: StatBox, boxes: StatBox[]): StatBox | undefined {
	return boxes.find((b) => b.id !== box.id && sameCount(b, box));
}

/* ---- the rates: over the videos a box counts ---- */

export interface BoxRate {
	/** The share of views skipped at the start, pooled by views; YouTube and Instagram only. */
	skip: number | null;
	/** Likes and comments per view, in percent, pooled by views. */
	engaged: number | null;
	/** Their views at their age (up to a week) against the usual of the same platform and kind, added up. */
	usual: Overall | null;
}

export interface BoxRates extends BoxRate {
	/** The videos they are over. */
	videos: number;
	byPlatform: Record<StatPlatform, BoxRate>;
}

/**
 * A box's rates over the public videos whose first post on its platforms
 * went out from `from` to `to` (inclusive). `peers` are the releases the
 * usual is the middle of: the box's own platforms and kinds, every one.
 */
export function boxRates(releases: Release[], filter: DashFilter, from: number, to: number, now: number, peers: Release[]): BoxRates {
	const out = releases.filter((r) => {
		const posts = filter.platforms.map((p) => r.posts[p]).filter((p): p is Post => Boolean(p));
		if (posts.length === 0 || visibilityOf(r, filter.platforms) !== 'public') return false;
		const first = Math.min(...posts.map((p) => p.at));
		return first >= from && first <= to;
	});
	const groups = peerGroups(peers);
	const judged = (posts: { post: Post; kind: string }[]) =>
		posts.length === 0 ? null : overallOf(posts.map(({ post, kind }) => judge(post, groups.get(`${post.platform}:${kind}`) ?? [], now)));
	const rate = (platforms: StatPlatform[]): BoxRate => {
		const posts = out.flatMap((r) => platforms.map((p) => r.posts[p]).filter((p): p is Post => Boolean(p)).map((post) => ({ post, kind: r.kind })));
		const usual = judged(posts);
		return {
			skip: pooledSkipRate(out.flatMap((r) => skipPosts(r, platforms))),
			engaged: engagedRate(posts.map((p) => p.post)),
			usual: usual && usual.ratio !== null ? usual : null
		};
	};
	return {
		...rate(filter.platforms),
		videos: out.length,
		byPlatform: Object.fromEntries(STAT_PLATFORMS.map((p) => [p, rate([p])])) as Record<StatPlatform, BoxRate>
	};
}

/** The narrowest a box can be on the Dashboard: room for each of its numbers. */
export function boxMinWidth(box: Pick<StatBox, 'metrics'>): number {
	return 36 + box.metrics.length * 62;
}
