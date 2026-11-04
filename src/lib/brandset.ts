/**
 * One brand's releases and follower records, built from the Dashboard's data
 * (stores/dashdata.svelte.ts) the way the Dashboard builds the brand in view's:
 * its own channel, Instagram account, TikTok account and Page, each post given
 * the followers credited to it, and paired into releases (releases.ts). Used
 * by Settings → Dashboard → Stat boxes to preview a box on a brand's numbers;
 * Dashboard.svelte keeps its own copy of these steps for its scopes, so a
 * change to how it builds a brand belongs in both.
 */
import { creditedFollowers, engagedOf, stateOf, youtubeSkipRate, type FollowerState } from './followers';
import { releasesWithHidden, type HiddenPosts } from './hiddenvideos';
import { onTikTokAccount, tiktokStateOf } from './tiktokaccount';
import type { Release, TargetLink } from './releases';
import type { DashboardReel, DashboardVideo } from './repo';
import type { Account, PlatformId } from './types';

const postTime = (iso: string) => Date.parse(String(iso ?? '').replace(' ', 'T'));

export interface BrandData {
	videos: DashboardVideo[];
	reels: DashboardReel[];
	targets: (TargetLink & { brand: string })[];
	followers: FollowerState[];
}

export function brandSet(
	data: BrandData,
	brandId: string,
	/** The brand's account on a platform, or null. */
	accountOf: (platform: PlatformId) => Account | null,
	/** With one brand and at most one account, everything on the platform is the brand's. */
	lone: (platform: PlatformId) => boolean,
	marks: HiddenPosts,
	multiple: boolean
): { releases: Release[]; followers: FollowerState[] } {
	const states = data.followers;
	const videos = data.videos.map((v) => ({
		...v,
		followers: creditedFollowers(stateOf(states, 'youtube', v.channelId), v.video_id, postTime(v.published_at)),
		skipRate: youtubeSkipRate(engagedOf(states, v.video_id), v.views)
	}));
	const reels = data.reels.map((r) =>
		r.platform === 'instagram' || r.platform === 'tiktok'
			? { ...r, followers: creditedFollowers(stateOf(states, r.platform, r.account), r.post_id, postTime(r.published_at)) }
			: r
	);
	const yt = accountOf('youtube');
	const ig = accountOf('instagram');
	const fb = accountOf('facebook');
	const tt = accountOf('tiktok');
	const mine = <T>(list: T[], account: Account | null, platform: PlatformId, match: (row: T, account: Account) => boolean) =>
		account ? list.filter((row) => match(row, account)) : lone(platform) ? list : [];
	const myVideos = mine(videos, yt, 'youtube', (v, a) => v.channelId === a.account_id);
	const myReels = mine(
		reels.filter((r) => r.platform === 'instagram'),
		ig,
		'instagram',
		(r, a) => r.account === a.account_id
	);
	const myFb = mine(
		reels.filter((r) => r.platform === 'facebook'),
		fb,
		'facebook',
		(r, a) => r.account === a.account_id
	);
	const myTt = mine(
		reels.filter((r) => r.platform === 'tiktok'),
		tt,
		'tiktok',
		(r, a) => onTikTokAccount(r, a)
	);
	const followers = (
		[
			['youtube', yt],
			['instagram', ig],
			['tiktok', tt],
			['facebook', fb]
		] as const
	).flatMap(([p, account]) =>
		account
			? [p === 'tiktok' ? tiktokStateOf(states, account) : stateOf(states, p, account.account_id)].filter(
					(s): s is FollowerState => Boolean(s)
				)
			: lone(p)
				? states.filter((s) => s.platform === p)
				: []
	);
	const posts = multiple ? data.targets.filter((t) => t.brand === brandId) : data.targets;
	return {
		releases: releasesWithHidden(myVideos, myReels, posts, myFb, marks, myTt),
		followers
	};
}
