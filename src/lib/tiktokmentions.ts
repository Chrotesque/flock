/**
 * @mentions in a TikTok caption.
 *
 * TikTok's Direct Post links a mention only when it is the account's handle
 * exactly, and handles are lower case: of two brands tagged through flock
 * on 22 Oct 2026, the one written in lower case went out as a link, the one
 * written with capitals as plain text.
 * A caption cannot be edited once posted, so the compose screen checks every
 * mention before Continue: an upper-case one holds it (it can never link, and
 * lower case is always right), and each handle is looked up with TikTok
 * (worker/tiktokhandles.mjs) so the account's own name shows beside it.
 *
 * The worker reads mentions out of past captions with the same pattern
 * (`MENTION` in worker/tiktokhandles.mjs); keep the two together.
 */

/** A mention: `start` is the "@", `end` the first character after the handle. */
export interface Mention {
	start: number;
	end: number;
	/** As typed, without the "@"; '' for a bare "@". */
	handle: string;
}

/** What flock knows about a handle, one `tiktok_handles` row. */
export interface TikTokHandle {
	id: string;
	/** Lower case, without the "@". */
	handle: string;
	status: 'pending' | 'found' | 'missing' | 'failed';
	/** The account's own name, as TikTok gives it. */
	name: string;
	/** When TikTok last answered (ISO), '' before. */
	checkedAt: string;
	error: string;
	/** Mentioned in a caption that went out (or was confirmed). */
	used: boolean;
	updated: string;
}

/** TikTok's longest handle. */
export const HANDLE_MAX = 24;

/**
 * A handle is letters, digits, underscores and periods. An "@" counts only
 * at the start or after something that cannot be part of a handle, so an
 * e-mail address is not read as a mention. A handle never ends in a period,
 * so one right after it ends the sentence instead.
 */
const MENTION = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]*)/g;

export function findMentions(text: string): Mention[] {
	const out: Mention[] = [];
	for (const match of text.matchAll(MENTION)) {
		const start = (match.index ?? 0) + match[1].length;
		const handle = match[2].replace(/\.+$/, '');
		out.push({ start, end: start + 1 + handle.length, handle });
	}
	return out;
}

/** How a handle is stored and looked up. */
export function handleKey(handle: string): string {
	return handle.toLowerCase();
}

/** The mention the caret is in or right after, for the lookup popup. */
export function mentionAt(mentions: Mention[], caret: number): Mention | null {
	return mentions.find((m) => m.start < caret && caret <= m.end) ?? null;
}

/** Whether a handle is worth asking TikTok about at all. */
export function askable(handle: string): boolean {
	return handle.length >= 2 && handle.length <= HANDLE_MAX;
}

/** How long an answer is trusted before the handle is asked about again. */
const TRUST_MS = {
	found: 30 * 24 * 60 * 60_000,
	missing: 24 * 60 * 60_000,
	failed: 2 * 60_000
};

/** Whether the page should ask (again) about a handle it has this row for. */
export function needsAsking(row: TikTokHandle | undefined, now: number): boolean {
	if (!row) return true;
	if (row.status === 'pending') return false;
	const at = Date.parse(row.checkedAt || row.updated);
	if (!Number.isFinite(at)) return true;
	return now - at > TRUST_MS[row.status];
}

export type MentionState = 'case' | 'long' | 'found' | 'missing' | 'checking' | 'failed';

export interface MentionNote {
	mention: Mention;
	/** Lower case, what TikTok would link. */
	key: string;
	state: MentionState;
	/** The account's name when TikTok knows it. */
	name: string;
	words: string;
}

/**
 * One note per mention with a handle, in caption order: what is wrong with
 * it, or whose account it is. Upper case is reported before anything else,
 * since it is the fix to make first and its lookup is of the lower-case
 * handle anyway.
 */
export function mentionNotes(text: string, known: Record<string, TikTokHandle>): MentionNote[] {
	return findMentions(text)
		.filter((m) => m.handle !== '')
		.map((mention) => {
			const key = handleKey(mention.handle);
			const row = known[key];
			const note = (state: MentionState, words: string): MentionNote => ({
				mention,
				key,
				state,
				name: row?.status === 'found' ? row.name : '',
				words
			});
			if (mention.handle.length > HANDLE_MAX) {
				return note('long', `@${mention.handle} is longer than a TikTok handle can be (${HANDLE_MAX}).`);
			}
			if (mention.handle !== key) {
				return note(
					'case',
					`@${mention.handle} will not link: TikTok handles are lower case. Use @${key}.`
				);
			}
			if (row?.status === 'found') return note('found', row.name || `@${key}`);
			if (row?.status === 'missing') {
				return note('missing', `TikTok has no public account @${key}. Check the spelling.`);
			}
			if (row?.status === 'failed') {
				return note('failed', `Could not ask TikTok about @${key}: ${row.error || 'no answer'}`);
			}
			return note('checking', row?.error ? `Asking TikTok about @${key}… ${row.error}` : `Asking TikTok about @${key}…`);
		});
}

/**
 * What holds TikTok's Continue: mentions that can never link, whatever
 * TikTok says about the account. A handle TikTok does not know is only
 * warned about — the lookup goes through TikTok's embeds, which an account
 * can switch off.
 */
export function captionProblems(text: string): string[] {
	return mentionNotes(text, {})
		.filter((n) => n.state === 'case' || n.state === 'long')
		.map((n) => n.words);
}

/** The caption with every mention in lower case. */
export function lowerMentions(text: string): string {
	let out = text;
	for (const m of findMentions(text).reverse()) {
		out = out.slice(0, m.start + 1) + m.handle.toLowerCase() + out.slice(m.end);
	}
	return out;
}

/**
 * The caption with one mention swapped for a handle, and where the caret
 * goes: right after it, past a space added when the mention ended the text.
 */
export function replaceMention(text: string, mention: Mention, handle: string): { text: string; caret: number } {
	const rest = text.slice(mention.end);
	const space = rest === '' ? ' ' : '';
	const head = `${text.slice(0, mention.start)}@${handle}${space}`;
	return { text: head + rest, caret: head.length };
}

/** A run of the caption mirror: past the visible cut or not, part of a mention or not. */
export interface CaptionSegment {
	text: string;
	cut: boolean;
	/** Index into the mentions, -1 for plain text. */
	mention: number;
}

/**
 * Splits the caption for its mirror, at the visible cut and at each
 * mention's edges, so a mention can be marked without the text moving: the
 * mirror has to lay out exactly like the textarea over it.
 */
export function captionSegments(text: string, cut: number | null, mentions: Mention[]): CaptionSegment[] {
	const edges = new Set([0, text.length]);
	if (cut !== null && cut > 0 && cut < text.length) edges.add(cut);
	for (const m of mentions) {
		edges.add(m.start);
		edges.add(Math.min(m.end, text.length));
	}
	const points = [...edges].sort((a, b) => a - b);
	const out: CaptionSegment[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const [a, b] = [points[i], points[i + 1]];
		if (a === b) continue;
		out.push({
			text: text.slice(a, b),
			cut: cut !== null && a >= cut,
			mention: mentions.findIndex((m) => m.start <= a && b <= m.end)
		});
	}
	return out;
}

/** Letters and digits, lower case: how a typed name is held against an account's. */
function squash(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The known accounts that fit what has been typed after the "@", best first:
 * the handle starting with it, then the account's name starting with it,
 * then either containing it — so "@OwlsNest" and "@games" both find
 * @owlsnestgamesltd (Owls Nest Games). Only accounts TikTok confirmed;
 * among equal matches those mentioned in a caption before come first. The
 * exact handle typed is left out, since the popup shows it on its own line.
 */
export function suggestHandles(typed: string, known: TikTokHandle[], limit = 6): TikTokHandle[] {
	const key = handleKey(typed);
	const q = squash(typed);
	const rank = (row: TikTokHandle): number => {
		if (!q) return 0;
		const name = squash(row.name);
		const plain = squash(row.handle);
		if (row.handle.startsWith(key) || plain.startsWith(q)) return 1;
		if (name.startsWith(q)) return 2;
		if (plain.includes(q)) return 3;
		if (name.includes(q)) return 4;
		return -1;
	};
	return known
		.filter((row) => row.status === 'found' && row.handle !== key)
		.map((row) => ({ row, rank: rank(row) }))
		.filter((entry) => entry.rank >= 0)
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				Number(b.row.used) - Number(a.row.used) ||
				(q ? a.row.handle.length - b.row.handle.length : b.row.updated.localeCompare(a.row.updated)) ||
				a.row.handle.localeCompare(b.row.handle)
		)
		.slice(0, limit)
		.map((entry) => entry.row);
}

/** TikTok's own account search, for a brand flock has not seen yet. */
export function tiktokSearchUrl(typed: string): string {
	return `https://www.tiktok.com/search/user?q=${encodeURIComponent(typed)}`;
}
