/**
 * The Dashboard's status icon: one colour for how each platform's read
 * stands, and the worst of them for the icon itself.
 *
 * - `ok` (green): nothing to think about.
 * - `half` (yellow): a limit is half used.
 * - `close` (orange): a limit is nearly used, or something works only in
 *   part (Facebook's views not read).
 * - `bad` (red): an error, or a limit used up.
 */
export type StatusLevel = 'ok' | 'half' | 'close' | 'bad';

const ORDER: StatusLevel[] = ['ok', 'half', 'close', 'bad'];

/** From this share of a limit it reads as half used. */
export const HALF_SHARE = 0.5;
/** From this share of a limit it reads as nearly used. */
export const CLOSE_SHARE = 0.8;

/** A limit's level: half from 50 %, close from 80 %, bad once used up. */
export function limitLevel(used: number, total: number): StatusLevel {
	if (!(total > 0) || !Number.isFinite(used)) return 'ok';
	const share = used / total;
	if (share >= 1) return 'bad';
	if (share >= CLOSE_SHARE) return 'close';
	if (share >= HALF_SHARE) return 'half';
	return 'ok';
}

/** The worse of the levels given; `ok` for none. */
export function worstLevel(levels: StatusLevel[]): StatusLevel {
	let worst = 0;
	for (const level of levels) worst = Math.max(worst, ORDER.indexOf(level));
	return ORDER[worst];
}

/** One platform's line: an error wins, then its limit, and a partial read is at least `close`. */
export function lineLevel(line: { error?: string | null; used?: number; total?: number; partial?: boolean }): StatusLevel {
	if (line.error) return 'bad';
	const limit = typeof line.used === 'number' && typeof line.total === 'number' ? limitLevel(line.used, line.total) : 'ok';
	return line.partial ? worstLevel([limit, 'close']) : limit;
}

// The worker's wording for a refused API call: "YouTube GET /playlistItems ->
// 500: {…}" (stats.mjs, the body cut at 300 characters) or with a newline
// before the body (youtube.mjs).
const HTTP_ERROR = /^(\S+) (GET|POST|PUT|PATCH|DELETE) (\S+) -> (\d{3})(?::\s*|\s+)?([\s\S]*)$/;

/** The message an API's error body carries, from JSON — or, cut short, from its first "message". */
function bodyMessage(body: string): string {
	try {
		const json = JSON.parse(body);
		const message = json?.error?.message ?? json?.error_description ?? json?.message;
		if (typeof message === 'string') return message.trim();
	} catch {
		// cut short: fall through to the pattern
	}
	const found = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
	return found ? found[1].replace(/\\(.)/g, '$1').trim() : '';
}

/**
 * An error as one short line for the status popup: a refused API call as
 * "Error 500 on /playlistItems: Internal error encountered." (the line
 * already names its platform), anything else as its first line, without
 * Meta's trace id.
 */
export function shortError(text: string | null | undefined): string {
	const raw = String(text ?? '').trim();
	if (!raw) return '';
	const http = HTTP_ERROR.exec(raw);
	if (http) {
		const [, , , path, status, body] = http;
		const message = bodyMessage(body);
		return `Error ${status} on ${path.split('?')[0]}${message ? `: ${message}` : ''}`;
	}
	const first = raw.split('\n').find((line) => line.trim()) ?? raw;
	return first.replace(/\s*\(trace [^)]*\)/g, '').trim();
}

/** What the icon says in words, for its label. */
export const LEVEL_WORDS: Record<StatusLevel, string> = {
	ok: 'all good',
	half: 'a limit is half used',
	close: 'a limit is nearly used, or something needs a look',
	bad: 'an error, or a limit used up'
};
