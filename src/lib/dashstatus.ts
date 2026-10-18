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

/** What the icon says in words, for its label. */
export const LEVEL_WORDS: Record<StatusLevel, string> = {
	ok: 'all good',
	half: 'a limit is half used',
	close: 'a limit is nearly used, or something needs a look',
	bad: 'an error, or a limit used up'
};
