// YouTube Analytics: how many subscribers each video brought, and the
// channel's per day — YouTube's own figures, where the Data API only says
// how many a channel has (followers.mjs credits a rise by time instead). They
// need the `yt-analytics.readonly` grant (`pnpm worker:auth --with-playlists`
// since 0.16.40) and arrive about two days late; a channel whose grant lacks
// it keeps flock's estimate. The Analytics API has its own quota: nothing here
// is charged to the Data API's 10,000 units.
//
// Written into the channel's follower row (`followers:youtube:<id>`):
// `analytics` = { videoId: [gained, lost] } over each video's life,
// `engaged` = { videoId: [views, engagedViews] } from the same report — a
// Short's views count every play since 31 Mar 2025, its engaged views only
// those past YouTube's old view threshold, so the share that never got there
// is the Dashboard's skip rate for YouTube — `analyticsThrough` = the last
// day YouTube has, `monthly` = the channel's views, likes and comments per
// whole month (monthly.mjs, from the same day report), and, once, the
// channel's daily counts in front of what flock recorded (mergeBackfill).

import { forgetToken, grantedScope } from './google.mjs';
import { youtubeToken } from './youtube.mjs';
import { fetchOrExplain } from './net.mjs';
import { mergeBackfill, readState, settingKey } from './followers.mjs';
import { youtubeMonthly } from './monthly.mjs';

const API = 'https://youtubeanalytics.googleapis.com/v2/reports';
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
/** YouTube's first day: a report from here covers any channel's whole life. */
const FIRST_DAY = '2005-02-14';
/** YouTube Analytics updates once a day; four reads a day catch it soon enough. */
const ANALYTICS_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Videos asked about per request. Per-video figures come from a report
 * filtered to the videos flock lists: the top-videos report stops at 200 and
 * refuses a second page (`startIndex` 201 answered "The query is not
 * supported" on 19 Oct 2026, for the one channel with more).
 */
const BATCH = 200;

const DAY = 86_400_000;

/** Whether a grant's scopes (as Google reported them on refresh) include Analytics. */
export function canReadAnalytics(scope) {
	return String(scope ?? '')
		.split(/\s+/)
		.includes(ANALYTICS_SCOPE);
}

/** A report's rows as objects by column name. */
export function reportRows(res) {
	const names = (res?.columnHeaders ?? []).map((h) => h.name);
	return (res?.rows ?? []).map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
}

/** Per video, [gained, lost] over its life; videos with neither are left out. */
export function perVideo(rows) {
	const out = {};
	for (const row of rows) {
		const gained = Number(row.subscribersGained) || 0;
		const lost = Number(row.subscribersLost) || 0;
		if (row.video && (gained || lost)) out[String(row.video)] = [gained, lost];
	}
	return out;
}

/** Per video, [views, engagedViews] over its life; videos with no view are left out. */
export function perVideoEngaged(rows) {
	const out = {};
	for (const row of rows) {
		const views = Number(row.views) || 0;
		const engaged = Number(row.engagedViews) || 0;
		if (row.video && views > 0) out[String(row.video)] = [views, engaged];
	}
	return out;
}

/** The last day a day report covers, 'YYYY-MM-DD'; '' with none. */
export function lastDay(dayRows) {
	return dayRows.reduce((last, row) => (String(row.day) > last ? String(row.day) : last), '');
}

/** When a YouTube day (Pacific) ends, near enough: 08:00 UTC the next morning. */
export function dayEnd(day) {
	return new Date(Date.parse(`${day}T08:00:00Z`) + DAY).toISOString();
}

/**
 * The channel's count at the end of each day, from its daily gains less
 * losses added up. Analytics' total need not match the public count (spam
 * removals, rounding above 1,000), so with `anchor` — the first count flock
 * recorded, `{ at, count }` — the series is shifted to meet it: the moves
 * are YouTube's, the level flock's.
 */
export function dailyCounts(dayRows, anchor = null) {
	const sorted = [...dayRows].sort((a, b) => String(a.day).localeCompare(String(b.day)));
	// A report from 2005 holds every empty day before the channel's first
	// subscriber: from the day before that one on is enough.
	const first = sorted.findIndex((row) => Number(row.subscribersGained) || Number(row.subscribersLost));
	if (first < 0) return [];
	const days = sorted.slice(Math.max(0, first - 1));
	let total = 0;
	const out = days.map((row) => {
		total += (Number(row.subscribersGained) || 0) - (Number(row.subscribersLost) || 0);
		return [dayEnd(row.day), total];
	});
	if (!anchor || out.length === 0) return out;
	const before = out.filter(([iso]) => Date.parse(iso) < anchor.at).at(-1);
	const offset = anchor.count - (before ? before[1] : 0);
	return out.map(([iso, count]) => [iso, count + offset]);
}

/** A list cut into runs of at most `size`. */
export function batches(list, size = BATCH) {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

async function report(config, account, params, retry = true) {
	const token = await youtubeToken(config, account);
	const url = new URL(API);
	url.searchParams.set('ids', 'channel==MINE');
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	const res = await fetchOrExplain(url, { headers: { Authorization: `Bearer ${token}` } });
	const text = await res.text();
	if (res.status === 401 && retry) {
		forgetToken(account.refreshToken);
		return report(config, account, params, false);
	}
	if (!res.ok) {
		let message = text.slice(0, 300);
		try {
			message = JSON.parse(text).error?.message ?? message;
		} catch {
			// The raw text is the message.
		}
		if (res.status === 403 && /disabled|has not been used/i.test(message)) {
			throw new Error('The YouTube Analytics API is not enabled in the Google Cloud project.');
		}
		if (res.status === 403 && /insufficient|scope|permission/i.test(message)) {
			throw new Error('The grant cannot read YouTube Analytics. Sign the channel in again:  pnpm worker:auth --with-playlists');
		}
		throw new Error(`YouTube Analytics ${res.status}: ${message.split('\n')[0]}`);
	}
	return text ? JSON.parse(text) : {};
}

const perChannel = new Map();

/**
 * One channel's Analytics, every six hours: per-video subscribers and the
 * last day covered, and once the channel's daily counts. A grant without the
 * scope, or a failure, is said once and leaves flock's estimate in place.
 */
export async function analyticsPass({ pb, config, log, account }) {
	let st = perChannel.get(account.channelId);
	if (!st) perChannel.set(account.channelId, (st = { at: 0, said: '' }));
	if (Date.now() - st.at < ANALYTICS_TTL_MS) return;
	st.at = Date.now();
	const say = (message) => {
		if (message !== st.said) log(message);
		st.said = message;
	};

	try {
		await youtubeToken(config, account);
		if (!canReadAnalytics(grantedScope(account.refreshToken))) {
			say(`analytics ${account.title}: not read — sign the channel in again with  pnpm worker:auth --with-playlists  to read YouTube's own subscribers per video`);
			return;
		}
		const key = settingKey('youtube', account.channelId);
		const state = readState((await pb.getSetting(key))?.value);
		// The subscriber count is read first (stats.mjs); without it there is no row to add to yet.
		if (!state) return;

		const endDate = new Date().toISOString().slice(0, 10);
		const metrics = 'subscribersGained,subscribersLost';
		// The channel's views, likes and comments per day ride along, for its whole months (monthly.mjs).
		const days = reportRows(
			await report(config, account, { startDate: FIRST_DAY, endDate, metrics: `${metrics},views,likes,comments`, dimensions: 'day', sort: 'day' })
		);
		// The videos the Dashboard can show: those flock has a row for.
		const videos = [];
		for (const ids of batches(await pb.listChannelVideoIds(account.channelId))) {
			const rows = reportRows(
				await report(config, account, {
					startDate: FIRST_DAY,
					endDate,
					metrics: `${metrics},views,engagedViews`,
					dimensions: 'video',
					filters: `video==${ids.join(',')}`
				})
			);
			videos.push(...rows);
		}

		const now = Date.now();
		let next = {
			...state,
			analytics: perVideo(videos),
			engaged: perVideoEngaged(videos),
			analyticsThrough: lastDay(days),
			analyticsAt: new Date(now).toISOString(),
			monthly: youtubeMonthly(days, lastDay(days)),
			monthlyAt: new Date(now).toISOString()
		};
		if (!state.backfilled && days.length > 0) {
			const first = state.history[0];
			next = mergeBackfill(next, dailyCounts(days, first ? { at: Date.parse(first[0]), count: first[1] } : null), now);
			log(`analytics ${account.title}: filled in ${days.length} days of past subscribers from YouTube (since ${next.since.slice(0, 10)})`);
		}
		await pb.setSetting(key, next);
		say(
			`analytics ${account.title}: ${Object.keys(next.analytics).length} videos with subscribers, ${Object.keys(next.engaged).length} with engaged views, through ${next.analyticsThrough || 'no day yet'}`
		);
	} catch (err) {
		say(`analytics ${account.title} failed: ${String(err instanceof Error ? err.message : err).split('\n')[0]}`);
	}
}
