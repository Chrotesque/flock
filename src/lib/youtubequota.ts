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
const KINDS: { kind: string; label: string; cost: string }[] = [
	{ kind: 'stats', label: 'Reading the stats', cost: '1 unit a read' },
	{ kind: 'playlist', label: 'Adding a video to a playlist', cost: '50 units' },
	{ kind: 'rename', label: 'Renaming a video', cost: '51 units' },
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
