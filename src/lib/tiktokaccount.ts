import type { FollowerState } from './followers';

/**
 * Which TikTok numbers are the brand's. TikTok gives an account a different
 * open id under each app key — the sandbox's and the production app's are
 * two, which is how the open ids changed when the user's keys did on
 * 13 Oct 2026 — so the account a brand chose (its `accounts` row, named by
 * the id the publishing worker's key sees) may not be the id its numbers were
 * read under: a demo signed in through the sandbox, or numbers read before
 * the keys were swapped. They are matched by open id, and by the handle where
 * the id matches nothing; a handle names one TikTok account at a time.
 */

/** The brand's chosen account, as far as matching goes. */
export interface TikTokAccountRef {
	account_id: string;
	handle?: string;
}

const bare = (handle: string | undefined) =>
	String(handle ?? '')
		.trim()
		.replace(/^@/, '')
		.toLowerCase();

const time = (iso: string | undefined) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/** Whether a read TikTok video (a `post_stats` row) is on the account. */
export function onTikTokAccount(row: { account: string; handle?: string }, account: TikTokAccountRef): boolean {
	if (row.account === account.account_id) return true;
	const handle = bare(account.handle);
	return handle !== '' && bare(row.handle) === handle;
}

/** The account's follower record: the one under its open id, else the newest under its handle. */
export function tiktokStateOf(states: FollowerState[], account: TikTokAccountRef): FollowerState | undefined {
	const own = states.filter((s) => s.platform === 'tiktok');
	const exact = own.find((s) => s.account === account.account_id);
	if (exact) return exact;
	const handle = bare(account.handle);
	if (!handle) return undefined;
	return own.filter((s) => bare(s.name) === handle).sort((a, b) => time(b.at) - time(a.at))[0];
}

/** The stats pass's line for the account (`tiktok_stats_status`): under its open id, else the newest under its handle. */
export function tiktokReportOf<T extends { username?: string; polledAt?: string }>(
	reports: Record<string, T> | undefined,
	account: TikTokAccountRef
): T | undefined {
	if (!reports) return undefined;
	if (reports[account.account_id]) return reports[account.account_id];
	const handle = bare(account.handle);
	if (!handle) return undefined;
	return Object.values(reports)
		.filter((r) => bare(r.username) === handle)
		.sort((a, b) => time(b.polledAt) - time(a.polledAt))[0];
}
