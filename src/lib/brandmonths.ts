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
 *
 * The month still running is shown too, on top (`part`): its counts so far
 * and the days they cover, judged by what they come to over the whole month
 * at that pace (`paceOf`) — so 21 days of 31 are not read as a bad month.
 */

/** [views, likes, comments] */
export type MonthCounts = [number, number, number];
export const MONTH_METRICS = ['views', 'likes', 'comments'] as const;
export type MonthMetric = (typeof MONTH_METRICS)[number];

/** A month still running: its counts so far, and how many of its days they cover (perhaps a fraction). */
export interface MonthPart {
	month: string;
	counts: MonthCounts;
	days: number;
}

/** One platform's whole months, 'YYYY-MM' → counts, and the month still running. */
export interface PlatformMonths {
	platform: StatPlatform;
	months: Record<string, MonthCounts>;
	part?: MonthPart | null;
}

/** A year shown, and the month before its first to compare that with. */
export const MONTHS_SHOWN = 12;

/** Less of a month than this says too little to scale up to all of it. */
export const MIN_PART_DAYS = 1;

const DAY = 86_400_000;
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

/** Months since year 0, so two months' distance is a subtraction. */
export function monthIndex(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return y * 12 + m - 1;
}

// Three letters each: the browser's own short names have "Sept".
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026", or with `long` "October 2026". */
export function monthName(month: string, style: 'short' | 'long' = 'short'): string {
	if (!month) return '';
	const [y, m] = month.split('-').map(Number);
	if (style === 'short') return `${SHORT_MONTHS[m - 1]} ${y}`;
	return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function daysIn(month: string): number {
	return Math.round((monthStart(nextMonth(month)) - monthStart(month)) / DAY);
}

/** What a running month's counts come to over all of it, at the pace of the days covered. */
export function paceOf(part: MonthPart): MonthCounts {
	const scale = daysIn(part.month) / part.days;
	return part.counts.map((n) => Math.round(n * scale)) as MonthCounts;
}

/**
 * The worker's running month (`{ month, counts, through }`, through = the last
 * day covered, 'YYYY-MM-DD' — worker/monthly.mjs) as a part; null when it is
 * not one, covers too little, or is a month already over.
 */
export function storedPart(raw: unknown): MonthPart | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const month = typeof r.month === 'string' && /^\d{4}-\d{2}$/.test(r.month) ? r.month : '';
	const through = typeof r.through === 'string' ? r.through : '';
	const counts = Array.isArray(r.counts) && r.counts.length === 3 && r.counts.every((n) => typeof n === 'number') ? r.counts : null;
	if (!month || !counts || !through.startsWith(`${month}-`)) return null;
	const days = Number(through.slice(8, 10));
	if (!(days >= MIN_PART_DAYS) || days >= daysIn(month)) return null;
	return { month, counts: [counts[0], counts[1], counts[2]], days };
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
	const histories = readHistories(rows);
	let first = Infinity;
	for (const { history } of histories) for (const s of history) first = Math.min(first, time(s[0]));
	if (!Number.isFinite(first)) return {};

	const out: Record<string, MonthCounts> = {};
	let month = first === monthStart(monthKey(first)) ? monthKey(first) : nextMonth(monthKey(first));
	for (; monthStart(nextMonth(month)) <= now; month = nextMonth(month)) {
		out[month] = gained(histories, monthStart(month), monthStart(nextMonth(month)) - 1);
	}
	return Object.fromEntries(Object.entries(out).slice(-count));
}

/**
 * The month `until` falls in (the account's last read), from flock's own
 * reads, when flock was reading the account from its first moment: what its
 * posts gained from then to `until`, and the days that covers. Null when
 * flock began reading during the month, or too little of it has passed.
 */
export function partFromReads(rows: ReadRow[], until: number): MonthPart | null {
	const histories = readHistories(rows);
	const { first } = readSince(rows);
	const month = monthKey(until);
	const start = monthStart(month);
	const days = (until - start) / DAY;
	if (first === null || first > start || days < MIN_PART_DAYS) return null;
	return { month, counts: gained(histories, start, until), days };
}

interface ReadHistory {
	at: number;
	history: Sample[];
}

function readHistories(rows: ReadRow[]): ReadHistory[] {
	return rows.map((row) => ({
		at: time(row.published_at),
		history: (Array.isArray(row.history) ? row.history : []).filter((s) => Number.isFinite(time(s?.[0])))
	}));
}

/**
 * What the posts gained from `start` to `end`: each post's counts at the end
 * less those at the start (nothing for a post out after the end; from 0 for
 * one out after the start; from its first sample for one flock began reading
 * in between), never below nothing.
 */
function gained(histories: ReadHistory[], start: number, end: number): MonthCounts {
	const total: MonthCounts = [0, 0, 0];
	for (const { at, history } of histories) {
		const atEnd = countsAt(history, end) ?? (at > end ? [0, 0, 0] : null);
		if (!atEnd) continue;
		const atStart = countsAt(history, start) ?? (at >= start || history.length === 0 ? [0, 0, 0] : firstCounts(history));
		for (let i = 0; i < 3; i++) total[i] += atEnd[i] - atStart[i];
	}
	return total.map((n) => Math.max(0, n)) as MonthCounts;
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
	/** The month's count: so far, for a month still running. */
	value: number;
	/** What it comes to over the whole month: the count, or a running month's at its pace. */
	pace: number;
	/** The days a running month's count covers; null for a whole month. */
	days: number | null;
	/** The month before's, when the platform has it whole too. */
	previous: number | null;
	ratio: number | null;
	verdict: Verdict | null;
}

export interface MetricCell {
	/** The month's count over every platform that has it: so far, for a month still running. */
	value: number;
	/** The same at the pace of the days covered: equal to `value` for a whole month. */
	pace: number;
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
	/** For a month still running, the platforms whose count is so far and the days each covers; empty for a whole month. */
	running: { platform: StatPlatform; days: number }[];
	cells: Record<MonthMetric, MetricCell>;
}

/** A platform's counts for a month: whole, or so far with the days covered; null without either. */
function countsFor(source: PlatformMonths, month: string): { counts: MonthCounts; pace: MonthCounts; days: number | null } | null {
	const counts = source.months[month];
	if (counts) return { counts, pace: counts, days: null };
	const part = source.part;
	if (part && part.month === month && part.days >= MIN_PART_DAYS) return { counts: part.counts, pace: paceOf(part), days: part.days };
	return null;
}

/**
 * The brand's months, newest first: every month at least one platform has
 * whole (`limit` of them at most) and above them any month still running,
 * each metric's count over the platforms that have it and its change from
 * the calendar month before, over those that have both — a running month by
 * its pace, so the days still to come are not counted against it.
 */
export function brandMonths(sources: PlatformMonths[], limit = MONTHS_SHOWN): MonthRow[] {
	const running = new Set(sources.flatMap((s) => (s.part && !s.months[s.part.month] && s.part.days >= MIN_PART_DAYS ? [s.part.month] : [])));
	const all = [...new Set([...sources.flatMap((s) => Object.keys(s.months)), ...running])].sort().reverse();
	const months = [...all.filter((m) => running.has(m)), ...all.filter((m) => !running.has(m)).slice(0, limit)].sort().reverse();
	return months.map((month) => {
		const before = prevMonth(month);
		const having = sources.flatMap((s) => {
			const got = countsFor(s, month);
			return got ? [{ source: s, ...got }] : [];
		});
		const cells = Object.fromEntries(
			MONTH_METRICS.map((metric, i) => {
				const parts: PlatformCell[] = having.map(({ source, counts, pace, days }) => {
					const previous = source.months[before]?.[i] ?? null;
					return {
						platform: source.platform,
						value: counts[i],
						pace: pace[i],
						days,
						previous,
						ratio: previous ? pace[i] / previous : null,
						verdict: verdictOf(pace[i], previous)
					};
				});
				const both = parts.filter((p) => p.previous !== null);
				const compared = both.reduce((sum, p) => sum + p.pace, 0);
				const previous = both.length > 0 ? both.reduce((sum, p) => sum + (p.previous ?? 0), 0) : null;
				return [
					metric,
					{
						value: parts.reduce((sum, p) => sum + p.value, 0),
						pace: parts.reduce((sum, p) => sum + p.pace, 0),
						compared,
						previous,
						ratio: previous ? compared / previous : null,
						verdict: verdictOf(compared, previous),
						parts
					}
				];
			})
		) as Record<MonthMetric, MetricCell>;
		return {
			month,
			platforms: having.map((h) => h.source.platform),
			running: having.flatMap((h) => (h.days === null ? [] : [{ platform: h.source.platform, days: h.days }])),
			cells
		};
	});
}

/** A running month's days in words: "21 of 31 days", or "21–24 of 31 days" when the platforms cover different stretches. */
export function runningWords(row: MonthRow): string {
	if (row.running.length === 0) return '';
	const days = row.running.map((r) => Math.floor(r.days));
	const lo = Math.min(...days);
	const hi = Math.max(...days);
	return `${lo === hi ? lo : `${lo}–${hi}`} of ${daysIn(row.month)} days`;
}
