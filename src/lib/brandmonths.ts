import { verdictOf, type Sample, type StatPlatform, type Verdict } from './releases';

/**
 * A brand's month over month, for the Dashboard's brand panel (opened from a
 * brand button's right-click): its views, likes and comments in each whole
 * calendar month, against the month before, with the same verdicts as
 * "vs usual" — a fifth up or down is ahead or behind.
 *
 * Only whole months: YouTube's and Instagram's are the platforms' own (YouTube
 * Analytics, Instagram's account insights — worker/monthly.mjs), which have
 * every day of every month the account was active; Facebook's and TikTok's
 * are worked out from flock's own reads of their posts (monthsFromReads) and
 * count only once flock was reading the account for all of a month. Months
 * are UTC calendar months (YouTube's days are Pacific; close enough).
 */

/** [views, likes, comments] */
export type MonthCounts = [number, number, number];
export const MONTH_METRICS = ['views', 'likes', 'comments'] as const;
export type MonthMetric = (typeof MONTH_METRICS)[number];

/** One platform's whole months, 'YYYY-MM' → counts. */
export interface PlatformMonths {
	platform: StatPlatform;
	months: Record<string, MonthCounts>;
}

/** A year shown, and the month before its first to compare that with. */
export const MONTHS_SHOWN = 12;

const time = (iso: unknown) => Date.parse(String(iso ?? '').replace(' ', 'T'));

export function monthKey(t: number): string {
	return new Date(t).toISOString().slice(0, 7);
}

export function monthStart(month: string): number {
	return Date.parse(`${month}-01T00:00:00Z`);
}

export function nextMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const countsOf = (s: Sample): MonthCounts => [s[1] ?? 0, s[2] ?? 0, s[3] ?? 0];

/** A post's counters at a moment: its last sample at or before it; null before its first. */
function countsAt(history: Sample[], t: number): MonthCounts | null {
	let found: Sample | null = null;
	for (const s of history) if (time(s[0]) <= t && (!found || time(s[0]) >= time(found[0]))) found = s;
	return found ? countsOf(found) : null;
}

/** A post's counters when flock first read them. */
function firstCounts(history: Sample[]): MonthCounts {
	let found = history[0];
	for (const s of history) if (time(s[0]) < time(found[0])) found = s;
	return countsOf(found);
}

export interface ReadRow {
	published_at: string;
	history: Sample[] | null | undefined;
}

/**
 * Whole months from flock's own reads of one account's posts: each calendar
 * month that is over by `now` and that flock was reading the account for all
 * of (a sample of one of its posts at or before the month's first moment),
 * with the counters its posts gained in it added up — each post's counts at
 * the month's end less those at its start (nothing for a post out after the
 * start; from its first sample for one flock began reading during the month).
 * The newest `count` months.
 */
export function monthsFromReads(rows: ReadRow[], now: number, count = MONTHS_SHOWN + 1): Record<string, MonthCounts> {
	const histories = rows.map((row) => ({
		at: time(row.published_at),
		history: (Array.isArray(row.history) ? row.history : []).filter((s) => Number.isFinite(time(s?.[0])))
	}));
	let first = Infinity;
	for (const { history } of histories) for (const s of history) first = Math.min(first, time(s[0]));
	if (!Number.isFinite(first)) return {};

	const out: Record<string, MonthCounts> = {};
	let month = first === monthStart(monthKey(first)) ? monthKey(first) : nextMonth(monthKey(first));
	for (; monthStart(nextMonth(month)) <= now; month = nextMonth(month)) {
		const start = monthStart(month);
		const end = monthStart(nextMonth(month)) - 1;
		const total: MonthCounts = [0, 0, 0];
		for (const { at, history } of histories) {
			const atEnd = countsAt(history, end) ?? (at > end ? [0, 0, 0] : null);
			if (!atEnd) continue;
			const atStart = countsAt(history, start) ?? (at >= start || history.length === 0 ? [0, 0, 0] : firstCounts(history));
			for (let i = 0; i < 3; i++) total[i] += atEnd[i] - atStart[i];
		}
		out[month] = total.map((n) => Math.max(0, n)) as MonthCounts;
	}
	return Object.fromEntries(Object.entries(out).slice(-count));
}

/** When flock first read any of these posts, and the first month it then has whole; nulls with no reads. */
export function readSince(rows: ReadRow[]): { first: number | null; firstWhole: string | null } {
	let first = Infinity;
	for (const row of rows) for (const s of Array.isArray(row.history) ? row.history : []) first = Math.min(first, time(s?.[0]));
	if (!Number.isFinite(first)) return { first: null, firstWhole: null };
	return { first, firstWhole: first === monthStart(monthKey(first)) ? monthKey(first) : nextMonth(monthKey(first)) };
}

export interface PlatformCell {
	platform: StatPlatform;
	value: number;
	/** The month before's, when the platform has it whole too. */
	previous: number | null;
	ratio: number | null;
	verdict: Verdict | null;
}

export interface MetricCell {
	/** The month's count over every platform that has it. */
	value: number;
	/** The comparison, over the platforms that have both months: so a platform joining is no growth. */
	compared: number;
	previous: number | null;
	ratio: number | null;
	verdict: Verdict | null;
	parts: PlatformCell[];
}

export interface MonthRow {
	month: string;
	/** The platforms it is over, in the sources' order. */
	platforms: StatPlatform[];
	cells: Record<MonthMetric, MetricCell>;
}

/**
 * The brand's months, newest first, `limit` at most: every month at least one
 * platform has whole, each metric's count over the platforms that have it and
 * its change from the calendar month before, over those that have both.
 */
export function brandMonths(sources: PlatformMonths[], limit = MONTHS_SHOWN): MonthRow[] {
	const months = [...new Set(sources.flatMap((s) => Object.keys(s.months)))].sort().reverse().slice(0, limit);
	return months.map((month) => {
		const before = prevMonth(month);
		const having = sources.filter((s) => s.months[month]);
		const cells = Object.fromEntries(
			MONTH_METRICS.map((metric, i) => {
				const parts: PlatformCell[] = having.map((s) => {
					const value = s.months[month][i];
					const previous = s.months[before]?.[i] ?? null;
					return {
						platform: s.platform,
						value,
						previous,
						ratio: previous ? value / previous : null,
						verdict: verdictOf(value, previous)
					};
				});
				const both = parts.filter((p) => p.previous !== null);
				const compared = both.reduce((sum, p) => sum + p.value, 0);
				const previous = both.length > 0 ? both.reduce((sum, p) => sum + (p.previous ?? 0), 0) : null;
				return [
					metric,
					{
						value: parts.reduce((sum, p) => sum + p.value, 0),
						compared,
						previous,
						ratio: previous ? compared / previous : null,
						verdict: verdictOf(compared, previous),
						parts
					}
				];
			})
		) as Record<MonthMetric, MetricCell>;
		return { month, platforms: having.map((s) => s.platform), cells };
	});
}
