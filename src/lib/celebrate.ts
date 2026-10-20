import { accountFor } from './accounts';
import { releasesWithHidden, type HiddenPosts } from './hiddenvideos';
import { inSpan, median, type ReelPlatform, type ReelRow, type Release, type TargetLink, type YouTubeRow } from './releases';
import { onTikTokAccount } from './tiktokaccount';
import type { Account, Brand } from './types';

/**
 * A submission doing far better than the brand's best, celebrated in To
 * finish with a gold row and on the sidebar's box with a gold medal
 * (v0.16.68–0.16.69, the user's design and rule, 21 Oct 2026).
 *
 * A submission is a public Short on YouTube with its Instagram reel and
 * TikTok video, their views added up — Jestr's sense, so Facebook is left
 * out. Its bar is half as much again as the middle of the top 15 % of the
 * brand's other submissions from the last 30 days: on that day 1.5 × 3,157,
 * about 4,740, above every submission so far (the best had 3,882). The bar
 * leaves the submission itself out, or one that cleared it would raise its
 * own bar by joining the top and could fall back under it. Only the brands
 * To finish follows (todobrands.ts) are celebrated; that rule is the store's.
 */

/** Whether To finish celebrates at all. */
export const CELEBRATING = true;

/** Half as much again, at least. */
export const CELEBRATE_GAIN = 0.5;

/** The share of the best submissions the bar is the middle of. */
export const TOP_SHARE = 0.15;

/** The window the bar is drawn from, and that a submission is celebrated in. */
export const BAR_DAYS = 30;

/** Fewer other submissions than this in the window, and there is no bar: a new brand's first videos are not each a record. */
export const MIN_SUBMISSIONS = 10;

/** The platforms whose views a submission adds up. */
export const SUBMISSION_PLATFORMS = ['youtube', 'instagram', 'tiktok'] as const;
export type SubmissionPlatform = (typeof SUBMISSION_PLATFORMS)[number];

/** The dismissal's key, by the submission's Short (kept with To finish's others, attention.ts). */
export function celebrationKey(videoId: string): string {
	return `best:youtube:${videoId}`;
}

export interface Celebration {
	key: string;
	/** The brand's id. */
	brand: string;
	/** The flock upload, '' when it went out some other way. */
	job: string;
	title: string;
	/** The Short on YouTube. */
	url: string;
	/** YouTube, Instagram and TikTok added up. */
	combined: number;
	/** Each platform's views; null where it has no post. */
	views: Record<SubmissionPlatform, number | null>;
	/** The middle of the top 15 % of the other submissions, and half as much again. */
	median: number;
	bar: number;
	/** How much better than that middle, in whole per cent, rounded down: 52 for 1.52 times. */
	percent: number;
	/** Since it went out, ms. */
	age: number;
	/** The video's picture ('' when none is known); a Short's, shown upright. */
	thumb: string;
}

/** What a brand's posts are read from: the Dashboard's rows (repo.ts), counters only. */
export interface PostRows {
	videos: (YouTubeRow & { channelId: string })[];
	reels: (ReelRow & { platform: ReelPlatform; account: string })[];
	targets: (TargetLink & { brand?: string })[];
}

/**
 * One brand's releases, paired as the Dashboard pairs them: the posts on the
 * accounts the brand chose (accounts.ts), TikTok's by open id or handle
 * (tiktokaccount.ts), and with a single brand and at most one account of a
 * platform, all of that platform's. Hidden posts come back marked `hidden`.
 */
export function brandReleases(
	brand: Brand,
	brands: Brand[],
	accounts: Account[],
	rows: PostRows,
	hidden: HiddenPosts
): Release[] {
	const count = brands.length;
	const lone = (p: SubmissionPlatform | 'facebook') => count <= 1 && accounts.filter((a) => a.platform === p).length <= 1;
	const yt = accountFor(brand, 'youtube', accounts, count);
	const videos = yt ? rows.videos.filter((v) => v.channelId === yt.account_id) : lone('youtube') ? rows.videos : [];
	const reelsOf = (p: ReelPlatform) => {
		const own = rows.reels.filter((r) => r.platform === p);
		const account = accountFor(brand, p, accounts, count);
		if (!account) return lone(p) ? own : [];
		return own.filter((r) => (p === 'tiktok' ? onTikTokAccount(r, account) : r.account === account.account_id));
	};
	const targets = count > 1 ? rows.targets.filter((t) => t.brand === brand.id) : rows.targets;
	return releasesWithHidden(videos, reelsOf('instagram'), targets, reelsOf('facebook'), hidden, reelsOf('tiktok'));
}

/** A public Short on YouTube, not hidden: what counts as a submission. */
export function isSubmission(release: Release): boolean {
	return release.privacy === 'public' && !release.hidden && release.kind === 'short' && Boolean(release.posts.youtube);
}

/** Its YouTube, Instagram and TikTok views added up. */
export function combinedViews(release: Release): number {
	return SUBMISSION_PLATFORMS.reduce((sum, p) => sum + (release.posts[p]?.views ?? 0), 0);
}

/** The middle of the best `share` of the values: of the top 8 of 55 for 15 %, at least the best one. */
export function topMedian(values: number[], share = TOP_SHARE): number | null {
	if (values.length === 0) return null;
	const best = [...values].sort((a, b) => b - a);
	return median(best.slice(0, Math.max(1, Math.round(best.length * share))));
}

/** The brand's submissions from the last 30 days that cleared their bar, best first. */
export function celebrationsOf(releases: Release[], brand: string, now: number): Celebration[] {
	const pool = releases.filter((r) => isSubmission(r) && inSpan(r, BAR_DAYS, now));
	const out: Celebration[] = [];
	for (const release of pool) {
		const others = pool.filter((r) => r !== release);
		if (others.length < MIN_SUBMISSIONS) continue;
		const middle = topMedian(others.map(combinedViews));
		if (middle === null || middle <= 0) continue;
		const combined = combinedViews(release);
		const bar = middle * (1 + CELEBRATE_GAIN);
		if (combined < bar) continue;
		const youtube = release.posts.youtube!;
		out.push({
			key: celebrationKey(youtube.id),
			brand,
			job: release.job,
			title: release.title,
			url: youtube.url,
			combined,
			views: {
				youtube: youtube.views,
				instagram: release.posts.instagram?.views ?? null,
				tiktok: release.posts.tiktok?.views ?? null
			},
			median: middle,
			bar,
			percent: Math.floor((combined / middle - 1) * 100 + 1e-9),
			age: now - release.at,
			thumb: release.thumb
		});
	}
	return out.sort((a, b) => b.percent - a.percent);
}

/** "5 h", "31 h", "2.5 days": how long it has been out. */
export function ageWords(ms: number): string {
	const hours = ms / 3_600_000;
	if (hours < 48) return `${Math.max(1, Math.floor(hours))} h`;
	return `${(Math.floor((hours / 24) * 10) / 10).toLocaleString('en-US')} days`;
}
