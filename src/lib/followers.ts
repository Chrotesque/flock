import type { StatPlatform } from './releases';

/**
 * Followers on the Dashboard, as the worker records them (worker/followers.mjs):
 * one `app_settings` row per account, `followers:<platform>:<account id>`,
 * with the account's follower count, its history and — for YouTube and
 * Instagram, which name no video for a follower — the followers credited to
 * each post: a rise in the count goes to the posts that gained views in that
 * stretch, by those views, or to the newest post when none did. Facebook
 * counts follows per reel itself (post_video_followers in a reel's insights);
 * its row only keeps the Page's count, for the follower gains of a period.
 */

export const FOLLOWER_PREFIX = 'followers:';

export interface FollowerState {
	platform: StatPlatform;
	/** The channel id, Instagram user id or Page id. */
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
}

const time = (iso: unknown) => Date.parse(String(iso ?? '').replace(' ', 'T'));
const PLATFORMS: StatPlatform[] = ['youtube', 'instagram', 'facebook'];

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
		credits
	};
}

/** The record of one account, if flock has one. */
export function stateOf(states: FollowerState[], platform: StatPlatform, account: string): FollowerState | undefined {
	return account ? states.find((s) => s.platform === platform && s.account === account) : undefined;
}

/**
 * A YouTube video's or an Instagram post's followers: what was credited to
 * it. Null with no record for its account, and for a post that came out
 * before flock first read the count and was credited nothing since — that
 * is not known, not none.
 */
export function creditedFollowers(state: FollowerState | undefined, postId: string, at: number): number | null {
	if (!state) return null;
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
