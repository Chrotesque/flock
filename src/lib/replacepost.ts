import { PLATFORMS } from './platforms';
import { linkKey, type Post, type ReelPlatform, type Release } from './releases';

/**
 * A reel flock uploaded, replaced by one posted on the platform by hand —
 * the old one archived there, the new one taking its place in the
 * submission (the user's rule, 17 Nov 2026: the old one is simply
 * forgotten). The flock upload's post is pointed at the new reel, so the
 * Dashboard pairs it by the upload as it did the old one; the old reel's
 * stats row is deleted, and its id kept in `app_settings` /
 * `replaced_posts` so the stats passes never write it again should the
 * platform still list it.
 */

/** The `app_settings` row of replaced post ids. */
export const REPLACED_KEY = 'replaced_posts';

export const REPLACEABLE: ReelPlatform[] = ['instagram', 'facebook', 'tiktok'];

/** `{ platform: { old post id: { by: new post id, at } } }`. */
export type ReplacedPosts = Record<ReelPlatform, Record<string, { by: string; at: string }>>;

export const NONE_REPLACED: ReplacedPosts = { instagram: {}, facebook: {}, tiktok: {} };

/** A stored row, read field by field. */
export function readReplaced(raw: unknown): ReplacedPosts {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const out: ReplacedPosts = { instagram: {}, facebook: {}, tiktok: {} };
	for (const p of REPLACEABLE) {
		const side = r[p];
		if (!side || typeof side !== 'object') continue;
		for (const [id, v] of Object.entries(side as Record<string, unknown>)) {
			const e = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
			if (id && typeof e.by === 'string') out[p][id] = { by: e.by, at: typeof e.at === 'string' ? e.at : '' };
		}
	}
	return out;
}

export function withReplaced(stored: ReplacedPosts, platform: ReelPlatform, oldId: string, newId: string, at: string): ReplacedPosts {
	return { ...stored, [platform]: { ...stored[platform], [oldId]: { by: newId, at } } };
}

/**
 * The post a row offers to put in another's place: a release of one reel
 * alone, not from a flock upload — what a reel posted by hand reads as
 * (a flock upload's Shorts are never paired by time on a platform the
 * upload posted to, so a reupload stays on its own). Not a hidden row.
 */
export function replacingPost(release: Release): (Post & { platform: ReelPlatform }) | null {
	if (release.job || release.hidden) return null;
	const posts = Object.values(release.posts).filter((p): p is Post => Boolean(p));
	if (posts.length !== 1) return null;
	const post = posts[0];
	return (REPLACEABLE as string[]).includes(post.platform) ? (post as Post & { platform: ReelPlatform }) : null;
}

export interface ReplaceChoice {
	release: Release;
	/** The reel flock uploaded for it, as the Dashboard has it; null when its stats row is not read (or gone). */
	old: Post | null;
	/** Where the upload says its reel is. */
	oldUrl: string;
	/** How far apart the two went out, ms (the new one's time against the release's). */
	gap: number;
}

/**
 * The submissions a hand-posted reel can take the place of: every release
 * of a flock upload with a post on that platform, published before the new
 * reel, nearest first.
 */
export function replaceChoices(post: Post & { platform: ReelPlatform }, releases: Release[]): ReplaceChoice[] {
	const out: ReplaceChoice[] = [];
	for (const release of releases) {
		const url = release.links[post.platform];
		if (!release.job || !url || release.hidden) continue;
		if (linkKey(post.platform, url) === linkKey(post.platform, post.url)) continue;
		if (release.at > post.at) continue;
		const old = release.posts[post.platform] ?? null;
		out.push({ release, old, oldUrl: url, gap: post.at - release.at });
	}
	return out.sort((a, b) => a.gap - b.gap);
}

/** The Log's line about it. */
export function replaceDetail(o: {
	title: string;
	platform: ReelPlatform;
	oldUrl: string;
	oldViews: number | null;
	newUrl: string;
	newAt: number;
}): string {
	const label = PLATFORMS[o.platform].label;
	const views = o.oldViews === null ? '' : ` (${o.oldViews.toLocaleString('en-US')} views, forgotten)`;
	return (
		`${o.title}: the reel flock uploaded to ${label} — ${o.oldUrl}${views} — was replaced by one posted on ${label} directly, ` +
		`${new Date(o.newAt).toLocaleString()} — ${o.newUrl}. The submission counts the new one from here on.`
	);
}

export function replaceAction(platform: ReelPlatform): string {
	return `Replaced the ${PLATFORMS[platform].label} ${platform === 'tiktok' ? 'video' : 'reel'}`;
}
