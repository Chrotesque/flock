// What flock spends of the YouTube Data API's daily units, and on what.
//
// The 10,000 units a day are the Google Cloud project's, shared by every
// channel, and pay for everything but the uploads themselves: since Google's
// change of 4 Dec 2025 videos.insert has its own bucket of 100 calls a day.
// Every call that reaches YouTube is charged here under the kind of work it
// was for, so the Dashboard can say what the day's units went on. Google's
// console stays the exact figure: a one-off `pnpm worker:stats` or
// `pnpm worker:auth` in another process is not in this count.
//
// The edits (everything but the stats reads and the channel checks) are also
// kept one by one, as `events`, and a finished day is handed over for the
// history (stats.mjs writes it to `youtube_quota_history`).

/** The kinds of work, in the order the Dashboard lists them. */
export const QUOTA_KINDS = ['stats', 'playlist', 'rename', 'move', 'release', 'delete', 'channel', 'other'];

/** The kinds that run by themselves all day; every other kind is an edit, kept as an event. */
const BACKGROUND = ['stats', 'channel'];
// One edit is often several calls (a rename reads, then writes): calls of a
// kind this close together are one event.
const EVENT_MERGE_MS = 60_000;
// Edits kept a day; a day has had a few dozen at most.
const EVENTS_CAP = 200;
/** Days the history keeps. */
export const HISTORY_DAYS = 60;

const empty = (day) => ({ day, units: 0, kinds: {}, uploads: 0, events: [] });

let today = empty('');
let restored = false;
// Days that ended while this process ran, or that an earlier run left in
// the heartbeat, waiting to go into the history.
let finished = [];

/** Google's quota resets at midnight Pacific, whatever clock the worker runs on. */
export function pacificDay(at = new Date()) {
	return at.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/**
 * What one Data API call costs: every read 1 unit, every write (insert,
 * update, delete — of a video, a playlist item, a thumbnail) 50.
 */
export function unitCost(method = 'GET') {
	return String(method).toUpperCase() === 'GET' ? 1 : 50;
}

const spent = (record) => record.units > 0 || record.uploads > 0;

/** Today's record, started afresh when the Pacific day has turned; the day that ended goes to the history. */
function current(at = new Date()) {
	const day = pacificDay(at);
	if (today.day !== day) {
		if (today.day && spent(today)) finished.push(today);
		today = empty(day);
	}
	return today;
}

/** Counts units spent on a kind of work. An unknown kind counts as `other`. */
export function charge(kind, units, at = new Date()) {
	const n = Number(units);
	if (!(n > 0)) return;
	const record = current(at);
	const key = QUOTA_KINDS.includes(kind) ? kind : 'other';
	record.units += n;
	record.kinds[key] = (record.kinds[key] ?? 0) + n;
	if (BACKGROUND.includes(key)) return;
	const last = record.events[record.events.length - 1];
	if (last && last[1] === key && at.getTime() - Date.parse(last[0]) < EVENT_MERGE_MS) last[2] += n;
	else if (record.events.length < EVENTS_CAP) record.events.push([at.toISOString(), key, n]);
}

/** Counts one upload, which draws on its own bucket and not on the units. */
export function countUpload(at = new Date()) {
	current(at).uploads += 1;
}

/** Units spent today, all kinds together. */
export function unitsToday() {
	return current().units;
}

/** Today's record as the heartbeat carries it. */
export function quotaToday() {
	const record = current();
	return {
		day: record.day,
		units: record.units,
		kinds: { ...record.kinds },
		uploads: record.uploads,
		events: record.events.map((event) => [...event])
	};
}

/** A day's record as stored, field by field; null when it holds nothing. */
export function readRecord(saved) {
	if (!saved || typeof saved !== 'object' || typeof saved.day !== 'string' || !saved.day) return null;
	const record = empty(saved.day);
	const units = Number(saved.units);
	if (Number.isFinite(units) && units > 0) record.units = units;
	for (const [kind, value] of Object.entries(saved.kinds && typeof saved.kinds === 'object' ? saved.kinds : {})) {
		const n = Number(value);
		if (!(n > 0)) continue;
		const key = QUOTA_KINDS.includes(kind) ? kind : 'other';
		record.kinds[key] = (record.kinds[key] ?? 0) + n;
	}
	const uploads = Number(saved.uploads);
	if (Number.isFinite(uploads) && uploads > 0) record.uploads = uploads;
	for (const event of Array.isArray(saved.events) ? saved.events : []) {
		if (!Array.isArray(event) || !Number.isFinite(Date.parse(event[0])) || !(Number(event[2]) > 0)) continue;
		const key = QUOTA_KINDS.includes(event[1]) ? event[1] : 'other';
		if (record.events.length < EVENTS_CAP) record.events.push([String(event[0]), key, Number(event[2])]);
	}
	return spent(record) ? record : null;
}

/**
 * Takes up what an earlier run of the worker spent, from the heartbeat it
 * wrote, so a restart does not start the day at zero. Only once a process;
 * anything this run spent before it is added on top. A record of an earlier
 * day — the worker was off when the day turned — goes to the history.
 */
export function restoreQuota(saved) {
	if (restored) return;
	restored = true;
	const record = current();
	const old = readRecord(saved);
	if (!old) return;
	if (old.day !== record.day) {
		finished.push(old);
		return;
	}
	record.units += old.units;
	for (const [kind, n] of Object.entries(old.kinds)) record.kinds[kind] = (record.kinds[kind] ?? 0) + n;
	record.uploads += old.uploads;
	record.events = [...old.events, ...record.events]
		.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
		.slice(0, EVENTS_CAP);
}

/** The finished days not yet in the history; handed over once. */
export function takeFinishedDays() {
	current();
	const days = finished;
	finished = [];
	return days;
}

/** Puts days back that could not be written, to be tried with the next. */
export function returnFinishedDays(days) {
	finished = [...days, ...finished];
}

/**
 * The history with finished days added: `{ days: { 'YYYY-MM-DD': record } }`,
 * the newest `keep` days. A day already there is replaced by the record with
 * more units (the same day handed over twice, by a run and its restart).
 */
export function mergeHistory(stored, days, keep = HISTORY_DAYS) {
	const out = {};
	const before = stored && typeof stored === 'object' && stored.days && typeof stored.days === 'object' ? stored.days : {};
	for (const [day, value] of Object.entries(before)) {
		const record = readRecord({ ...value, day });
		if (record) out[day] = record;
	}
	for (const day of days) {
		const record = readRecord(day);
		if (!record) continue;
		const known = out[record.day];
		if (!known || record.units >= known.units) out[record.day] = record;
	}
	const kept = Object.keys(out).sort().slice(-keep);
	return { days: Object.fromEntries(kept.map((day) => [day, strip(out[day])])) };
}

/** A record as the history stores it: the day is its key. */
function strip(record) {
	const { day: _day, ...rest } = record;
	return rest;
}

/**
 * Whether the stats pass may read: the automatic reads stop once the day's
 * units, all kinds together, reach `budget`, and a Refresh pressed on the
 * Dashboard once they reach `ceiling`; what is left above that is kept for
 * playlist adds, renames and Calendar edits. A pass costs a unit or two,
 * hence the margin. 0 is no limit. `read`, `stopped` (automatic reads only)
 * or `ceiling`.
 */
export function statsMayRead({ units, budget, ceiling, manual = false }) {
	const limit = manual ? ceiling : budget;
	if (limit > 0 && units + 2 > limit) return manual ? 'ceiling' : 'stopped';
	return 'read';
}

/** For the tests: forget everything, as a fresh process would. */
export function resetQuota() {
	today = empty('');
	restored = false;
	finished = [];
}
