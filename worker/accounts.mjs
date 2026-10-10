// The accounts a worker posts as, and which of them a post goes out through.
//
// Credentials are per account and live only in the worker config: Instagram
// keeps a list there (one entry per Instagram account, with the Facebook Page
// it is reached through and that Page's token), YouTube one (one entry per
// channel, with the Google grant that uploads to it), while TikTok holds one
// account for now. PocketBase gets the public half of each — id,
// handle, name — in its `accounts` collection, and every post names the
// account it is for in `upload_targets.account`, so it can only ever go out
// through that account. Pure, so it is tested (accounts.test.mjs).

const IG_FIELDS = ['igUserId', 'username', 'pageId', 'pageName', 'pageAccessToken'];

function cleanInstagram(entry) {
	const out = {};
	for (const key of IG_FIELDS) out[key] = typeof entry?.[key] === 'string' ? entry[key] : '';
	return out;
}

/**
 * The Instagram accounts in a config file's `instagram` section. The list is
 * `accounts`; a section written before there was a list holds one account in
 * flat keys, which is read as a list of one so that config keeps working
 * untouched. INSTAGRAM_PAGE_TOKEN (for a container) overrides the token of
 * the account whose Page is INSTAGRAM_PAGE_ID, or of the only account.
 */
export function instagramAccounts(section = {}, env = {}) {
	let list = Array.isArray(section.accounts) ? section.accounts.map(cleanInstagram) : [];
	if (list.length === 0 && section.igUserId && section.pageAccessToken) {
		list = [cleanInstagram(section)];
	}
	list = list.filter((account) => account.igUserId);

	if (env.INSTAGRAM_PAGE_TOKEN) {
		const target = env.INSTAGRAM_PAGE_ID
			? list.find((a) => a.pageId === env.INSTAGRAM_PAGE_ID)
			: list.length === 1
				? list[0]
				: null;
		if (target) target.pageAccessToken = env.INSTAGRAM_PAGE_TOKEN;
	}
	return list;
}

const GOOGLE_FIELDS = ['channelId', 'title', 'handle', 'refreshToken', 'scope'];

function cleanGoogle(entry) {
	const out = {};
	for (const key of GOOGLE_FIELDS) out[key] = typeof entry?.[key] === 'string' ? entry[key] : '';
	return out;
}

/**
 * The YouTube channels in a config file's `google` section: `accounts`, one
 * entry per channel with its own refresh token. A section written before
 * there was a list holds one grant in `refreshToken`; it reads as a list of
 * one whose channel is not known yet — the worker asks YouTube, and the next
 * `pnpm worker:auth` writes it down. GOOGLE_REFRESH_TOKEN (for a container)
 * is that single grant, or the token of the only channel.
 */
export function googleAccounts(section = {}, env = {}) {
	let list = Array.isArray(section.accounts) ? section.accounts.map(cleanGoogle) : [];
	const flat = env.GOOGLE_REFRESH_TOKEN || section.refreshToken || '';
	if (list.length === 0 && flat) list = [cleanGoogle({ refreshToken: flat })];
	else if (list.length === 1 && env.GOOGLE_REFRESH_TOKEN) list[0].refreshToken = env.GOOGLE_REFRESH_TOKEN;
	return list.filter((account) => account.refreshToken);
}

/** Whether an Instagram account entry has everything publishing needs. */
export function instagramReady(account) {
	return Boolean(account?.igUserId && account.pageId && account.pageAccessToken);
}

/**
 * Adds accounts to a list, replacing any with the same id (a fresh token for
 * an account already there) and keeping every other account as it was.
 */
export function mergeAccounts(existing, added, idOf) {
	const out = [...existing];
	for (const account of added) {
		const at = out.findIndex((a) => idOf(a) === idOf(account));
		if (at >= 0) out[at] = account;
		else out.push(account);
	}
	return out;
}

/**
 * The account a post goes out through. A post that names one gets exactly
 * that one or an error — never another account. A post that names none (an
 * install with a single brand, or a row from before accounts) gets the only
 * account there is; with several, guessing could publish to the wrong one,
 * so it is an error too.
 */
export function pickAccount(accounts, wanted, idOf, platform, setup) {
	if (accounts.length === 0) throw new Error(`${platform} is not set up here. Run:  ${setup}`);
	if (wanted) {
		const found = accounts.find((a) => idOf(a) === wanted);
		if (found) return found;
		throw new Error(
			`This post is for the ${platform} account ${wanted}, which this worker has no credentials for. ` +
				`Connect it with:  ${setup}`
		);
	}
	if (accounts.length === 1) return accounts[0];
	throw new Error(
		`This post names no ${platform} account and this worker holds ${accounts.length}. ` +
			'Choose the account for its brand in Settings → Brands, then queue the post again.'
	);
}

/**
 * Picks pages out of an answer like "1,3", "2" or "all", against a list of
 * `count` choices numbered from 1. Returns null for an answer that is not one.
 */
export function parseChoice(answer, count) {
	const text = String(answer ?? '').trim().toLowerCase();
	if (!text) return null;
	if (text === 'all' || text === 'a') return Array.from({ length: count }, (_, i) => i);
	const picked = new Set();
	for (const part of text.split(/[\s,]+/).filter(Boolean)) {
		const n = Number(part);
		if (!Number.isInteger(n) || n < 1 || n > count) return null;
		picked.add(n - 1);
	}
	return picked.size > 0 ? [...picked].sort((a, b) => a - b) : null;
}
