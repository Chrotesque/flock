// An account's views, likes and comments per whole calendar month, the
// platform's own figures, for the Dashboard's brand panel (src/lib/brandmonths.ts).
// YouTube's come with the channel's day report in ytanalytics.mjs; Instagram's
// from its account insights here, once a day. Both are kept in the account's
// follower row (`followers:<platform>:<id>`, followers.mjs) as `monthly` =
// { 'YYYY-MM': [views, likes, comments] }, the last MONTHS_KEPT whole months
// only — a month still running, or one the account was not yet active for
// all of, is left out, so every month stored is a full one.

import { explain, graph } from './instagram.mjs';
import { readState, settingKey } from './followers.mjs';

/** A year of months, and the one before the first, to compare it with. */
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
	return newest(out);
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
		const kept = dropQuietStart(monthly);
		// Re-read just before writing: the follower count may have moved while the months were read.
		const fresh = readState((await pb.getSetting(key))?.value) ?? state;
		await pb.setSetting(key, { ...fresh, monthly: kept, monthlyAt: new Date().toISOString() });
		const message = `monthly @${ig.username}: ${Object.keys(kept).length} whole months from Instagram's insights`;
		if (message !== st.said) log(message);
		st.said = message;
	} catch (err) {
		const message = `monthly @${ig.username} not read: ${explain(err).message.split('\n')[0]}`;
		if (message !== st.said) log(message);
		st.said = message;
	}
}
