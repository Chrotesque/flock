import { STAT_PLATFORMS, median, type DashFilter, type Post, type Release, type StatPlatform } from './releases';

/**
 * The Dashboard's Ratio View: every platform side by side, each with its own
 * views and its likes and comments with their share of those views — no sums
 * across platforms in the rows. Switched per browser
 * (`flock.dashboard.ratioView`), with the platforms it shows picked beside
 * the switch (`flock.dashboard.ratioPlatforms`, every one to begin with).
 * While it is on, the filter's platforms are not in effect; its other
 * choices — timeframe, kinds, visibility — still are.
 */

/** The filter as the page applies it: in Ratio View, the platforms picked beside its switch. */
export function viewFilter(filter: DashFilter, ratioView: boolean, platforms: StatPlatform[] = STAT_PLATFORMS): DashFilter {
	return ratioView ? { ...filter, platforms: [...platforms] } : filter;
}

/** The stored platforms, in display order; none or nothing known is every one. */
export function readRatioPlatforms(raw: unknown): StatPlatform[] {
	const list = Array.isArray(raw) ? STAT_PLATFORMS.filter((p) => raw.includes(p)) : [];
	return list.length > 0 ? list : [...STAT_PLATFORMS];
}

/** A platform added or taken away, in display order; the last one stays, as the filter's does. */
export function toggleRatioPlatform(platforms: StatPlatform[], p: StatPlatform): StatPlatform[] {
	const on = platforms.includes(p);
	if (on && platforms.length === 1) return platforms;
	return STAT_PLATFORMS.filter((x) => (x === p ? !on : platforms.includes(x)));
}

/** A counter as a share of the views, in percent: 12 likes on 1,100 views is 1.09. Null without views to divide by. */
export function perView(count: number | null | undefined, views: number | null | undefined): number | null {
	if (typeof count !== 'number' || typeof views !== 'number' || views <= 0) return null;
	return (count / views) * 100;
}

/**
 * Over several videos: their counts added up against their views added up,
 * each video counted only where both were read — so a video with many views
 * weighs as much as its views do.
 */
export function pooledPerView(rows: { count: number | null | undefined; views: number | null | undefined }[]): number | null {
	let count = 0;
	let views = 0;
	for (const row of rows) {
		if (typeof row.count !== 'number' || typeof row.views !== 'number' || row.views <= 0) continue;
		count += row.count;
		views += row.views;
	}
	return views > 0 ? (count / views) * 100 : null;
}

/** A share in percent, two decimals in the browser's decimal mark: 1.09%, 1,09%. */
export function percentWords(rate: number, locale?: string): string {
	return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate)}%`;
}

/** Ratio View's title: its first 20 characters, then "..." — the room goes to the platforms' numbers. */
export function shortTitle(title: string, max = 20): string {
	const chars = Array.from(title.trim());
	return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}...` : chars.join('');
}

/** The platforms shown that any of the videos is on, in display order: a slot each in every row. */
export function slotPlatforms(releases: Pick<Release, 'posts'>[], platforms: StatPlatform[] = STAT_PLATFORMS): StatPlatform[] {
	return STAT_PLATFORMS.filter((p) => platforms.includes(p) && releases.some((r) => r.posts[p]));
}

/**
 * A post's engagements: its likes and comments — the two interactions flock
 * reads on every platform (only TikTok's shares besides, so they are left
 * out to keep the platforms comparable). Null unless both were read.
 */
export function engagementsOf(post: Pick<Post, 'likes' | 'comments'>): number | null {
	return typeof post.likes === 'number' && typeof post.comments === 'number' ? post.likes + post.comments : null;
}

/** Engagement rate by views: engagements over views × 100, pooled by views over several posts. */
export function engagedRate(posts: Pick<Post, 'likes' | 'comments' | 'views'>[]): number | null {
	return pooledPerView(posts.map((post) => ({ count: engagementsOf(post), views: post.views })));
}

/* ---- against the usual: each platform's videos measured against its own middle ---- */

/**
 * Below this many views a per-view rate is noise — one like on 15 views is
 * 6.67% — so it is shown as a dot, left out of the usual and sorted last.
 */
export const MIN_VIEWS = 100;

export type RateKind = 'likes' | 'comments' | 'skip';

/** A post's likes or comments per view, or its skip rate, in percent; null without enough views or the number. */
export function rateOf(post: Pick<Post, 'views' | 'likes' | 'comments' | 'skipRate'>, kind: RateKind): number | null {
	if (typeof post.views !== 'number' || post.views < MIN_VIEWS) return null;
	return kind === 'skip' ? (post.skipRate ?? null) : perView(post[kind], post.views);
}

export type Usual = Record<RateKind, number | null>;

/** A platform's usual: the middle rate of its posts with enough views; null with none. */
export function usualOf(posts: Pick<Post, 'views' | 'likes' | 'comments' | 'skipRate'>[]): Usual {
	const middle = (kind: RateKind) => median(posts.map((post) => rateOf(post, kind)).filter((r): r is number => r !== null));
	return { likes: middle('likes'), comments: middle('comments'), skip: middle('skip') };
}

/** How far either way of the usual is still about usual: a fifth, as for views; a tenth for skips, which vary less. */
export const RATE_MARGIN: Record<RateKind, number> = { likes: 0.2, comments: 0.2, skip: 0.1 };

export type Standing = 'up' | 'usual' | 'down';

/**
 * Better (`up`) or worse (`down`) than the usual, or about it — fewer skips
 * are better. A usual of 0 makes any rate above it better (or, for skips,
 * worse). Null when either is unknown.
 */
export function standing(rate: number | null, usual: number | null, kind: RateKind): Standing | null {
	if (rate === null || usual === null) return null;
	const lowerIsBetter = kind === 'skip';
	if (usual <= 0) return rate > 0 ? (lowerIsBetter ? 'down' : 'up') : 'usual';
	const ratio = rate / usual;
	const margin = RATE_MARGIN[kind];
	if (ratio > 1 + margin) return lowerIsBetter ? 'down' : 'up';
	if (ratio < 1 - margin) return lowerIsBetter ? 'up' : 'down';
	return 'usual';
}

/**
 * A video against the usual over every platform it is on: the mean of each
 * rate over its platform's usual, where both are known and the usual is
 * above 0 — what sorting a whole column goes by. Null with none.
 */
export function vsUsual(
	posts: Pick<Post, 'platform' | 'views' | 'likes' | 'comments' | 'skipRate'>[],
	usual: Partial<Record<StatPlatform, Usual>>,
	kind: RateKind
): number | null {
	const ratios = posts.flatMap((post) => {
		const rate = rateOf(post, kind);
		const base = usual[post.platform]?.[kind];
		return rate !== null && base != null && base > 0 ? [rate / base] : [];
	});
	return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
}

/** A rate the way the heatmap shows it: 0%, two decimals under 1% (0.54%), one from there (1.6%, 10.1%). */
export function rateWords(rate: number, locale?: string): string {
	if (rate === 0) return '0%';
	const digits = rate < 1 ? 2 : 1;
	return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(rate)}%`;
}
