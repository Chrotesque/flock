import type { StatPlatform } from './releases';

/**
 * Followers on the Dashboard, as the worker records them (worker/followers.mjs):
 * one `app_settings` row per account, `followers:<platform>:<account id>`,
 * with the account's follower count, its history and — for YouTube,
 * Instagram and TikTok, which name no video for a follower — the followers
 * credited to each post: a rise in the count goes to the posts that gained views in that
 * stretch, by those views, or to the newest post when none did. Facebook
 * counts follows per reel itself (post_video_followers in a reel's insights);
 * its row only keeps the Page's count, for the follower gains of a period.
 * YouTube's own per-video figures, from YouTube Analytics once the channel's
 * grant allows it (worker/ytanalytics.mjs), win over the credit for every
 * video out by the last day they cover.
 */

export const FOLLOWER_PREFIX = 'followers:';

export interface FollowerState {
	platform: StatPlatform;
	/** The channel id, Instagram user id, TikTok open id or Page id. */
	account: string;
	name: string;
	/** The count at the last read. */
	count: number;
	/** When it was last read, and first read (flock knows nothing from before). */
	at: string;
	since: string;
	/** [iso, count], a sample only when the count changed, oldest first. */
	history: [string, number][];
	/** Followers credited so far, by the platform's post id. */
	credits: Record<string, number>;
	/** YouTube Analytics' subscribers per video, [gained, lost]; null until read. */
	analytics: Record<string, [number, number]> | null;
	/** YouTube Analytics' plays and engaged views per video, [views, engagedViews]; null until read. */
	engaged: Record<string, [number, number]> | null;
	/** The account's own [views, likes, comments] per whole month, 'YYYY-MM' (worker/monthly.mjs); null until read. */
	monthly: Record<string, [number, number, number]> | null;
	/** The last day those cover, 'YYYY-MM-DD' (YouTube's, Pacific); '' until read. */
	analyticsThrough: string;
}

const time = (iso: unknown) => Date.parse(String(iso ?? '').replace(' ', 'T'));
const PLATFORMS: StatPlatform[] = ['youtube', 'instagram', 'tiktok', 'facebook'];

/** A row's value rebuilt field by field; null when it is no follower record. */
export function readFollowerState(raw: unknown): FollowerState | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const platform = PLATFORMS.find((p) => p === r.platform);
	if (!platform || typeof r.count !== 'number' || !Number.isFinite(time(r.at))) return null;
	const history = (Array.isArray(r.history) ? r.history : [])
		.filter((s): s is [string, number] => Array.isArray(s) && Number.isFinite(time(s[0])) && typeof s[1] === 'number')
		.map(([iso, count]) => [String(iso), count] as [string, number])
		.sort((a, b) => time(a[0]) - time(b[0]));
	const credits: Record<string, number> = {};
	const stored = r.credits && typeof r.credits === 'object' ? (r.credits as Record<string, unknown>) : {};
	for (const [id, n] of Object.entries(stored)) if (typeof n === 'number' && n > 0) credits[id] = n;
	return {
		platform,
		account: String(r.account ?? ''),
		name: String(r.name ?? ''),
		count: r.count,
		at: String(r.at),
		since: Number.isFinite(time(r.since)) ? String(r.since) : String(r.at),
		history,
		credits,
		analytics: readPairs(r.analytics),
		engaged: readPairs(r.engaged),
		monthly: readMonthly(r.monthly),
		analyticsThrough: typeof r.analyticsThrough === 'string' ? r.analyticsThrough : ''
	};
}

/** { 'YYYY-MM': [views, likes, comments] }, read back; null when none are stored. */
function readMonthly(raw: unknown): Record<string, [number, number, number]> | null {
	if (!raw || typeof raw !== 'object') return null;
	const out: Record<string, [number, number, number]> = {};
	for (const [month, counts] of Object.entries(raw as Record<string, unknown>)) {
		if (/^\d{4}-\d{2}$/.test(month) && Array.isArray(counts) && counts.length === 3 && counts.every((n) => typeof n === 'number')) {
			out[month] = [counts[0], counts[1], counts[2]];
		}
	}
	return out;
}

/** Per-video pairs of numbers, read back; null when there are none stored. */
function readPairs(raw: unknown): Record<string, [number, number]> | null {
	if (!raw || typeof raw !== 'object') return null;
	const out: Record<string, [number, number]> = {};
	for (const [id, pair] of Object.entries(raw as Record<string, unknown>)) {
		if (Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number') out[id] = [pair[0], pair[1]];
	}
	return out;
}

/**
 * Analytics must have counted at least this share of a video's public views
 * before its skip rate shows: a Short a day or two out has only its first
 * hours in YouTube Analytics (2 of 1,322 views, seen 21 Oct 2026), which says
 * nothing yet.
 */
export const ENGAGED_COVERAGE = 0.5;

/** A video's [views, engagedViews] as YouTube Analytics last gave them, from whichever channel's row has it. */
export function engagedOf(states: FollowerState[], videoId: string): [number, number] | null {
	for (const state of states) if (state.platform === 'youtube' && state.engaged?.[videoId]) return state.engaged[videoId];
	return null;
}

/**
 * YouTube's skip rate, %: the share of a video's plays that never became an
 * engaged view (YouTube's view before 31 Mar 2025, counted past a threshold
 * it does not name, so not quite Instagram's 3 seconds). Null until
 * Analytics has caught up with the video (ENGAGED_COVERAGE).
 */
export function youtubeSkipRate(pair: [number, number] | null, publicViews: number | null): number | null {
	if (!pair) return null;
	const [views, engaged] = pair;
	if (views <= 0 || (publicViews != null && views < publicViews * ENGAGED_COVERAGE)) return null;
	return Math.min(100, Math.max(0, (1 - engaged / views) * 100));
}

/** The record of one account, if flock has one. */
export function stateOf(states: FollowerState[], platform: StatPlatform, account: string): FollowerState | undefined {
	return account ? states.find((s) => s.platform === platform && s.account === account) : undefined;
}

/** When a YouTube day (Pacific) ends, near enough: 08:00 UTC the next morning (as the worker reckons it). */
export function dayEnd(day: string): number {
	return Date.parse(`${day}T08:00:00Z`) + 86_400_000;
}

/** Where a post's followers come from: YouTube Analytics for a video out by its last day, else flock's credit. */
export function followerSource(state: FollowerState | undefined, at: number): 'analytics' | 'credit' {
	return state?.analytics && state.analyticsThrough && at < dayEnd(state.analyticsThrough) ? 'analytics' : 'credit';
}

/**
 * A YouTube video's, an Instagram post's or a TikTok video's followers: YouTube Analytics'
 * gained less lost for a video it covers, else what flock credited. Null with
 * no record for its account, and for a post that came out before flock first
 * read the count and was credited nothing since — that is not known, not none.
 */
export function creditedFollowers(state: FollowerState | undefined, postId: string, at: number): number | null {
	if (!state) return null;
	if (followerSource(state, at) === 'analytics') {
		const pair = state.analytics?.[postId];
		return pair ? pair[0] - pair[1] : 0;
	}
	const credit = state.credits[postId] ?? 0;
	if (credit === 0 && at < time(state.since)) return null;
	return credit;
}

/** A Facebook reel's follows, from its insights; null when they were not read. */
export function facebookFollows(insights: Record<string, unknown> | undefined): number | null {
	const value = insights?.post_video_followers;
	return typeof value === 'number' ? value : null;
}

/** The count held at a moment: the last sample at or before it; null before the first. */
export function countAt(state: FollowerState, at: number): number | null {
	let found: number | null = null;
	for (const [iso, count] of state.history) {
		if (time(iso) > at) break;
		found = count;
	}
	return found;
}

export interface FollowerGain {
	/** The count's change over the stretch: followers won less followers lost. */
	gained: number;
	/** The record starts inside the stretch, so this counts from its first read. */
	partly: boolean;
}

/** How far an account's count moved between two moments; null when it was not read by `to`. */
export function gainedBetween(state: FollowerState, from: number, to: number): FollowerGain | null {
	const end = countAt(state, to);
	if (end === null) return null;
	const start = countAt(state, from);
	if (start !== null) return { gained: end - start, partly: false };
	return { gained: end - (state.history[0]?.[1] ?? end), partly: true };
}

/** Several accounts' moves added up (one platform's, or every platform's); null when none was read. */
export function sumGains(gains: (FollowerGain | null)[]): FollowerGain | null {
	const read = gains.filter((g): g is FollowerGain => g !== null);
	if (read.length === 0) return null;
	return { gained: read.reduce((sum, g) => sum + g.gained, 0), partly: read.some((g) => g.partly) };
}
