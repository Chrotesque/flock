import type { PlatformId } from './types';
import { ALL_PLATFORMS, captionTitle, type Release } from './releases';

/**
 * Renaming a video that is out already, from the Dashboard's Edit mode. The
 * page writes one `title_requests` row per platform ticked and the worker
 * that publishes carries it out (worker/retitle.mjs), since only it holds
 * the tokens. YouTube renames the title itself; a Facebook reel shows its
 * caption and nothing else, so its name is the caption's title line — the
 * one `captionTitle` shows — and that line is what changes. Instagram's API
 * changes nothing on a post but whether it takes comments, and TikTok's
 * nothing at all, so both are listed but cannot be ticked.
 */

export const RENAMEABLE: PlatformId[] = ['youtube', 'facebook'];
export const YOUTUBE_TITLE_MAX = 100;
/** A refused rename is shown on its row this long. */
export const REFUSED_SHOWN_MS = 24 * 60 * 60_000;

/** One platform a release is on, as the rename dialog lists it. */
export interface RenameChoice {
	platform: PlatformId;
	/** The platform's own id for the post; '' when flock has not read it. */
	videoId: string;
	/** The channel or Page it is on. */
	account: string;
	/** Its name there now, as the Dashboard reads it; '' when unknown (TikTok). */
	current: string;
	/** Why it cannot be renamed from here; '' when it can. */
	refusal: string;
}

export function renameRefusal(platform: PlatformId, read: boolean): string {
	if (platform === 'instagram') return 'Instagram lets no app change a caption once the reel is out.';
	if (platform === 'tiktok') return 'TikTok lets no app change a post once it is out.';
	if (!read) return 'flock has not read this post yet.';
	return '';
}

/**
 * Every platform a release is on, in the order its marks show: what it is
 * called there and whether it can be renamed. `videos` and `reels` are the
 * Dashboard's rows, looked up by the posts' records.
 */
export function renameChoices(
	release: Pick<Release, 'posts' | 'links'>,
	videos: { id: string; title: string; channelId: string }[],
	reels: { id: string; caption: string; account: string }[]
): RenameChoice[] {
	return ALL_PLATFORMS.filter((p) => release.links[p]).map((platform) => {
		const post = platform === 'tiktok' ? undefined : release.posts[platform];
		const video = platform === 'youtube' && post ? videos.find((v) => v.id === post.record) : undefined;
		const reel = platform !== 'youtube' && post ? reels.find((r) => r.id === post.record) : undefined;
		return {
			platform,
			videoId: post?.id ?? '',
			account: video?.channelId ?? reel?.account ?? '',
			current: video ? video.title : reel ? captionTitle(reel.caption) : '',
			refusal: renameRefusal(platform, Boolean(post))
		};
	});
}

/** One line, trimmed: a title has no line breaks. */
export function cleanName(name: string): string {
	return name.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** What is wrong with a new name for these platforms; '' when nothing. */
export function nameProblem(name: string, platforms: PlatformId[]): string {
	const title = cleanName(name);
	if (!title) return 'Enter a name.';
	if (platforms.length === 0) return 'Tick at least one platform.';
	if (platforms.includes('youtube')) {
		if (title.length > YOUTUBE_TITLE_MAX) return `YouTube takes at most ${YOUTUBE_TITLE_MAX} characters.`;
		if (/[<>]/.test(title)) return 'YouTube takes no < or > in a title.';
	}
	return '';
}

/* ---- the asks and what came of them ---- */

export type RenameStatus = 'pending' | 'done' | 'failed';

export interface TitleRequest {
	id: string;
	platform: PlatformId;
	video_id: string;
	title: string;
	before: string;
	status: RenameStatus;
	error: string;
	created: string;
	updated: string;
}

const STATUSES: RenameStatus[] = ['pending', 'done', 'failed'];

export function readTitleRequest(row: Record<string, unknown>): TitleRequest {
	const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '');
	const status = STATUSES.find((s) => s === row.status) ?? 'pending';
	return {
		id: text('id'),
		platform: text('platform') as PlatformId,
		video_id: text('video_id'),
		title: text('title'),
		before: text('before'),
		status,
		error: text('error'),
		created: text('created'),
		updated: text('updated')
	};
}

export const postKey = (platform: string, videoId: string) => `${platform}:${videoId}`;

const time = (iso: string) => Date.parse(iso.replace(' ', 'T'));

/** The newest ask for each post, by `postKey`. */
export function newestByPost(rows: TitleRequest[]): Map<string, TitleRequest> {
	const out = new Map<string, TitleRequest>();
	for (const row of rows) {
		const key = postKey(row.platform, row.video_id);
		const had = out.get(key);
		if (!had || time(row.created) >= time(had.created)) out.set(key, row);
	}
	return out;
}

/**
 * What a release's row says about its renames: the posts still waiting for
 * the worker, and those it refused in the last day. A post renamed since
 * says nothing — its new name is the row's.
 */
export function renameNotes(
	posts: { platform: string; id: string }[],
	newest: Map<string, TitleRequest>,
	now: number
): { waiting: TitleRequest[]; refused: TitleRequest[] } {
	const asks = posts.map((post) => newest.get(postKey(post.platform, post.id))).filter((r): r is TitleRequest => Boolean(r));
	return {
		waiting: asks.filter((r) => r.status === 'pending'),
		refused: asks.filter((r) => r.status === 'failed' && now - time(r.updated) < REFUSED_SHOWN_MS)
	};
}
