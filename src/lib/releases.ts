import { dayStart, startOfWeek } from './format';
import { gainedBetween, sumGains, type FollowerGain, type FollowerState } from './followers';
import { kindOf, KIND_ORDER, SHORT_MAX_SECONDS, type VideoKind } from './videokind';
import type { PlatformId } from './types';

/**
 * The dashboard's arithmetic: every video on the brand's channel, Instagram
 * account, TikTok account and Facebook Page, the numbers by period and what
 * is coming, over every platform flock reads counters for — together (the
 * combined view) or apart.
 *
 * A *release* is one video wherever it went out: a YouTube video and the
 * reels of the same flock upload are one release (matched by the upload's
 * links), and without that, a Short and the reels posted within two hours of
 * it. Everything else is a release of its own.
 *
 * One YouTube channel at a time — the brand in view's — because YouTube's
 * policies forbid adding figures up across channels; the caller filters.
 * Sums across platforms and "usual" are flock's own arithmetic, never
 * YouTube's figures, and the page says so (Developer Policies III.E.4.h).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The platforms flock reads counters for, in display order — every one it
 * posts to. TikTok's are read only for an account whose sign-in allows it
 * (worker/ttstats.mjs); without, it is simply a platform with no videos.
 */
export type StatPlatform = 'youtube' | 'instagram' | 'tiktok' | 'facebook';
export const STAT_PLATFORMS: StatPlatform[] = ['youtube', 'instagram', 'tiktok', 'facebook'];
/**
 * The platforms whose posts are read from `post_stats` (Instagram's and
 * Facebook's reels, TikTok's videos), in the order they are paired with the
 * YouTube videos: Facebook's after Instagram's, TikTok's last, so each can
 * join a release the ones before it made.
 */
export type ReelPlatform = 'instagram' | 'facebook' | 'tiktok';
export const REEL_PLATFORMS: ReelPlatform[] = ['instagram', 'facebook', 'tiktok'];
/** Every platform, in display order; one not in STAT_PLATFORMS would show as "not read yet". */
export const ALL_PLATFORMS: PlatformId[] = ['youtube', 'instagram', 'tiktok', 'facebook'];

/**
 * Each platform's line and swatch, checked as a set on the dark surface
 * (every pair, colour-blind included). TikTok's is neither of its brand
 * colours: its cyan sits on Facebook's teal and its red on YouTube's, so it
 * is a blue that passes against all three (worst colour-blind ΔE 9.6, normal
 * vision 17.5, 20 Oct 2026). Its mark itself stays white, as its brand asks.
 */
export const PLATFORM_COLOURS: Record<StatPlatform, string> = {
	youtube: '#e8484a',
	instagram: '#9b6cf0',
	tiktok: '#2563c0',
	facebook: '#22a2c0'
};

export function isStatPlatform(p: string): p is StatPlatform {
	return (STAT_PLATFORMS as string[]).includes(p);
}

/** A Short and a reel posted this close are taken for the same video. */
export const PAIR_WINDOW_MS = 2 * HOUR;
/** A video is judged on its views at its age, up to its first week. */
export const COMPARE_AT_MS = 7 * DAY;
/** At least this many other videos at the same age, or there is no "usual". */
export const MIN_PEERS = 3;
/** More than a fifth off "usual" is ahead or behind. */
export const VERDICT_MARGIN = 0.2;
/** Watched from release: first read within this of going out. */
export const FROM_RELEASE_MS = HOUR;

const time = (iso: string | undefined | null) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/* ---- what is read ---- */

/** `[iso, views, likes, comments]`, written by the worker whenever a counter moved. */
export type Sample = [string, number | null, number | null, number | null];

/** A `video_stats` row, slim. */
export interface YouTubeRow {
	id: string;
	video_id: string;
	title: string;
	published_at: string;
	privacy: string;
	views: number | null;
	likes: number | null;
	comments: number | null;
	duration: number;
	history: Sample[];
	live: boolean;
	thumb: string;
	/** Followers credited to it (followers.ts); null when not known. */
	followers?: number | null;
	/** Its plays that never became an engaged view, % (followers.ts youtubeSkipRate); null when not known. */
	skipRate?: number | null;
}

/** A `post_stats` row for a reel (Instagram's or Facebook's) or a TikTok video, slim. */
export interface ReelRow {
	id: string;
	post_id: string;
	/** The account's handle as the worker wrote it (TikTok's, matched when the open id differs — tiktokaccount.ts). */
	handle?: string;
	/** Seconds, where the platform gives a length with the listing (TikTok); 0 or absent when not. */
	duration?: number;
	/** A cover image to show for it (TikTok's, an address that lives a few hours); '' when none. */
	thumb?: string;
	published_at: string;
	views: number | null;
	likes: number | null;
	comments: number | null;
	reach: number | null;
	permalink: string;
	caption: string;
	history: Sample[];
	/** Instagram's share of the reel's views skipped within the first 3 seconds, %; null until given (readSkipRate). */
	skipRate?: number | null;
	/** Followers it brought: Facebook's own count, Instagram's credited (followers.ts); null when not known. */
	followers?: number | null;
}

/** What a release needs of flock's posts: which upload it was and where each went. */
export interface TargetLink {
	job: string;
	platform: PlatformId;
	remote_url?: string;
	jobTitle: string;
}

/* ---- posts ---- */

/** One video's counters on one platform, its samples read into numbers once. */
export interface Post {
	platform: StatPlatform;
	/** The `video_stats` / `post_stats` record id. */
	record: string;
	/** YouTube's video id, Instagram's media id, Facebook's or TikTok's video id. */
	id: string;
	url: string;
	at: number;
	views: number | null;
	likes: number | null;
	comments: number | null;
	/** Followers it brought (followers.ts); null when not known. */
	followers: number | null;
	/** [ms, views], oldest first, nulls left out. */
	samples: [number, number][];
	/**
	 * The share of its plays dropped at the start, %: Instagram's own (skipped
	 * within the first 3 seconds), YouTube's worked out from engaged views;
	 * null until given, and always for Facebook and TikTok (SKIP_PLATFORMS).
	 */
	skipRate?: number | null;
}

export function toSamples(history: Sample[] | null | undefined): [number, number][] {
	const out: [number, number][] = [];
	for (const sample of Array.isArray(history) ? history : []) {
		const t = time(sample?.[0]);
		const views = sample?.[1];
		if (Number.isFinite(t) && typeof views === 'number') out.push([t, views]);
	}
	return out.sort((a, b) => a[0] - b[0]);
}

export function watchUrl(videoId: string, duration: number): string {
	return duration > 0 && duration < SHORT_MAX_SECONDS
		? `https://www.youtube.com/shorts/${videoId}`
		: `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubePost(row: YouTubeRow): Post {
	return {
		platform: 'youtube',
		record: row.id,
		id: row.video_id,
		url: watchUrl(row.video_id, row.duration),
		at: time(row.published_at),
		views: row.views,
		likes: row.likes,
		comments: row.comments,
		followers: row.followers ?? null,
		samples: toSamples(row.history),
		skipRate: row.skipRate ?? null
	};
}

export function reelPost(row: ReelRow, platform: ReelPlatform = 'instagram'): Post {
	return {
		platform,
		record: row.id,
		id: row.post_id,
		url: row.permalink,
		at: time(row.published_at),
		views: row.views,
		likes: row.likes,
		comments: row.comments,
		followers: row.followers ?? null,
		samples: toSamples(row.history),
		skipRate: row.skipRate ?? null
	};
}

/**
 * Instagram's skip rate as stored (worker/igstats.mjs): a percentage, or null.
 * Instagram answers 0 for a reel it has not worked one out for yet — a fresh
 * one (seen 17 Oct 2026) — so 0 reads as not given, as does anything that is
 * not a percentage.
 */
export function readSkipRate(value: unknown): number | null {
	return typeof value === 'number' && value > 0 && value <= 100 ? value : null;
}

/**
 * The platforms that give a skip rate: Instagram its own, YouTube through
 * engaged views (followers.ts). Facebook's reel insights have no 3-second
 * count (its retention curve starts at 3 s, checked 21 Oct 2026) and TikTok's
 * API no watch figures at all.
 */
export const SKIP_PLATFORMS: StatPlatform[] = ['youtube', 'instagram'];

/** A release's posts in view that can have a skip rate, in SKIP_PLATFORMS' order. */
export function skipPosts(release: Release, platforms: StatPlatform[]): Post[] {
	return SKIP_PLATFORMS.filter((p) => platforms.includes(p)).flatMap((p) => {
		const post = release.posts[p];
		return post ? [post] : [];
	});
}

/** A release's skip rate over the platforms in view that give one, weighted by their views; null with none. */
export function skipRateOf(release: Release, platforms: StatPlatform[]): number | null {
	return pooledSkipRate(skipPosts(release, platforms));
}

/**
 * The share of all these posts' views skipped at the start: each rate
 * weighted by its post's views, so a post seen ten times as often counts ten
 * times as much. Null with no post that has both.
 */
export function pooledSkipRate(posts: Pick<Post, 'views' | 'skipRate'>[]): number | null {
	let skipped = 0;
	let views = 0;
	for (const post of posts) {
		if (post.skipRate == null || post.views == null || post.views <= 0) continue;
		skipped += (post.skipRate / 100) * post.views;
		views += post.views;
	}
	return views > 0 ? (skipped / views) * 100 : null;
}

/**
 * A post's views at a moment: the last sample at or before it (a sample is
 * written only when a counter moves, so the count held from there). 0
 * before it went out; null when flock was not reading it yet.
 */
export function viewsAt(post: Pick<Post, 'at' | 'samples'>, at: number): number | null {
	if (at < post.at) return 0;
	const s = post.samples;
	let lo = 0;
	let hi = s.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (s[mid][0] <= at) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found < 0 ? null : s[found][1];
}

/** Whether flock read the post from (about) the moment it went out. */
export function fromRelease(post: Pick<Post, 'at' | 'samples'>): boolean {
	const first = post.samples[0];
	return Boolean(first) && first[0] <= post.at + FROM_RELEASE_MS;
}

/* ---- releases ---- */

export interface Release {
	key: string;
	title: string;
	/** When its first post went out. */
	at: number;
	kind: VideoKind;
	/** YouTube's privacy; a reel on its own is public. */
	privacy: string;
	/** Seconds, as YouTube reports it; 0 when unknown. */
	duration: number;
	thumb: string;
	posts: Partial<Record<StatPlatform, Post>>;
	/** Every place flock posted it, counters or not (TikTok too). */
	links: Partial<Record<PlatformId, string>>;
	/** The flock upload, '' when it went out some other way. */
	job: string;
	/** How its posts were matched: the same flock upload, or posted close together; '' for one post. */
	matched: 'job' | 'time' | '';
	/** The group it was built in, while several are shown together (devtest.ts' dashboard scopes). */
	group?: string;
	/** That group's colour, if it has one. */
	tint?: string;
	/** Hidden from the Dashboard (hiddenvideos.ts): shown only with the filter's Hidden. */
	hidden?: boolean;
}

/** The video id in a TikTok link; '' when it names none (a link to the profile only). */
export function tiktokId(url: string | undefined): string {
	return /\/video\/(\d+)/.exec(url ?? '')?.[1] ?? '';
}

/**
 * How a post's link is compared with a read post's: a TikTok one by its video
 * id — the handle in it may be spelled differently — the rest by the link
 * itself. '' for a TikTok link to the profile only (flock's posts before the
 * worker found their video), which matches nothing.
 */
export function linkKey(platform: PlatformId, url: string | undefined): string {
	if (platform === 'tiktok') {
		const id = tiktokId(url);
		return id ? `tt:${id}` : '';
	}
	return sameLink(url);
}

/** The 11-character video id in a YouTube link; '' when there is none. */
export function youtubeId(url: string | undefined): string {
	return /(?:[?&]v=|\/shorts\/|youtu\.be\/)([\w-]{11})/.exec(url ?? '')?.[1] ?? '';
}

/** A link with its query, fragment and trailing slash gone, for comparing. */
export function sameLink(url: string | undefined): string {
	return String(url ?? '')
		.trim()
		.replace(/[?#].*$/, '')
		.replace(/\/+$/, '')
		.replace(/^https?:\/\/(www\.)?/i, '')
		.toLowerCase();
}

const AD_LINE = /^[[(]?\s*(werbung|anzeige|ad|#ad|sponsored|bezahlte partnerschaft|paid partnership)\b/i;

/** A reel's caption as a title: its first line that is not an ad notice, or a hashtag run. */
export function captionTitle(caption: string): string {
	const lines = String(caption ?? '')
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	const line = lines.find((l) => !AD_LINE.test(l) && !l.startsWith('#')) ?? lines[0] ?? '';
	return line.length > 110 ? `${line.slice(0, 107).trimEnd()}…` : line;
}

/**
 * Every release of a channel, an Instagram account, a Facebook Page and a
 * TikTok account. A YouTube video and a reel are one release when the same
 * flock upload made both; failing that, a reel within two hours of a Short
 * (or of a reel already taken for one) joins it, closest first, one to one.
 * Instagram's reels are placed first, then Facebook's — on the Pages read so
 * far mostly Instagram's own, shared over — so a Facebook reel can join an
 * Instagram one that had no Short; TikTok's videos come last, the same way. A
 * reel or TikTok video left over is a release of its own: a Short, or by its
 * length when the platform gives one.
 */
export function buildReleases(
	videos: YouTubeRow[],
	reels: ReelRow[],
	targets: TargetLink[],
	fbReels: ReelRow[] = [],
	ttVideos: ReelRow[] = []
): Release[] {
	// What each flock upload made, by platform, and the way back from a post to its upload.
	const jobs = new Map<string, { title: string; links: Partial<Record<PlatformId, string>> }>();
	const jobOfVideo = new Map<string, string>();
	const jobOfReel: Record<ReelPlatform, Map<string, string>> = { instagram: new Map(), facebook: new Map(), tiktok: new Map() };
	for (const t of targets) {
		if (!t.remote_url) continue;
		const entry = jobs.get(t.job) ?? { title: t.jobTitle, links: {} };
		entry.links[t.platform] = t.remote_url;
		jobs.set(t.job, entry);
		if (t.platform === 'youtube') {
			const id = youtubeId(t.remote_url);
			if (id) jobOfVideo.set(id, t.job);
		} else if (t.platform === 'instagram' || t.platform === 'facebook' || t.platform === 'tiktok') {
			const key = linkKey(t.platform, t.remote_url);
			if (key) jobOfReel[t.platform].set(key, t.job);
		}
	}
	/** Where the upload says its post on a platform is; '' when it says nothing usable (TikTok's profile link). */
	const jobLink = (job: string, platform: ReelPlatform) => {
		const link = job ? jobs.get(job)?.links[platform] : undefined;
		return link && linkKey(platform, link) ? link : '';
	};

	const out: Release[] = videos.map((row) => {
		const post = youtubePost(row);
		const job = jobOfVideo.get(row.video_id) ?? '';
		return {
			key: `yt:${row.video_id}`,
			title: row.title || jobs.get(job)?.title || '(untitled)',
			at: post.at,
			kind: kindOf({ duration: row.duration, live: row.live }),
			privacy: row.privacy || 'public',
			duration: row.duration,
			thumb: row.thumb,
			posts: { youtube: post },
			links: { ...(jobs.get(job)?.links ?? {}), youtube: post.url },
			job,
			matched: ''
		};
	});

	const rowsOf: Record<ReelPlatform, ReelRow[]> = { instagram: reels, facebook: fbReels, tiktok: ttVideos };
	for (const platform of REEL_PLATFORMS) {
		const reelPosts = rowsOf[platform].map((row) => ({ row, post: reelPost(row, platform) }));
		const reelByLink = new Map(reelPosts.map((r) => [linkKey(platform, r.row.permalink), r]));
		const used = new Set<string>();
		const take = (release: Release, reel: (typeof reelPosts)[number], how: 'job' | 'time') => {
			release.posts[platform] = reel.post;
			release.links[platform] = reel.post.url;
			release.at = Math.min(release.at, reel.post.at);
			// A release of reels alone has no picture or length; a TikTok video brings both.
			if (!release.thumb && reel.row.thumb) release.thumb = reel.row.thumb;
			if (!release.duration && reel.row.duration) release.duration = reel.row.duration;
			// "Paired by time" as soon as any of its posts was.
			release.matched = how === 'time' || release.matched === 'time' ? 'time' : 'job';
			used.add(reel.row.post_id);
		};

		// The same flock upload.
		for (const release of out) {
			const link = jobLink(release.job, platform);
			const reel = link ? reelByLink.get(linkKey(platform, link)) : undefined;
			if (reel && !used.has(reel.row.post_id)) take(release, reel, 'job');
		}

		// Closest first, one to one: Shorts without such a reel, reels no upload claimed.
		const candidates: [number, Release, (typeof reelPosts)[number]][] = [];
		for (const release of out) {
			if (release.posts[platform] || release.kind !== 'short') continue;
			// The upload says where its reel is (or that it had none): no guessing past it.
			if (jobLink(release.job, platform)) continue;
			const times = STAT_PLATFORMS.map((p) => release.posts[p]?.at).filter((t): t is number => t !== undefined);
			for (const reel of reelPosts) {
				if (used.has(reel.row.post_id)) continue;
				// Likewise a reel whose upload went out elsewhere too: it belongs to that
				// upload's release. One made on its own (a platform given its own file is
				// an upload of its own) may pair.
				const reelJob = jobOfReel[platform].get(linkKey(platform, reel.row.permalink));
				if (reelJob && STAT_PLATFORMS.some((p) => p !== platform && jobs.get(reelJob)?.links[p])) continue;
				const gap = Math.min(...times.map((t) => Math.abs(reel.post.at - t)));
				if (gap <= PAIR_WINDOW_MS) candidates.push([gap, release, reel]);
			}
		}
		candidates.sort((a, b) => a[0] - b[0]);
		for (const [, release, reel] of candidates) {
			if (release.posts[platform] || used.has(reel.row.post_id)) continue;
			take(release, reel, 'time');
		}

		for (const { row, post } of reelPosts) {
			if (used.has(row.post_id)) continue;
			const job = jobOfReel[platform].get(linkKey(platform, row.permalink)) ?? '';
			out.push({
				key: `${KEY_PREFIX[platform]}:${row.post_id}`,
				title: jobs.get(job)?.title || captionTitle(row.caption) || '(no caption)',
				at: post.at,
				// A reel is a Short; a TikTok video by its length, as YouTube's are.
				kind: row.duration ? kindOf({ duration: row.duration, live: false }) : 'short',
				privacy: 'public',
				duration: row.duration ?? 0,
				thumb: row.thumb ?? '',
				posts: { [platform]: post },
				links: { ...(jobs.get(job)?.links ?? {}), [platform]: post.url },
				job,
				matched: ''
			});
		}
	}
	return out.filter((r) => Number.isFinite(r.at));
}

const KEY_PREFIX: Record<ReelPlatform, string> = { instagram: 'ig', facebook: 'fb', tiktok: 'tt' };

/* ---- what is looked at ---- */

export interface DashFilter {
	/** Whose counters count. All of them is the combined view. */
	platforms: StatPlatform[];
	kinds: VideoKind[];
	/** Show unlisted videos. */
	unlisted: boolean;
	/** Show private ones — a scheduled upload is private until its slot. */
	private: boolean;
	/** Show the videos hidden in Edit mode (hiddenvideos.ts), without showing them again for good. */
	hidden: boolean;
	/** How far back the page looks, in days (DASH_SPANS): every number on it counts only releases since. */
	days: number;
}

/** The Dashboard's timeframes: a month at a time, up to half a year. */
export const DASH_SPANS = [30, 60, 90, 120, 150, 180];

export const DEFAULT_FILTER: DashFilter = {
	platforms: [...STAT_PLATFORMS],
	kinds: [...KIND_ORDER],
	unlisted: false,
	private: false,
	hidden: false,
	days: 30
};

/** The platforms a filter saved before it said which it knew was saved knowing: those before Facebook's numbers. */
const KNOWN_BEFORE: StatPlatform[] = ['youtube', 'instagram'];

/** A filter as it is stored: with the platforms there were, so one flock starts reading later can be told apart. */
export function storedFilter(filter: DashFilter): DashFilter & { known: StatPlatform[] } {
	return { ...filter, known: [...STAT_PLATFORMS] };
}

/**
 * A stored filter, rebuilt field by field; what is unknown or empty falls
 * back. A platform flock started reading since it was saved joins a combined
 * view, and stays out of a filter that had picked some platforms only.
 */
export function readFilter(raw: unknown): DashFilter {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const stored = Array.isArray(r.platforms) ? (r.platforms as unknown[]) : [];
	const known = Array.isArray(r.known) ? (r.known as unknown[]) : KNOWN_BEFORE;
	const wasCombined = known.every((p) => stored.includes(p));
	const platforms = STAT_PLATFORMS.filter((p) => stored.includes(p) || (wasCombined && !known.includes(p)));
	const kinds = Array.isArray(r.kinds) ? KIND_ORDER.filter((k) => (r.kinds as unknown[]).includes(k)) : null;
	return {
		platforms: platforms.length > 0 ? platforms : [...DEFAULT_FILTER.platforms],
		kinds: kinds ?? [...DEFAULT_FILTER.kinds],
		unlisted: typeof r.unlisted === 'boolean' ? r.unlisted : DEFAULT_FILTER.unlisted,
		private: typeof r.private === 'boolean' ? r.private : DEFAULT_FILTER.private,
		hidden: typeof r.hidden === 'boolean' ? r.hidden : DEFAULT_FILTER.hidden,
		days: DASH_SPANS.includes(Number(r.days)) ? Number(r.days) : DEFAULT_FILTER.days
	};
}

/**
 * Whether a release falls in the timeframe: out within the last `days` up to
 * `now`, or still to come (a scheduled upload, private until its slot).
 */
export function inSpan(release: Pick<Release, 'at'>, days: number, now: number): boolean {
	return release.at >= now - days * DAY;
}

export function isCombined(filter: DashFilter): boolean {
	return STAT_PLATFORMS.every((p) => filter.platforms.includes(p));
}

/** The release's visibility as far as the chosen platforms go: YouTube's, if YouTube is among them. */
export function visibilityOf(release: Release, platforms: StatPlatform[]): string {
	return platforms.includes('youtube') && release.posts.youtube ? release.privacy : 'public';
}

function onPlatforms(release: Release, platforms: StatPlatform[]): boolean {
	return platforms.some((p) => release.posts[p]);
}

function visible(release: Release, filter: DashFilter): boolean {
	const v = visibilityOf(release, filter.platforms);
	return !(v === 'unlisted' && !filter.unlisted) && !(v === 'private' && !filter.private);
}

export function inView(release: Release, filter: DashFilter): boolean {
	return (
		onPlatforms(release, filter.platforms) &&
		filter.kinds.includes(release.kind) &&
		visible(release, filter) &&
		(!release.hidden || filter.hidden)
	);
}

export interface FilterCounts {
	kinds: Record<VideoKind, number>;
	unlisted: number;
	private: number;
	hidden: number;
	platforms: Record<StatPlatform, number>;
}

/** The number beside each choice: what it would add, given the other choices as they are. */
export function filterCounts(releases: Release[], filter: DashFilter): FilterCounts {
	const out: FilterCounts = {
		kinds: { short: 0, long: 0, live: 0, other: 0 },
		unlisted: 0,
		private: 0,
		hidden: 0,
		platforms: { youtube: 0, instagram: 0, tiktok: 0, facebook: 0 }
	};
	for (const r of releases) {
		if (r.hidden) {
			if (onPlatforms(r, filter.platforms) && filter.kinds.includes(r.kind) && visible(r, filter)) out.hidden += 1;
			// Counted nowhere else until the filter shows them.
			if (!filter.hidden) continue;
		}
		if (onPlatforms(r, filter.platforms) && visible(r, filter)) out.kinds[r.kind] += 1;
		if (onPlatforms(r, filter.platforms) && filter.kinds.includes(r.kind)) {
			const v = visibilityOf(r, filter.platforms);
			if (v === 'unlisted') out.unlisted += 1;
			if (v === 'private') out.private += 1;
		}
		if (filter.kinds.includes(r.kind)) {
			for (const p of STAT_PLATFORMS) {
				if (r.posts[p] && (p !== 'youtube' || visible(r, { ...filter, platforms: ['youtube'] }))) out.platforms[p] += 1;
			}
		}
	}
	return out;
}

export type Counter = 'views' | 'likes' | 'comments' | 'followers';

/** A counter added up over the chosen platforms; null when none of them has it. */
export function sumOf(release: Release, platforms: StatPlatform[], counter: Counter): number | null {
	let total: number | null = null;
	for (const p of platforms) {
		const value = release.posts[p]?.[counter];
		if (typeof value === 'number') total = (total ?? 0) + value;
	}
	return total;
}

/* ---- how it is doing ---- */

export type Verdict = 'ahead' | 'behind' | 'usual';

export interface Judgement {
	platform: StatPlatform;
	/** The age the video is judged at: its own, up to a week. */
	age: number;
	/** Its views at that age; null when flock was not reading it then. */
	views: number | null;
	/** The middle of the same platform's other videos of the kind at that age. */
	usual: number | null;
	/** How many videos that middle is of. */
	peers: number;
	verdict: Verdict | null;
}

/**
 * Peers by platform and kind: public posts only, and none hidden, so a
 * private or hidden test never sets the bar — whatever the filter shows.
 */
export function peerGroups(releases: Release[]): Map<string, Post[]> {
	const out = new Map<string, Post[]>();
	for (const r of releases) {
		if (r.privacy !== 'public' || r.hidden) continue;
		for (const p of STAT_PLATFORMS) {
			const post = r.posts[p];
			if (!post) continue;
			const key = `${p}:${r.kind}`;
			out.set(key, [...(out.get(key) ?? []), post]);
		}
	}
	return out;
}

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The middle of the peers' views at `age` after their own release, over those flock was reading then. */
export function usualAt(peers: Post[], self: Post | null, age: number, now: number): { usual: number | null; count: number } {
	const values: number[] = [];
	for (const peer of peers) {
		if (peer === self || peer.at + age > now) continue;
		const v = viewsAt(peer, peer.at + age);
		if (v !== null) values.push(v);
	}
	return { usual: values.length >= MIN_PEERS ? median(values) : null, count: values.length };
}

export function verdictOf(views: number | null, usual: number | null): Verdict | null {
	if (views === null || usual === null || usual <= 0) return null;
	if (views > usual * (1 + VERDICT_MARGIN)) return 'ahead';
	if (views < usual * (1 - VERDICT_MARGIN)) return 'behind';
	return 'usual';
}

/**
 * A post against the platform's other videos of its kind at the same age —
 * its own age while younger than a week, its first week after that, so an
 * old video is still judged on how it started.
 */
export function judge(post: Post, peers: Post[], now: number): Judgement {
	const age = Math.max(0, Math.min(now - post.at, COMPARE_AT_MS));
	const views = now - post.at <= COMPARE_AT_MS ? (post.views ?? viewsAt(post, now)) : viewsAt(post, post.at + age);
	const { usual, count } = usualAt(peers, post, age, now);
	return { platform: post.platform, age, views, usual, peers: count, verdict: verdictOf(views, usual) };
}

/* ---- the curve ---- */

export interface Curve {
	platform: StatPlatform;
	/** The stretch drawn: from release to its age, up to a week. */
	span: number;
	/** [ms after release, views]; starts at its first read when flock was not reading it from release. */
	line: [number, number][];
	/** The peers' middle over the same stretch, where there are enough of them. */
	usual: [number, number][];
}

/** At most `max` points, evenly picked, the last always kept. */
export function thin<T>(points: T[], max: number): T[] {
	if (points.length <= max) return points;
	const out: T[] = [];
	const step = (points.length - 1) / (max - 1);
	for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
	return out;
}

export function curve(post: Post, peers: Post[], now: number, steps = 24): Curve {
	const span = Math.max(0, Math.min(now - post.at, COMPARE_AT_MS));
	const line: [number, number][] = [];
	if (fromRelease(post)) line.push([0, 0]);
	for (const [t, v] of post.samples) {
		const offset = t - post.at;
		if (offset > 0 && offset <= span) line.push([offset, v]);
	}
	const end = now - post.at <= COMPARE_AT_MS ? (post.views ?? viewsAt(post, now)) : viewsAt(post, post.at + span);
	if (line.length > 0 && end !== null) line.push([span, end]);
	const usual: [number, number][] = [];
	if (span > 0) {
		usual.push([0, 0]);
		for (let i = 1; i <= steps; i++) {
			const at = (span * i) / steps;
			const { usual: mid } = usualAt(peers, post, at, now);
			if (mid !== null) usual.push([at, mid]);
		}
	}
	return { platform: post.platform, span, line: thin(line, 80), usual: usual.length > 1 ? usual : [] };
}

/* ---- the period numbers ---- */

export type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year';

export interface PeriodStats {
	key: PeriodKey;
	label: string;
	from: Date;
	/** Public releases whose first post went out in the period. */
	released: number;
	/** The views those releases have now, on the chosen platforms. */
	views: number;
	/** Views every release in view gained in the period. */
	gained: number;
	/** Some post was not read yet at the start, so `gained` counts from its first read. */
	partly: boolean;
	/** How far the accounts' follower counts moved in the period, over the chosen platforms; null when none was read. */
	followers: FollowerGain | null;
	byPlatform: Record<StatPlatform, { views: number; gained: number; followers: FollowerGain | null }>;
}

/** Where each period starts: today, this week (Monday), month, quarter and year, on the local clock. */
export function periodStarts(now: Date): [PeriodKey, string, Date][] {
	return [
		['today', 'Today', dayStart(now)],
		['week', 'This week', startOfWeek(now)],
		['month', 'This month', new Date(now.getFullYear(), now.getMonth(), 1)],
		['quarter', 'This quarter', new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)],
		['year', 'This year', new Date(now.getFullYear(), 0, 1)]
	];
}

/**
 * The numbers of each period. `followers` are the follower records of the
 * accounts in view (followers.ts) — the channel, Instagram account, TikTok
 * account and Page whose videos are counted — and their counts' move over the
 * period is the followers gained.
 */
export function periodStats(releases: Release[], filter: DashFilter, now: Date, followers: FollowerState[] = []): PeriodStats[] {
	const end = now.getTime();
	return periodStarts(now).map(([key, label, from]) => {
		const start = from.getTime();
		const stats: PeriodStats = {
			key,
			label,
			from,
			released: 0,
			views: 0,
			gained: 0,
			partly: false,
			followers: null,
			byPlatform: {
				youtube: { views: 0, gained: 0, followers: null },
				instagram: { views: 0, gained: 0, followers: null },
				tiktok: { views: 0, gained: 0, followers: null },
				facebook: { views: 0, gained: 0, followers: null }
			}
		};
		for (const r of releases) {
			const posts = filter.platforms.map((p) => r.posts[p]).filter((p): p is Post => Boolean(p));
			if (posts.length === 0) continue;
			const first = Math.min(...posts.map((p) => p.at));
			const out = visibilityOf(r, filter.platforms) === 'public' && first >= start && first <= end;
			if (out) stats.released += 1;
			for (const post of posts) {
				const views = post.views ?? 0;
				if (out) {
					stats.views += views;
					stats.byPlatform[post.platform].views += views;
				}
				let before = viewsAt(post, start);
				if (before === null) {
					stats.partly = true;
					before = post.samples[0]?.[1] ?? views;
				}
				const gained = Math.max(0, views - before);
				stats.gained += gained;
				stats.byPlatform[post.platform].gained += gained;
			}
		}
		for (const p of filter.platforms) {
			stats.byPlatform[p].followers = sumGains(
				followers.filter((s) => s.platform === p).map((s) => gainedBetween(s, start, end))
			);
		}
		stats.followers = sumGains(filter.platforms.map((p) => stats.byPlatform[p].followers));
		return stats;
	});
}

/* ---- sorting ---- */

export type SortKey = 'date' | 'views' | 'likes' | 'comments' | 'followers' | 'usual' | 'skip';

/** How a video stands on every platform in view at once. */
export interface Overall {
	/** Its views, and the usual, added up over the platforms judged on both. */
	views: number;
	usual: number;
	/** Views over usual; null when no platform has both. */
	ratio: number | null;
	/** The same ±VERDICT_MARGIN as one platform's; null with no ratio. */
	verdict: Verdict | null;
	/** The platforms it is over, and those left out for want of views or a usual. */
	counted: StatPlatform[];
	left: StatPlatform[];
}

/**
 * The overall verdict: each platform's views at its age added up against
 * their usuals added up, so a platform weighs as much as its views do.
 */
export function overallOf(judgements: Judgement[]): Overall {
	let views = 0;
	let usual = 0;
	const counted: StatPlatform[] = [];
	const left: StatPlatform[] = [];
	for (const j of judgements) {
		if (j.views === null || j.usual === null || j.usual <= 0) {
			left.push(j.platform);
			continue;
		}
		views += j.views;
		usual += j.usual;
		counted.push(j.platform);
	}
	const ratio = usual > 0 ? views / usual : null;
	return { views, usual, ratio, verdict: ratio === null ? null : verdictOf(ratio, 1), counted, left };
}

/** Views over usual, over the platforms judged on both; null with none. */
export function ratioOf(judgements: Judgement[]): number | null {
	return overallOf(judgements).ratio;
}

/**
 * Newest first, or most first — the skip rate fewest first, so the best is
 * on top either way — or, `reversed`, the other way round. A missing number
 * sorts last both ways, and ties newest first. `ratio` is views over usual.
 */
export function sortRows<
	T extends {
		release: Release;
		views: number | null;
		likes: number | null;
		comments: number | null;
		followers?: number | null;
		ratio: number | null;
		skip?: number | null;
	}
>(rows: T[], key: SortKey, reversed = false): T[] {
	const value = (row: T): number | null =>
		key === 'date'
			? row.release.at
			: key === 'usual'
				? row.ratio
				: key === 'skip'
					? (row.skip ?? null)
					: key === 'followers'
						? (row.followers ?? null)
						: row[key];
	const direction = (key === 'skip' ? -1 : 1) * (reversed ? -1 : 1);
	return [...rows].sort((a, b) => {
		const x = value(a);
		const y = value(b);
		if (x === y) return b.release.at - a.release.at;
		if (x === null) return 1;
		if (y === null) return -1;
		return (y - x) * direction;
	});
}

/** Which way a column sorts, in words, for its header's tooltip. */
export function sortWords(key: SortKey, reversed: boolean): string {
	const [usual, other] = {
		date: ['newest first', 'oldest first'],
		views: ['most first', 'fewest first'],
		likes: ['most first', 'fewest first'],
		comments: ['most first', 'fewest first'],
		followers: ['most first', 'fewest first'],
		skip: ['fewest skipped first', 'most skipped first'],
		usual: ['furthest ahead first', 'furthest behind first']
	}[key];
	return reversed ? other : usual;
}
