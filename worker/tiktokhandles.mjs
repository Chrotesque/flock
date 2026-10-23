/**
 * TikTok handles named in captions, looked up for the compose screen
 * (src/lib/tiktokmentions.ts). TikTok links an @mention only when it is the
 * account's exact handle, in lower case, and a caption cannot be edited once
 * posted — so the page shows whose account each mention is before Continue.
 *
 * TikTok has no API for looking an account up (the Research API is for
 * academics), but its documented oEmbed takes a creator profile's address:
 * `/oembed?url=https://www.tiktok.com/@<handle>` answers with the account's
 * name and its handle, and 400 "Something went wrong" for a handle no account
 * has — upper case included, since handles are stored lower case. It is the
 * embed endpoint, so an account that switched embedding off may read as
 * missing; the page only warns on that, it never holds.
 *
 * Its answers carry CORS only when they succeed, so a browser could not tell
 * "no such account" from "slow down" — hence the worker. And it rate-limits
 * hard (24 Oct 2026: about two in three lookups answered 429, some 75 s
 * apart, after a first burst): one lookup at a time, `GAP_MS` apart, backing
 * off on a 429.
 *
 * The page asks by writing a `tiktok_handles` row as `pending`; the newest
 * ask goes first, so somebody typing is answered before the handles read out
 * of old captions (`seedHandles`) that fill the list of accounts to suggest.
 */

export const OEMBED_URL = 'https://www.tiktok.com/oembed';
export const GAP_MS = 20_000;
export const LIMITED_MIN_MS = 60_000;
export const LIMITED_MAX_MS = 10 * 60_000;
const HANDLE_MAX = 24;
const USER_AGENT = 'flock-worker (+https://flock-scheduler.netlify.app)';

/** The same pattern as findMentions in src/lib/tiktokmentions.ts; keep the two together. */
const MENTION = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]*)/g;

/** The handles mentioned in captions, lower case, each once, in order. */
export function captionHandles(texts) {
	const out = new Set();
	for (const text of texts) {
		for (const match of String(text ?? '').matchAll(MENTION)) {
			const handle = match[2].replace(/\.+$/, '').toLowerCase();
			if (handle.length >= 2 && handle.length <= HANDLE_MAX) out.add(handle);
		}
	}
	return [...out];
}

/**
 * What TikTok says about a handle: `found` with its name and handle,
 * `missing`, `limited` (429, ask later) or `failed`.
 */
export async function lookupTikTokHandle(handle, { fetchImpl = fetch } = {}) {
	const profile = `https://www.tiktok.com/@${handle}`;
	let res;
	try {
		res = await fetchImpl(`${OEMBED_URL}?url=${encodeURIComponent(profile)}`, {
			headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(20_000)
		});
	} catch (err) {
		return { state: 'failed', error: `TikTok did not answer (${err instanceof Error ? err.message : String(err)})` };
	}
	if (res.status === 429) return { state: 'limited' };
	const body = await res.text().catch(() => '');
	let json = null;
	try {
		json = JSON.parse(body);
	} catch {
		// Not JSON: said below with the status.
	}
	if (res.ok && json?.embed_type === 'profile' && json.embed_product_id) {
		return {
			state: 'found',
			handle: String(json.embed_product_id).toLowerCase(),
			name: String(json.author_name ?? '').slice(0, 200)
		};
	}
	if (res.status === 400 && json?.code === 400) return { state: 'missing' };
	const said = json?.message ? String(json.message) : body.slice(0, 120);
	return { state: 'failed', error: `TikTok answered ${res.status}${said ? `: ${said}` : ''}` };
}

/** How long to wait before the next lookup, after one that ended as `outcome`. */
export function nextDelay(outcome, previous) {
	if (outcome !== 'limited') return GAP_MS;
	return Math.min(LIMITED_MAX_MS, Math.max(LIMITED_MIN_MS, previous * 2));
}

/** "01:42", local time of the machine that answers — the page shows it as said. */
function clock(ms) {
	const at = new Date(ms);
	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The row's patch for an answer; null for `limited`, which keeps it pending. */
export function answerPatch(result, now) {
	const checked_at = new Date(now).toISOString();
	if (result.state === 'found') return { status: 'found', name: result.name, error: '', checked_at };
	if (result.state === 'missing') return { status: 'missing', name: '', error: '', checked_at };
	if (result.state === 'failed') return { status: 'failed', error: result.error.slice(0, 1000), checked_at };
	return null;
}

/**
 * One lookup, if one is waiting and the gap has passed. `state` is kept by
 * the caller between ticks: `{ nextAt, delay, off, busy }`.
 */
export async function tiktokHandlePass({ pb, log, state, now = Date.now(), fetchImpl = fetch }) {
	if (state.off || state.busy || now < state.nextAt) return;
	state.busy = true;
	try {
		let row;
		try {
			row = await pb.nextTikTokHandle();
		} catch (err) {
			if (!/ -> 404\b/.test(err.message)) throw err;
			state.off = true;
			log('tiktok_handles is missing — run pnpm setup-pb, then restart; TikTok mentions are not looked up until then');
			return;
		}
		if (!row) return;
		const result = await lookupTikTokHandle(row.handle, { fetchImpl });
		state.delay = nextDelay(result.state, state.delay ?? 0);
		state.nextAt = now + state.delay;
		if (result.state === 'limited') {
			await pb.updateTikTokHandle(row.id, {
				error: `TikTok is limiting lookups; asking again at ${clock(state.nextAt)}.`
			});
			if (state.delay === LIMITED_MIN_MS) log('TikTok is limiting handle lookups — backing off');
			return;
		}
		await pb.updateTikTokHandle(row.id, answerPatch(result, now));
		// A handle typed in a case TikTok redirected is stored as asked; the page
		// asks in lower case, so this only shows up in a hand-written row.
		if (result.state === 'found' && result.handle !== row.handle) {
			log(`TikTok knows @${row.handle} as @${result.handle}`);
		}
	} finally {
		state.busy = false;
	}
}

/**
 * Adds every handle mentioned in the TikTok captions flock knows — its own
 * posts and those read from TikTok — that is not listed yet, as `pending`
 * and `used`, so the compose screen can suggest accounts mentioned before.
 */
export async function seedHandles({ pb, log }) {
	const [texts, rows] = await Promise.all([pb.tiktokCaptions(), pb.listTikTokHandles()]);
	const known = new Set(rows.map((row) => row.handle));
	const fresh = captionHandles(texts).filter((handle) => !known.has(handle));
	for (const handle of fresh) {
		try {
			await pb.createTikTokHandle({ handle, status: 'pending', used: true });
		} catch {
			// Taken in the meantime by the page's own ask: the unique index says no.
		}
	}
	// Mentioned before but asked about only from the page: now marked as used.
	const mentioned = new Set(captionHandles(texts));
	for (const row of rows) {
		if (!row.used && mentioned.has(row.handle)) await pb.updateTikTokHandle(row.id, { used: true });
	}
	if (fresh.length > 0) log(`${fresh.length} TikTok handle${fresh.length === 1 ? '' : 's'} from past captions to look up`);
}
