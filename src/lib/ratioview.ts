import { STAT_PLATFORMS, pooledSkipRate, type DashFilter, type Post, type Release, type StatPlatform } from './releases';

/**
 * The Dashboard's Ratio View: every platform side by side, each with its own
 * views and its likes and comments with their share of those views — no sums
 * across platforms in the rows. Switched per browser
 * (`flock.dashboard.ratioView`). While it is on, the filter's platforms are
 * not in effect: every platform is shown, and the filter's other choices —
 * timeframe, kinds, visibility — still are.
 */

/** The filter as the page applies it: in Ratio View, every platform. */
export function viewFilter(filter: DashFilter, ratioView: boolean): DashFilter {
	return ratioView ? { ...filter, platforms: [...STAT_PLATFORMS] } : filter;
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

/** The platforms any of the videos is on, in display order: a slot each in every row. */
export function slotPlatforms(releases: Pick<Release, 'posts'>[]): StatPlatform[] {
	return STAT_PLATFORMS.filter((p) => releases.some((r) => r.posts[p]));
}

export interface PlatformTotal {
	views: number | null;
	likes: number | null;
	comments: number | null;
	likeRate: number | null;
	commentRate: number | null;
	/** The skip rate over its posts, weighted by their views (pooledSkipRate). */
	skip: number | null;
}

/** One platform's numbers over its posts: counters added up (null when none was read), each share pooled. */
export function platformTotal(posts: Post[]): PlatformTotal {
	const sum = (key: 'views' | 'likes' | 'comments') =>
		posts.reduce<number | null>((total, post) => (typeof post[key] === 'number' ? (total ?? 0) + post[key] : total), null);
	return {
		views: sum('views'),
		likes: sum('likes'),
		comments: sum('comments'),
		likeRate: pooledPerView(posts.map((post) => ({ count: post.likes, views: post.views }))),
		commentRate: pooledPerView(posts.map((post) => ({ count: post.comments, views: post.views }))),
		skip: pooledSkipRate(posts)
	};
}
