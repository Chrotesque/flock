/**
 * The YouTube Data API's daily units as the Dashboard shows them: what flock
 * spent today, all brands together, and on what (the worker's quota.mjs counts
 * it into the `stats_status` heartbeat).
 *
 * The 10,000 units are the Google Cloud project's, shared by every channel,
 * and since Google's change of 4 Dec 2025 they no longer pay for uploads —
 * videos.insert has its own bucket of 100 a day. The automatic stats reads
 * stop at the budget (8,000), a Refresh still reads until the ceiling (9,000),
 * and the last 1,000 are left for playlist adds, renames and Calendar edits.
 */
import type { StatsStatus } from './types';

/** Google's daily units for the project. */
export const GOOGLE_UNITS = 10_000;
/** Uploads a day, a bucket of their own. */
export const UPLOADS_A_DAY = 100;
/** Stopped automatic reads this old turn the Refresh button red. */
export const REFRESH_STALE_MS = 5 * 60_000;

/** What each kind of work costs, in the worker's order (QUOTA_KINDS). */
export const KINDS: { kind: string; label: string; cost: string }[] = [
	{ kind: 'stats', label: 'Reading the stats', cost: '1 unit a read' },
	{ kind: 'playlist', label: 'Adding a video to a playlist', cost: '50 units' },
	{ kind: 'rename', label: 'Renaming a video', cost: '51 units' },
	{ kind: 'edit', label: 'Editing a queued video', cost: '51 units' },
	{ kind: 'move', label: 'Calendar move', cost: '51 units' },
	{ kind: 'release', label: 'Releasing now', cost: '51 units' },
	{ kind: 'delete', label: 'Deleting a video', cost: '50 units' },
	{ kind: 'channel', label: 'Checking the channels', cost: '1 unit a read' },
	{ kind: 'other', label: 'Other', cost: '' }
];

export interface QuotaRow {
	kind: string;
	label: string;
	cost: string;
	/** Units spent on it today. */
	units: number;
}

export interface QuotaToday {
	/** Units spent today, every kind together. */
	units: number;
	/** Each kind of work, `other` only when something was spent on it. */
	rows: QuotaRow[];
	/** Uploads today, from their own bucket; null when the worker does not count them yet. */
	uploads: number | null;
	/** The automatic reads' stop and the ceiling the bar is drawn against. */
	budget: number;
	ceiling: number;
}

/** The Pacific day an instant falls on, as the worker names it: Google's quota day. */
export function pacificDay(at: number): string {
	return new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Milliseconds Pacific wall time is ahead of UTC at an instant (negative). */
function pacificOffset(at: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Los_Angeles',
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(new Date(at));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return wall - Math.floor(at / 1000) * 1000;
}

/** The next midnight Pacific after an instant: when Google's quota resets. */
export function nextPacificMidnight(at: number): number {
	const offset = pacificOffset(at);
	const wall = new Date(at + offset);
	const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
	// On the night the clocks change, the offset at midnight is not the one now.
	const after = pacificOffset(midnight - offset);
	return midnight - after;
}

/**
 * Today's spend from the heartbeat. A record from an earlier Pacific day (the
 * worker stopped before midnight) counts as nothing spent yet; a heartbeat
 * from before the worker counted every kind has only the stats' total.
 */
export function quotaToday(status: StatsStatus | null | undefined, now: number): QuotaToday | null {
	if (!status) return null;
	const budget = status.budget > 0 ? status.budget : 0;
	const ceiling = status.ceiling && status.ceiling > 0 ? status.ceiling : budget || GOOGLE_UNITS;
	const quota = status.quota;
	const current = quota ? quota.day === pacificDay(now) : true;
	const units = !current ? 0 : quota ? Number(quota.units) || 0 : Number(status.unitsToday) || 0;
	const kinds: Record<string, number> = !current ? {} : quota ? (quota.kinds ?? {}) : { stats: units };
	const rows = KINDS.map(({ kind, label, cost }) => ({ kind, label, cost, units: Number(kinds[kind]) || 0 })).filter(
		(row) => row.kind !== 'other' || row.units > 0
	);
	const uploads = quota ? (current ? Number(quota.uploads) || 0 : 0) : null;
	return { units, rows, uploads, budget, ceiling };
}

/** Which stop holds today, if any: the worker's word, unless it was said on an earlier day. */
export function stopToday(status: StatsStatus | null | undefined, now: number): '' | 'auto' | 'ceiling' | 'exhausted' {
	if (!status?.stopped || !status.quota || status.quota.day !== pacificDay(now)) return '';
	return status.stopped;
}

/**
 * Whether the Refresh button turns red: the automatic reads have stopped
 * for the day, the numbers are five minutes old, and Refresh was not pressed
 * in those five minutes. Past the ceiling a press would read nothing, so it
 * stays grey.
 */
export function refreshDue(status: StatsStatus | null | undefined, now: number, pressedAt = 0): boolean {
	if (stopToday(status, now) !== 'auto') return false;
	const read = Date.parse(String(status?.polledAt ?? ''));
	const last = Math.max(Number.isFinite(read) ? read : 0, pressedAt);
	return now - last >= REFRESH_STALE_MS;
}

/** What the status popup says of a stop, with when it lifts in the viewer's own time. */
export function stopWords(stop: ReturnType<typeof stopToday>, quota: QuotaToday, now: number): string {
	if (!stop) return '';
	const at = new Date(nextPacificMidnight(now)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const resumes = `Resumes at midnight Pacific (${at} here).`;
	const n = (v: number) => v.toLocaleString();
	if (stop === 'auto') {
		return `Automatic reads stopped at ${n(quota.budget)} units; Refresh still reads until ${n(quota.ceiling)}. ${resumes}`;
	}
	if (stop === 'ceiling') {
		return `Reads stopped at ${n(quota.ceiling)} units; the rest is kept for playlist adds, renames and Calendar edits. ${resumes}`;
	}
	return `YouTube says today's quota is used up. ${resumes}`;
}

/* ---- How often the stats are read, and what a day costs at that pace ----
 * For Settings → DevTest → YouTube, which sets the worker's pace
 * (`app_settings` / `stats_pace`, worker/stats.mjs `refreshPace`). */

// As worker/stats.mjs reads: a channel's newest videos are listed again
// 5 minutes after the last listing, its subscribers read after 10 and its
// playlists after 30 — each at that channel's first read past it — and every
// channel is checked every 30 minutes (worker/youtube.mjs). Keep with them.
const LIST_SECONDS = 300;
const SUBSCRIBERS_SECONDS = 600;
const PLAYLISTS_SECONDS = 1800;
const CHECK_SECONDS = 1800;

/** The paces offered, seconds between two reads (each of one channel, in turn). */
export const PACE_STEPS = [5, 10, 15, 20, 25, 30, 40, 45, 60, 90, 120, 180, 240, 300, 450, 600, 900, 1200, 1800, 3600];
/** The worker takes 5 to 3600 seconds (stats.mjs `readPace`). */
export const PACE_MIN_SECONDS = 5;
export const PACE_MAX_SECONDS = 3600;
/** What a day's edits are taken to cost until the history has shown more. */
export const EDIT_FLOOR = 500;
/** The kinds that run by themselves all day; every other kind is an edit. */
export const BACKGROUND_KINDS = ['stats', 'channel'];

export interface PaceProjection {
	seconds: number;
	channels: number;
	/** Seconds between two reads of the same channel. */
	channelEvery: number;
	/** The stats reads' units an hour, and a day. */
	perHour: number;
	stats: number;
	/** The channel checks' units a day. */
	checks: number;
}

/**
 * What the stats reads cost at a pace: one videos.list a read, plus each
 * channel's listing, subscribers and playlists as often as their timers let
 * them come round. At 30 s and three channels that is 173 an hour — what
 * 23 Oct 2026 measured.
 */
export function projectPace(seconds: number, channels: number): PaceProjection {
	const n = Math.max(1, Math.round(channels) || 1);
	const s = Math.min(PACE_MAX_SECONDS, Math.max(PACE_MIN_SECONDS, Math.round(seconds) || PACE_MIN_SECONDS));
	const every = s * n;
	const perChannel = (ttl: number) => 3600 / (Math.ceil(ttl / every) * every);
	const perHour = 3600 / s + n * (perChannel(LIST_SECONDS) + perChannel(SUBSCRIBERS_SECONDS) + perChannel(PLAYLISTS_SECONDS));
	return {
		seconds: s,
		channels: n,
		channelEvery: every,
		perHour,
		stats: Math.round(perHour * 24),
		checks: Math.round((n * 86_400) / CHECK_SECONDS)
	};
}

export interface PaceVerdict {
	/** A day at this pace: the reads, the checks and the edits together. */
	total: number;
	/** How far under the automatic stop that stays; negative when over. */
	headroom: number;
	ok: boolean;
	/** Over the stop: about how many hours into the day the reads would stop. */
	stopsAfter: number | null;
}

/**
 * Whether a pace keeps the stats read all day: its reads and checks plus
 * the day's edits must stay under the automatic stop (the stats budget).
 * Past it the numbers would stand still until midnight Pacific — the stops
 * themselves keep the last 1,000 units for edits whatever the pace.
 */
export function paceVerdict(p: PaceProjection, edits: number, budget: number): PaceVerdict {
	const total = p.stats + p.checks + edits;
	const headroom = budget - total;
	const ok = !(budget > 0) || headroom >= 0;
	return { total, headroom, ok, stopsAfter: ok ? null : (budget * 24) / total };
}

/** The fastest pace offered that stays under the stop. */
export function fastestSafePace(channels: number, edits: number, budget: number): number {
	return PACE_STEPS.find((s) => paceVerdict(projectPace(s, channels), edits, budget).ok) ?? PACE_MAX_SECONDS;
}

/** "45 s", "1 min 30 s", "2 h" — a pace or a channel's interval in words. */
export function secondsWords(seconds: number): string {
	const s = Math.round(seconds);
	if (s < 60) return `${s} s`;
	if (s < 3600) {
		const m = Math.floor(s / 60);
		const rest = s % 60;
		return rest ? `${m} min ${rest} s` : `${m} min`;
	}
	const h = Math.floor(s / 3600);
	const m = Math.round((s % 3600) / 60);
	return m ? `${h} h ${m} min` : `${h} h`;
}

/** A finished day of the spend, as the worker keeps it (`youtube_quota_history`). */
export interface QuotaDay {
	day: string;
	units: number;
	kinds: Record<string, number>;
	uploads: number;
	/** The edits: [when, kind, units]. */
	events: [string, string, number][];
}

/** The history, field by field, newest day first. */
export function readQuotaHistory(value: unknown): QuotaDay[] {
	const days = (value as { days?: unknown } | null)?.days;
	if (!days || typeof days !== 'object') return [];
	const out: QuotaDay[] = [];
	for (const [day, raw] of Object.entries(days as Record<string, unknown>)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const kinds: Record<string, number> = {};
		for (const [kind, n] of Object.entries((r.kinds as Record<string, unknown>) ?? {})) {
			if (Number(n) > 0) kinds[kind] = Number(n);
		}
		const events = (Array.isArray(r.events) ? r.events : []).filter(
			(e): e is [string, string, number] =>
				Array.isArray(e) && Number.isFinite(Date.parse(String(e[0]))) && typeof e[1] === 'string' && Number(e[2]) > 0
		);
		out.push({ day, units: Number(r.units) > 0 ? Number(r.units) : 0, kinds, uploads: Number(r.uploads) > 0 ? Number(r.uploads) : 0, events });
	}
	return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** A day's units on edits: everything but the reads and the checks. */
export function editUnits(kinds: Record<string, number>): number {
	return Object.entries(kinds)
		.filter(([kind]) => !BACKGROUND_KINDS.includes(kind))
		.reduce((sum, [, n]) => sum + (Number(n) || 0), 0);
}

/** What to count on for a day's edits: the most a day has taken, and never under EDIT_FLOOR. */
export function editReserve(days: QuotaDay[], today = 0): number {
	return Math.max(EDIT_FLOOR, today, ...days.map((d) => editUnits(d.kinds)));
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export interface KindSummary {
	kind: string;
	label: string;
	cost: string;
	today: number;
	/** The middle of the finished days, and the most one of them took. */
	typical: number;
	most: number;
}

/**
 * Each kind of work: today, a typical day (the median of the finished days,
 * days that had none counting as 0) and the most a day took. `other` only
 * when something went on it.
 */
export function kindSummaries(todayKinds: Record<string, number>, days: QuotaDay[]): KindSummary[] {
	return KINDS.map(({ kind, label, cost }) => {
		const each = days.map((d) => d.kinds[kind] ?? 0);
		return { kind, label, cost, today: todayKinds[kind] ?? 0, typical: median(each), most: Math.max(0, ...each) };
	}).filter((row) => row.kind !== 'other' || row.today > 0 || row.most > 0);
}

/** About what today will have spent by midnight Pacific: so far, plus the rest of the day at the pace. */
export function onCourseFor(unitsSoFar: number, p: PaceProjection, now: number): number {
	const hoursLeft = Math.max(0, (nextPacificMidnight(now) - now) / 3_600_000);
	return Math.round(unitsSoFar + hoursLeft * (p.perHour + p.checks / 24));
}
