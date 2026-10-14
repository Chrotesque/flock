import { sameLink, youtubeId } from './releases';
import type { PlatformId } from './types';

/**
 * Which videos are Jestr campaign videos (only with the Jestr integration
 * on). An upload is marked at the Details step — the tick lands as
 * `jestrCampaign` on its YouTube, Instagram and TikTok posts' options — and
 * any video can be marked or unmarked later on the dashboard, which is how
 * videos from before the tick, or not uploaded through flock, get theirs.
 * A mark made on the dashboard wins over the upload's tick.
 */

/** The platforms a Jestr submission is made of. Facebook is not one. */
export const JESTR_PLATFORMS: PlatformId[] = ['youtube', 'instagram', 'tiktok'];

/** The option key the Details tick writes on each of those posts. */
export const CAMPAIGN_OPTION = 'jestrCampaign';

/** Marks made on the dashboard, by the platform's own id: YouTube's video id, Instagram's media id. */
export interface CampaignMarks {
	youtube: Record<string, boolean>;
	instagram: Record<string, boolean>;
}

export const NO_MARKS: CampaignMarks = { youtube: {}, instagram: {} };

/** A stored row, read field by field; anything else is dropped. */
export function readMarks(raw: unknown): CampaignMarks {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const side = (value: unknown): Record<string, boolean> => {
		const out: Record<string, boolean> = {};
		if (value && typeof value === 'object') {
			for (const [id, on] of Object.entries(value as Record<string, unknown>)) {
				if (id && typeof on === 'boolean') out[id] = on;
			}
		}
		return out;
	};
	return { youtube: side(r.youtube), instagram: side(r.instagram) };
}

/** The posts ticked at upload, as their links name them. */
export interface FlaggedPosts {
	youtube: Set<string>;
	instagram: Set<string>;
}

export function flaggedPosts(targets: { platform: string; remote_url?: string; jestr?: boolean }[]): FlaggedPosts {
	const out: FlaggedPosts = { youtube: new Set(), instagram: new Set() };
	for (const t of targets) {
		if (!t.jestr || !t.remote_url) continue;
		if (t.platform === 'youtube') {
			const id = youtubeId(t.remote_url);
			if (id) out.youtube.add(id);
		} else if (t.platform === 'instagram') out.instagram.add(sameLink(t.remote_url));
	}
	return out;
}

/** One video's posts, as far as flock reads them. */
export interface CampaignPosts {
	youtube?: { id: string };
	instagram?: { id: string; url: string };
}

/**
 * Whether a video counts as a Jestr campaign video: a dashboard mark on
 * either of its posts if there is one (YouTube's first), else the upload's
 * tick on either.
 */
export function isCampaign(posts: CampaignPosts, marks: CampaignMarks, flagged: FlaggedPosts): boolean {
	const yt = posts.youtube?.id;
	const ig = posts.instagram?.id;
	const marked = (yt ? marks.youtube[yt] : undefined) ?? (ig ? marks.instagram[ig] : undefined);
	if (marked !== undefined) return marked;
	return Boolean(
		(yt && flagged.youtube.has(yt)) || (posts.instagram && flagged.instagram.has(sameLink(posts.instagram.url)))
	);
}

/** Marks every post of a video the same way, so a later pairing cannot split them. */
export function mark(marks: CampaignMarks, posts: CampaignPosts, on: boolean): CampaignMarks {
	return {
		youtube: posts.youtube ? { ...marks.youtube, [posts.youtube.id]: on } : marks.youtube,
		instagram: posts.instagram ? { ...marks.instagram, [posts.instagram.id]: on } : marks.instagram
	};
}

/** Whether an upload's options carry the Details tick. */
export function tickedIn(overrides: Partial<Record<PlatformId, Record<string, unknown>>>): boolean {
	return JESTR_PLATFORMS.some((p) => overrides[p]?.[CAMPAIGN_OPTION] === true);
}

/** The upload's options with the tick set on, or taken off, every Jestr platform. */
export function withTick<T extends Record<string, unknown>>(
	overrides: Partial<Record<PlatformId, T>>,
	on: boolean
): Partial<Record<PlatformId, T>> {
	const out: Partial<Record<PlatformId, T>> = { ...overrides };
	for (const p of JESTR_PLATFORMS) {
		const { [CAMPAIGN_OPTION]: _dropped, ...rest } = (out[p] ?? {}) as T;
		const next = (on ? { ...rest, [CAMPAIGN_OPTION]: true } : rest) as T;
		if (Object.keys(next).length > 0) out[p] = next;
		else delete out[p];
	}
	return out;
}
