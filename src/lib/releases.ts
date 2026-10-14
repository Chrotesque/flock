import { dayStart, startOfWeek } from './format';
import { kindOf, KIND_ORDER, SHORT_MAX_SECONDS, type VideoKind } from './videokind';
import type { PlatformId } from './types';

/**
 * The dashboard's arithmetic: every video on the brand's channel and
 * Instagram account, the numbers by period and what is coming, over every
 * platform flock reads counters for — together (the combined view) or apart.
 *
 * A *release* is one video wherever it went out: a YouTube video and the
 * Instagram reel of the same flock upload are one release (matched by the
 * upload's links), and without that, a Short and a reel posted within two
 * hours of each other. Everything else is a release of its own.
 *
 * One YouTube channel at a time — the brand in view's — because YouTube's
 * policies forbid adding figures up across channels; the caller filters.
 * Sums across platforms and "usual" are flock's own arithmetic, never
 * YouTube's figures, and the page says so (Developer Policies III.E.4.h).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The platforms flock reads counters for. TikTok and Facebook are posted to but report nothing back yet. */
export type StatPlatform = 'youtube' | 'instagram';
export const STAT_PLATFORMS: StatPlatform[] = ['youtube', 'instagram'];
/** Every platform, in display order; the ones not in STAT_PLATFORMS show as "not read yet". */
export const ALL_PLATFORMS: PlatformId[] = ['youtube', 'instagram', 'tiktok', 'facebook'];

/** Each platform's line and swatch, checked as a pair on the dark surface. */
export const PLATFORM_COLOURS: Record<StatPlatform, string> = { youtube: '#e8484a', instagram: '#9b6cf0' };

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
}

/** A `post_stats` row for an Instagram reel, slim. */
export interface ReelRow {
	id: string;
	post_id: string;
	published_at: string;
	views: number | null;
	likes: number | null;
	comments: number | null;
	reach: number | null;
	permalink: string;
	caption: string;
	history: Sample[];
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
	/** YouTube's video id, Instagram's media id. */
	id: string;
	url: string;
	at: number;
	views: number | null;
	likes: number | null;
	comments: number | null;
	/** [ms, views], oldest first, nulls left out. */
	samples: [number, number][];
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
		samples: toSamples(row.history)
	};
}

export function reelPost(row: ReelRow): Post {
	return {
		platform: 'instagram',
		record: row.id,
		id: row.post_id,
		url: row.permalink,
		at: time(row.published_at),
		views: row.views,
		likes: row.likes,
		comments: row.comments,
		samples: toSamples(row.history)
	};
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
	/** Every place flock posted it, counters or not (TikTok and Facebook too). */
	links: Partial<Record<PlatformId, string>>;
	/** The flock upload, '' when it went out some other way. */
	job: string;
	/** How its posts were matched: the same flock upload, or posted close together; '' for one post. */
	matched: 'job' | 'time' | '';
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
 * Every release of a channel and an Instagram account. A YouTube video and a
 * reel are one release when the same flock upload made both; failing that, a
 * Short and a reel within two hours of each other are paired closest first,
 * one to one. A reel left over is a release of its own, kind Short.
 */
export function buildReleases(videos: YouTubeRow[], reels: ReelRow[], targets: TargetLink[]): Release[] {
	// What each flock upload made, by platform, and the way back from a post to its upload.
	const jobs = new Map<string, { title: string; links: Partial<Record<PlatformId, string>> }>();
	const jobOfVideo = new Map<string, string>();
	const jobOfReel = new Map<string, string>();
	for (const t of targets) {
		if (!t.remote_url) continue;
		const entry = jobs.get(t.job) ?? { title: t.jobTitle, links: {} };
		entry.links[t.platform] = t.remote_url;
		jobs.set(t.job, entry);
		if (t.platform === 'youtube') {
			const id = youtubeId(t.remote_url);
			if (id) jobOfVideo.set(id, t.job);
		} else if (t.platform === 'instagram') jobOfReel.set(sameLink(t.remote_url), t.job);
	}

	const reelPosts = reels.map((row) => ({ row, post: reelPost(row) }));
	const reelByLink = new Map(reelPosts.map((r) => [sameLink(r.row.permalink), r]));
	const usedReels = new Set<string>();

	const out: Release[] = videos.map((row) => {
		const post = youtubePost(row);
		const job = jobOfVideo.get(row.video_id) ?? '';
		const links: Partial<Record<PlatformId, string>> = { ...(jobs.get(job)?.links ?? {}), youtube: post.url };
		const release: Release = {
			key: `yt:${row.video_id}`,
			title: row.title || jobs.get(job)?.title || '(untitled)',
			at: post.at,
			kind: kindOf({ duration: row.duration, live: row.live }),
			privacy: row.privacy || 'public',
			duration: row.duration,
			thumb: row.thumb,
			posts: { youtube: post },
			links,
			job,
			matched: ''
		};
		const reel = job && links.instagram ? reelByLink.get(sameLink(links.instagram)) : undefined;
		if (reel && !usedReels.has(reel.row.post_id)) {
			release.posts.instagram = reel.post;
			release.links.instagram = reel.post.url;
			release.at = Math.min(release.at, reel.post.at);
			release.matched = 'job';
			usedReels.add(reel.row.post_id);
		}
		return release;
	});

	// Closest first, one to one: Shorts without a reel, reels no upload claimed.
	const candidates: [number, Release, (typeof reelPosts)[number]][] = [];
	for (const release of out) {
		if (release.posts.instagram || release.kind !== 'short') continue;
		// The upload says where its reel is (or that it had none): no guessing past it.
		if (release.job && jobs.get(release.job)?.links.instagram) continue;
		const at = release.posts.youtube!.at;
		for (const reel of reelPosts) {
			if (usedReels.has(reel.row.post_id)) continue;
			// Likewise a reel whose upload made a YouTube video too. One made on its
			// own (a platform given its own file is an upload of its own) may pair.
			const reelJob = jobOfReel.get(sameLink(reel.row.permalink));
			if (reelJob && jobs.get(reelJob)?.links.youtube) continue;
			const gap = Math.abs(reel.post.at - at);
			if (gap <= PAIR_WINDOW_MS) candidates.push([gap, release, reel]);
		}
	}
	candidates.sort((a, b) => a[0] - b[0]);
	for (const [, release, reel] of candidates) {
		if (release.posts.instagram || usedReels.has(reel.row.post_id)) continue;
		release.posts.instagram = reel.post;
		release.links.instagram = reel.post.url;
		release.at = Math.min(release.at, reel.post.at);
		release.matched = 'time';
		usedReels.add(reel.row.post_id);
	}

	for (const { row, post } of reelPosts) {
		if (usedReels.has(row.post_id)) continue;
		const job = jobOfReel.get(sameLink(row.permalink)) ?? '';
		out.push({
			key: `ig:${row.post_id}`,
			title: jobs.get(job)?.title || captionTitle(row.caption) || '(no caption)',
			at: post.at,
			kind: 'short',
			privacy: 'public',
			duration: 0,
			thumb: '',
			posts: { instagram: post },
			links: { ...(jobs.get(job)?.links ?? {}), instagram: post.url },
			job,
			matched: ''
		});
	}
	return out.filter((r) => Number.isFinite(r.at));
}

/* ---- what is looked at ---- */

export interface DashFilter {
	/** Whose counters count. All of them is the combined view. */
	platforms: StatPlatform[];
	kinds: VideoKind[];
	/** Show unlisted videos. */
	unlisted: boolean;
	/** Show private ones — a scheduled upload is private until its slot. */
	private: boolean;
}

export const DEFAULT_FILTER: DashFilter = {
	platforms: [...STAT_PLATFORMS],
	kinds: [...KIND_ORDER],
	unlisted: false,
	private: false
};

/** A stored filter, rebuilt field by field; what is unknown or empty falls back. */
export function readFilter(raw: unknown): DashFilter {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const platforms = Array.isArray(r.platforms) ? STAT_PLATFORMS.filter((p) => (r.platforms as unknown[]).includes(p)) : [];
	const kinds = Array.isArray(r.kinds) ? KIND_ORDER.filter((k) => (r.kinds as unknown[]).includes(k)) : null;
	return {
		platforms: platforms.length > 0 ? platforms : [...DEFAULT_FILTER.platforms],
		kinds: kinds ?? [...DEFAULT_FILTER.kinds],
		unlisted: typeof r.unlisted === 'boolean' ? r.unlisted : DEFAULT_FILTER.unlisted,
		private: typeof r.private === 'boolean' ? r.private : DEFAULT_FILTER.private
	};
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
	return onPlatforms(release, filter.platforms) && filter.kinds.includes(release.kind) && visible(release, filter);
}

export interface FilterCounts {
	kinds: Record<VideoKind, number>;
	unlisted: number;
	private: number;
	platforms: Record<StatPlatform, number>;
}

/** The number beside each choice: what it would add, given the other choices as they are. */
export function filterCounts(releases: Release[], filter: DashFilter): FilterCounts {
	const out: FilterCounts = {
		kinds: { short: 0, long: 0, live: 0, other: 0 },
		unlisted: 0,
		private: 0,
		platforms: { youtube: 0, instagram: 0 }
	};
	for (const r of releases) {
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

export type Counter = 'views' | 'likes' | 'comments';

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

/** Peers by platform and kind: public posts only, so a private test never sets the bar. */
export function peerGroups(releases: Release[]): Map<string, Post[]> {
	const out = new Map<string, Post[]>();
	for (const r of releases) {
		if (r.privacy !== 'public') continue;
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

export type PeriodKey = 'today' | 'week' | 'month';

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
	byPlatform: Record<StatPlatform, { views: number; gained: number }>;
}

export function periodStats(releases: Release[], filter: DashFilter, now: Date): PeriodStats[] {
	const periods: [PeriodKey, string, Date][] = [
		['today', 'Today', dayStart(now)],
		['week', 'This week', startOfWeek(now)],
		['month', 'This month', new Date(now.getFullYear(), now.getMonth(), 1)]
	];
	const end = now.getTime();
	return periods.map(([key, label, from]) => {
		const start = from.getTime();
		const stats: PeriodStats = {
			key,
			label,
			from,
			released: 0,
			views: 0,
			gained: 0,
			partly: false,
			byPlatform: { youtube: { views: 0, gained: 0 }, instagram: { views: 0, gained: 0 } }
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
		return stats;
	});
}

/* ---- sorting ---- */

export type SortKey = 'date' | 'views' | 'likes' | 'comments' | 'usual';

/** Views over usual, over the platforms judged on both; null with none. */
export function ratioOf(judgements: Judgement[]): number | null {
	let views = 0;
	let usual = 0;
	for (const j of judgements) {
		if (j.views === null || j.usual === null || j.usual <= 0) continue;
		views += j.views;
		usual += j.usual;
	}
	return usual > 0 ? views / usual : null;
}

/** Newest first, or most first; a missing number sorts last. `ratio` is views over usual. */
export function sortRows<T extends { release: Release; views: number | null; likes: number | null; comments: number | null; ratio: number | null }>(
	rows: T[],
	key: SortKey
): T[] {
	const value = (row: T): number | null =>
		key === 'date' ? row.release.at : key === 'usual' ? row.ratio : row[key];
	return [...rows].sort((a, b) => {
		const x = value(a);
		const y = value(b);
		if (x === y) return b.release.at - a.release.at;
		if (x === null) return 1;
		if (y === null) return -1;
		return y - x;
	});
}

/* ---- coming up ---- */

/** A post still to go out, as the coming-up strip reads it (DashTarget's fields). */
export interface ComingPost {
	id: string;
	job: string;
	platform: PlatformId;
	status: string;
	scheduled_at: string;
	title: string;
	jobTitle: string;
}

/** One upload's posts on one day: one cluster of icons. */
export interface ComingUpload<P extends ComingPost = ComingPost> {
	key: string;
	job: string;
	title: string;
	/** Its first slot that day, ms. */
	first: number;
	/** Its posts that day, by slot, then in platform order. */
	posts: P[];
}

/**
 * A day's posts as uploads, each upload's posts together however their slots
 * differ (a reel at 10:00 and the Short at 15:00 are one cluster), in the
 * order of each upload's first slot.
 */
export function uploadsOfDay<P extends ComingPost>(posts: P[]): ComingUpload<P>[] {
	const byJob = new Map<string, ComingUpload<P>>();
	for (const post of posts) {
		const at = time(post.scheduled_at);
		const entry = byJob.get(post.job);
		if (entry) {
			entry.posts.push(post);
			entry.first = Math.min(entry.first, at);
			if (!entry.title) entry.title = post.title || post.jobTitle;
		} else {
			byJob.set(post.job, {
				key: post.job,
				job: post.job,
				title: post.jobTitle || post.title,
				first: at,
				posts: [post]
			});
		}
	}
	const order = (p: PlatformId) => ALL_PLATFORMS.indexOf(p);
	return [...byJob.values()]
		.map((u) => ({
			...u,
			title: u.title || 'Untitled',
			posts: [...u.posts].sort((a, b) => time(a.scheduled_at) - time(b.scheduled_at) || order(a.platform) - order(b.platform))
		}))
		.sort((a, b) => a.first - b.first);
}
