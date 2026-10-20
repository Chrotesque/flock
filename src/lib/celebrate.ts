import { accountFor } from './accounts';
import { releasesWithHidden, type HiddenPosts } from './hiddenvideos';
import {
	COMPARE_AT_MS,
	DEFAULT_FILTER,
	inSpan,
	judge,
	peerGroups,
	STAT_PLATFORMS,
	type ReelPlatform,
	type ReelRow,
	type Release,
	type StatPlatform,
	type TargetLink,
	type YouTubeRow
} from './releases';
import { onTikTokAccount } from './tiktokaccount';
import type { Account, Brand } from './types';

/**
 * A post doing far better than usual, celebrated in To finish with a gold
 * row (v0.16.68, the user's design, 21 Oct 2026). "Usual" is the
 * Dashboard's: the middle of the same platform's other public videos of the
 * kind at the same age, among the brand's last 30 days (its default span),
 * judged by `judge` in releases.ts. Only the brands To finish follows
 * (todobrands.ts) are celebrated; that rule is the store's.
 */

const HOUR = 3_600_000;

/**
 * Off until the moment it should trigger is settled (the user's call,
 * 21 Oct 2026): the per-post rule below lists ten of one brand's posts at
 * once, and a rule over the whole submission (YouTube, Instagram and TikTok
 * added up, against the brand's typical one) is being weighed instead.
 * While off, To finish neither reads the numbers nor shows a gold row.
 */
export const CELEBRATING = false;

/** Half as much again as usual, at least (the user's floor). */
export const CELEBRATE_GAIN = 0.5;

/**
 * Not in its first hours: a handful of views moves the ratio a long way
 * then, and a row that came and went again an hour later would read as a
 * mistake. By three hours a Short has about half of its first days' views.
 */
export const CELEBRATE_FROM_MS = 3 * HOUR;

/** The dismissal's key (kept with To finish's others, attention.ts). */
export function celebrationKey(platform: StatPlatform, postId: string): string {
	return `best:${platform}:${postId}`;
}

export interface Celebration {
	key: string;
	platform: StatPlatform;
	/** The brand's id. */
	brand: string;
	/** The flock upload, '' when it went out some other way. */
	job: string;
	title: string;
	/** The post on its platform. */
	url: string;
	views: number;
	usual: number;
	/** How much better than usual, in whole per cent, rounded down: 282 for 3.82 times. */
	percent: number;
	/** Since it went out, ms. */
	age: number;
	/** The video's picture ('' when none is known) and whether it is shown upright. */
	thumb: string;
	upright: boolean;
}

/** What a brand's posts are read from: the Dashboard's rows (dashdata.svelte.ts). */
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
	const lone = (p: StatPlatform) => count <= 1 && accounts.filter((a) => a.platform === p).length <= 1;
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

/**
 * The brand's posts at least `CELEBRATE_GAIN` better than usual: public, not
 * hidden, from three hours to a week old (the week "usual" compares over),
 * with enough peers for a usual at all. Best first.
 */
export function celebrationsOf(releases: Release[], brand: string, now: number): Celebration[] {
	const peers = peerGroups(releases.filter((r) => inSpan(r, DEFAULT_FILTER.days, now)));
	const out: Celebration[] = [];
	for (const release of releases) {
		if (release.privacy !== 'public' || release.hidden) continue;
		for (const platform of STAT_PLATFORMS) {
			const post = release.posts[platform];
			if (!post) continue;
			const age = now - post.at;
			if (age < CELEBRATE_FROM_MS || age > COMPARE_AT_MS) continue;
			const { views, usual } = judge(post, peers.get(`${platform}:${release.kind}`) ?? [], now);
			if (views === null || usual === null || usual <= 0) continue;
			const gain = views / usual - 1;
			if (gain < CELEBRATE_GAIN) continue;
			out.push({
				key: celebrationKey(platform, post.id),
				platform,
				brand,
				job: release.job,
				title: release.title,
				url: post.url,
				views,
				usual,
				percent: Math.floor(gain * 100 + 1e-9),
				age,
				thumb: release.thumb,
				upright: release.kind === 'short' || !release.posts.youtube
			});
		}
	}
	return out.sort((a, b) => b.percent - a.percent);
}

/** "5 h", "31 h", "2.5 days": how long it has been out. */
export function ageWords(ms: number): string {
	const hours = ms / HOUR;
	if (hours < 48) return `${Math.max(1, Math.floor(hours))} h`;
	return `${(Math.floor((hours / 24) * 10) / 10).toLocaleString('en-US')} days`;
}
