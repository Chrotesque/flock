// An account's views, likes and comments per whole calendar month, the
// platform's own figures, for the Dashboard's brand panel (src/lib/brandmonths.ts).
// YouTube's come with the channel's day report in ytanalytics.mjs; Instagram's
// from its account insights here, once a day. Both are kept in the account's
// follower row (`followers:<platform>:<id>`, followers.mjs) as `monthly` =
// { 'YYYY-MM': [views, likes, comments] }, every whole month there is — the
// panel's Lifetime: YouTube's day report has the channel's whole life, and
// Instagram's last MONTHS_KEPT months are read again while older ones are
// kept as stored. A month still running, or one the account was not yet
// active for all of, is left out, so every month stored is a full one. The month still
// running is kept beside them as `monthPart` = { month, counts, through } —
// its counts so far and the last day they cover — which the panel scales up
// to the whole month.

import { explain, graph } from './instagram.mjs';
import { readState, settingKey } from './followers.mjs';

/** Instagram's months read again each day: a year, and the one before the first, to compare it with. */
export const MONTHS_KEPT = 13;
/** Instagram's insights may come in up to two days late: a month is read once it is that long over. */
const INSTAGRAM_LAG_MS = 2 * 86_400_000;
/** Instagram's monthly figures barely move once in: once a day is plenty. */
const INSTAGRAM_TTL_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM' of a day ('YYYY-MM-DD') or a time. */
export function monthOf(day) {
	return typeof day === 'number' ? new Date(day).toISOString().slice(0, 7) : String(day).slice(0, 7);
}

/** The first day of the month after `month`, 'YYYY-MM-DD'. */
function nextMonthStart(month) {
	const [y, m] = month.split('-').map(Number);
	return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** The last day of a month, 'YYYY-MM-DD'. */
export function lastDayOf(month) {
	return new Date(Date.parse(`${nextMonthStart(month)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * A channel's whole months from its day report (rows with `day`, `views`,
 * `likes`, `comments`): only months YouTube has every day of (`through`, its
 * last day) and the channel was active for all of — from the first month
 * that starts on or after its first day with a view, like or comment.
 */
export function youtubeMonthly(dayRows, through) {
	const sorted = [...dayRows].sort((a, b) => String(a.day).localeCompare(String(b.day)));
	const first = sorted.find((row) => Number(row.views) || Number(row.likes) || Number(row.comments));
	if (!first || !through) return {};
	const out = {};
	for (const row of sorted) {
		const month = monthOf(row.day);
		if (`${month}-01` < String(first.day) || lastDayOf(month) > through) continue;
		const t = (out[month] ??= [0, 0, 0]);
		t[0] += Number(row.views) || 0;
		t[1] += Number(row.likes) || 0;
		t[2] += Number(row.comments) || 0;
	}
	return newest(out, Infinity);
}

/**
 * A channel's month still running from its day report: the month `through`
 * falls in, when YouTube has not every day of it yet, with its counts so far.
 * Null when `through` ends its month (that month is whole, and the next has
 * no day yet) or the channel was not active for all of it.
 */
export function youtubePart(dayRows, through) {
	if (!through) return null;
	const month = monthOf(through);
	if (lastDayOf(month) <= through) return null;
	const first = [...dayRows]
		.sort((a, b) => String(a.day).localeCompare(String(b.day)))
		.find((row) => Number(row.views) || Number(row.likes) || Number(row.comments));
	if (!first || `${month}-01` < String(first.day)) return null;
	const counts = [0, 0, 0];
	for (const row of dayRows) {
		if (monthOf(row.day) !== month || String(row.day) > through) continue;
		counts[0] += Number(row.views) || 0;
		counts[1] += Number(row.likes) || 0;
		counts[2] += Number(row.comments) || 0;
	}
	return { month, counts, through };
}

/**
 * The month still running as far as Instagram has it in: the month `now - lag`
 * falls in, up to the start of that day, as stretches in Unix seconds and the
 * last day covered. Null on its first day, when nothing of it is in yet.
 */
export function partStretches(now, lag = 0) {
	const until = Date.parse(`${new Date(now - lag).toISOString().slice(0, 10)}T00:00:00Z`);
	const month = monthOf(now - lag);
	if (until <= Date.parse(`${month}-01T00:00:00Z`)) return null;
	const end = until / 1000;
	const stretches = monthStretches(month)
		.map(([since, upTo]) => [since, Math.min(upTo, end)])
		.filter(([since, upTo]) => since < upTo);
	return { month, stretches, through: new Date(until - 86_400_000).toISOString().slice(0, 10) };
}

/** The last MONTHS_KEPT months of a monthly record. */
export function newest(monthly, count = MONTHS_KEPT) {
	return Object.fromEntries(
		Object.entries(monthly)
			.sort(([a], [b]) => a.localeCompare(b))
			.slice(-count)
	);
}

/** The `count` whole months before `now`, each over `lag` ago, oldest first. */
export function wholeMonths(now, count = MONTHS_KEPT, lag = 0) {
	const out = [];
	let month = monthOf(now - lag);
	// The month `now - lag` falls in is not over yet.
	for (let i = 0; i < count; i++) {
		const [y, m] = month.split('-').map(Number);
		month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
		out.unshift(month);
	}
	return out;
}

/**
 * A month as two stretches, in Unix seconds: Instagram answers a total over at
 * most 30 days, and a month can have 31.
 */
export function monthStretches(month) {
	const start = Date.parse(`${month}-01T00:00:00Z`) / 1000;
	const mid = Date.parse(`${month}-16T00:00:00Z`) / 1000;
	const end = Date.parse(`${nextMonthStart(month)}T00:00:00Z`) / 1000;
	return [
		[start, mid],
		[mid, end]
	];
}

/** The months just read, and the stored ones from before the first of them. */
export function keepOlder(stored, read) {
	const first = Object.keys(read).sort()[0];
	if (!first) return { ...(stored ?? {}) };
	const older = Object.entries(stored ?? {}).filter(([month]) => month < first);
	return { ...Object.fromEntries(older), ...read };
}

/** Leading months with nothing at all are from before the account was active: left out. */
export function dropQuietStart(monthly) {
	const out = {};
	let started = false;
	for (const [month, counts] of Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b))) {
		started ||= counts.some((n) => n > 0);
		if (started) out[month] = counts;
	}
	return out;
}

/** An insights answer's total for each of views, likes and comments. */
export function insightTotals(res) {
	const by = Object.fromEntries((res?.data ?? []).map((m) => [m.name, Number(m.total_value?.value) || 0]));
	return [by.views ?? 0, by.likes ?? 0, by.comments ?? 0];
}

const instagramState = new Map();

/**
 * An Instagram account's last MONTHS_KEPT whole months from its account
 * insights, into its follower row, once a day. Run after the follower count
 * (igstats.mjs) so the row exists and nothing else writes it meanwhile. A
 * failure is said once and leaves what is stored.
 */
export async function instagramMonthly({ pb, ig, log }) {
	let st = instagramState.get(ig.igUserId);
	if (!st) instagramState.set(ig.igUserId, (st = { at: 0, said: '' }));
	if (Date.now() - st.at < INSTAGRAM_TTL_MS) return;
	st.at = Date.now();
	try {
		const key = settingKey('instagram', String(ig.igUserId));
		const state = readState((await pb.getSetting(key))?.value);
		if (!state) return;
		const monthly = {};
		for (const month of wholeMonths(Date.now(), MONTHS_KEPT, INSTAGRAM_LAG_MS)) {
			const t = [0, 0, 0];
			for (const [since, until] of monthStretches(month)) {
				const res = await graph(ig, `/${ig.igUserId}/insights`, {
					params: { metric: 'views,likes,comments', period: 'day', metric_type: 'total_value', since: String(since), until: String(until) }
				});
				insightTotals(res).forEach((n, i) => (t[i] += n));
			}
			monthly[month] = t;
		}
		// Months older than those read stay as stored: a whole month does not change any more.
		const kept = dropQuietStart(keepOlder(state.monthly, monthly));
		// The month still running, once the account was active before it (as for whole months).
		let monthPart = null;
		const running = partStretches(Date.now(), INSTAGRAM_LAG_MS);
		if (running && Object.keys(kept).length > 0) {
			const counts = [0, 0, 0];
			for (const [since, until] of running.stretches) {
				const res = await graph(ig, `/${ig.igUserId}/insights`, {
					params: { metric: 'views,likes,comments', period: 'day', metric_type: 'total_value', since: String(since), until: String(until) }
				});
				insightTotals(res).forEach((n, i) => (counts[i] += n));
			}
			monthPart = { month: running.month, counts, through: running.through };
		}
		// Re-read just before writing: the follower count may have moved while the months were read.
		const fresh = readState((await pb.getSetting(key))?.value) ?? state;
		await pb.setSetting(key, { ...fresh, monthly: kept, monthPart, monthlyAt: new Date().toISOString() });
		const message = `monthly @${ig.username}: ${Object.keys(kept).length} whole months from Instagram's insights${monthPart ? `, ${monthPart.month} through ${monthPart.through}` : ''}`;
		if (message !== st.said) log(message);
		st.said = message;
	} catch (err) {
		const message = `monthly @${ig.username} not read: ${explain(err).message.split('\n')[0]}`;
		if (message !== st.said) log(message);
		st.said = message;
	}
}
