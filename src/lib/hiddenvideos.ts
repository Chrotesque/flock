import {
	STAT_PLATFORMS,
	buildReleases,
	type Post,
	type ReelRow,
	type Release,
	type StatPlatform,
	type TargetLink,
	type YouTubeRow
} from './releases';

/**
 * Videos hidden from the Dashboard — a test post, say — with the eye beside
 * a title in Edit mode, kept in `app_settings` / `dashboard_hidden` so every
 * browser hides the same. Marks are by post, under the platform's own id
 * (YouTube's video id, Instagram's media id, Facebook's and TikTok's video
 * id), because a
 * row's posts can be paired by time only: a test reel posted near a real
 * Short shares its row.
 *
 * A hidden post is taken out before the posts are paired into releases, so
 * it never lends its numbers to a real video's row nor takes a real video's
 * place in a pairing. The hidden posts are paired among themselves, so the
 * filter's *Hidden* shows them as rows of their own.
 */

export type HiddenPosts = Record<StatPlatform, Record<string, true>>;

export const NONE_HIDDEN: HiddenPosts = { youtube: {}, instagram: {}, tiktok: {}, facebook: {} };

/** A post as a mark names it. */
export type HiddenPost = Pick<Post, 'platform' | 'id'>;

/** A stored row, read field by field; anything but a `true` under an id is dropped. */
export function readHidden(raw: unknown): HiddenPosts {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const out: HiddenPosts = { youtube: {}, instagram: {}, tiktok: {}, facebook: {} };
	for (const p of STAT_PLATFORMS) {
		const side = r[p];
		if (!side || typeof side !== 'object') continue;
		for (const [id, on] of Object.entries(side as Record<string, unknown>)) {
			if (id && on === true) out[p][id] = true;
		}
	}
	return out;
}

export function isHidden(hidden: HiddenPosts, post: HiddenPost): boolean {
	return hidden[post.platform]?.[post.id] === true;
}

/** Hides these posts, or shows them again; showing drops the mark rather than storing false. */
export function setHidden(hidden: HiddenPosts, posts: HiddenPost[], on: boolean): HiddenPosts {
	const out: HiddenPosts = {
		youtube: { ...hidden.youtube },
		instagram: { ...hidden.instagram },
		tiktok: { ...hidden.tiktok },
		facebook: { ...hidden.facebook }
	};
	for (const post of posts) {
		if (on) out[post.platform][post.id] = true;
		else delete out[post.platform][post.id];
	}
	return out;
}

/** How many posts are hidden, over every platform. */
export function hiddenCount(hidden: HiddenPosts): number {
	return STAT_PLATFORMS.reduce((n, p) => n + Object.keys(hidden[p]).length, 0);
}

/**
 * Every release, as `buildReleases` makes them, of the posts not hidden;
 * then those of the hidden posts, paired among themselves and marked
 * `hidden`.
 */
export function releasesWithHidden(
	videos: YouTubeRow[],
	reels: ReelRow[],
	targets: TargetLink[],
	fbReels: ReelRow[],
	hidden: HiddenPosts,
	ttVideos: ReelRow[] = []
): Release[] {
	const yt = (row: YouTubeRow) => hidden.youtube[row.video_id] === true;
	const ig = (row: ReelRow) => hidden.instagram[row.post_id] === true;
	const fb = (row: ReelRow) => hidden.facebook[row.post_id] === true;
	const tt = (row: ReelRow) => hidden.tiktok?.[row.post_id] === true;
	const shown = buildReleases(
		videos.filter((v) => !yt(v)),
		reels.filter((r) => !ig(r)),
		targets,
		fbReels.filter((r) => !fb(r)),
		ttVideos.filter((r) => !tt(r))
	);
	const hiddenVideos = videos.filter(yt);
	const hiddenReels = reels.filter(ig);
	const hiddenFb = fbReels.filter(fb);
	const hiddenTt = ttVideos.filter(tt);
	if (hiddenVideos.length + hiddenReels.length + hiddenFb.length + hiddenTt.length === 0) return shown;
	const away = buildReleases(hiddenVideos, hiddenReels, targets, hiddenFb, hiddenTt).map((r) => ({ ...r, hidden: true }));
	return [...shown, ...away];
}
