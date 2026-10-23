// What flock spends of the YouTube Data API's daily units, and on what.
//
// The 10,000 units a day are the Google Cloud project's, shared by every
// channel, and pay for everything but the uploads themselves: since Google's
// change of 4 Dec 2025 videos.insert has its own bucket of 100 calls a day.
// Every call that reaches YouTube is charged here under the kind of work it
// was for, so the Dashboard can say what the day's units went on. Google's
// console stays the exact figure: a one-off `pnpm worker:stats` or
// `pnpm worker:auth` in another process is not in this count.

/** The kinds of work, in the order the Dashboard lists them. */
export const QUOTA_KINDS = ['stats', 'playlist', 'rename', 'move', 'release', 'delete', 'channel', 'other'];

let today = { day: '', units: 0, kinds: {}, uploads: 0 };
let restored = false;

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

/** Today's record, started afresh when the Pacific day has turned. */
function current() {
	const day = pacificDay();
	if (today.day !== day) today = { day, units: 0, kinds: {}, uploads: 0 };
	return today;
}

/** Counts units spent on a kind of work. An unknown kind counts as `other`. */
export function charge(kind, units) {
	const n = Number(units);
	if (!(n > 0)) return;
	const record = current();
	const key = QUOTA_KINDS.includes(kind) ? kind : 'other';
	record.units += n;
	record.kinds[key] = (record.kinds[key] ?? 0) + n;
}

/** Counts one upload, which draws on its own bucket and not on the units. */
export function countUpload() {
	current().uploads += 1;
}

/** Units spent today, all kinds together. */
export function unitsToday() {
	return current().units;
}

/** Today's record as the heartbeat carries it. */
export function quotaToday() {
	const record = current();
	return { day: record.day, units: record.units, kinds: { ...record.kinds }, uploads: record.uploads };
}

/**
 * Takes up what an earlier run of the worker spent today, from the
 * heartbeat it wrote, so a restart does not start the day at zero. Only
 * once a process, and only for the same Pacific day; anything this run
 * spent before it is added on top.
 */
export function restoreQuota(saved) {
	if (restored) return;
	restored = true;
	const record = current();
	if (!saved || saved.day !== record.day) return;
	const units = Number(saved.units);
	if (Number.isFinite(units) && units > 0) record.units += units;
	for (const [kind, value] of Object.entries(saved.kinds ?? {})) {
		const n = Number(value);
		if (!(n > 0)) continue;
		const key = QUOTA_KINDS.includes(kind) ? kind : 'other';
		record.kinds[key] = (record.kinds[key] ?? 0) + n;
	}
	const uploads = Number(saved.uploads);
	if (Number.isFinite(uploads) && uploads > 0) record.uploads += uploads;
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
	today = { day: '', units: 0, kinds: {}, uploads: 0 };
	restored = false;
}
