// Facebook's own counts for the reels on the connected Pages — views, likes
// and comments — into `post_stats` beside Instagram's (igstats.mjs), keyed by
// (platform 'facebook', the reel's video id), written the same way: only what
// changed, a history sample only when a counter moved.
//
// Every reel on the Page is read, not only flock's: the Pages also carry the
// reels Instagram shares to Facebook. Likes and comments come with the
// listing on the grant every Page already has. Views are the reel's
// video_insights, which need read_insights — optional, so a Page whose grant
// lacks it is still read without views, and the status says why.

import { GraphError, graph } from './instagram.mjs';
import { explainFacebook, facebookAccount, reelUrl } from './facebook.mjs';
import { facebookReady } from './accounts.mjs';
import { saveRows } from './igstats.mjs';
import { followerStep, mergeBackfill, readState, settingKey } from './followers.mjs';

/**
 * The insights read with each reel. Views are its plays with replays
 * (fb_reels_total_plays), which is how Instagram and YouTube count a reel's
 * or a Short's views; the rest ride along in `data` — among them
 * post_video_followers, "the number of follows for your reel" in Meta's
 * words, the Dashboard's followers for it (YouTube and Instagram name no
 * video for a follower, see followers.mjs).
 */
export const REEL_METRICS = [
	'fb_reels_total_plays',
	'blue_reels_play_count',
	'post_video_avg_time_watched',
	'post_video_social_actions',
	'post_video_followers'
];

const FIELDS =
	'id,created_time,status,description,permalink_url,length,likes.summary(true).limit(0),comments.summary(true).limit(0)';
const INSIGHTS = `video_insights.metric(${REEL_METRICS.join(',')})`;

/** After the insights were refused, they are asked for again only this much later. */
const RETRY_INSIGHTS_MS = 60 * 60_000;

const SETUP = 'pnpm worker:auth:instagram';

/** A reel's insights as { metric: value }; Facebook gives each one value for its lifetime. */
export function readInsights(edge) {
	const out = {};
	for (const row of edge?.data ?? []) {
		const value = row?.values?.[0]?.value ?? row?.total_value?.value;
		if (row?.name && value != null) out[row.name] = value;
	}
	return out;
}

const count = (v) => (v == null || v === '' ? null : Number(v));

/**
 * When a reel went out: Facebook's `publish_time`, else when it was made.
 * Not `created_time` alone — a reel Facebook held for its slot was made when
 * flock uploaded it, up to 28 days before (one on 14 Oct 2026 read 17.6 h
 * early, so its views curve started 17.6 h late on the Dashboard).
 */
export function publishedAt(item) {
	const at = Date.parse(item?.status?.publishing_phase?.publish_time ?? item?.created_time ?? '');
	return Number.isFinite(at) ? new Date(at).toISOString() : '';
}

/** One listed reel as a `post_stats` row; `data` is the item without its counters, insights flattened. */
export function toFacebookRow(item, page) {
	const { video_insights, likes, comments, status: _status, ...rest } = item;
	const insights = readInsights(video_insights);
	return {
		platform: 'facebook',
		post_id: String(item.id),
		account: String(page.pageId),
		handle: page.pageName ?? '',
		permalink: reelUrl(item.permalink_url ?? '', item.id),
		caption: String(item.description ?? '').slice(0, 2200),
		published_at: publishedAt(item),
		product_type: 'REELS',
		views: count(insights.fb_reels_total_plays),
		reach: null,
		likes: count(likes?.summary?.total_count),
		comments: count(comments?.summary?.total_count),
		data: { ...rest, insights }
	};
}

/**
 * A row read without insights keeps the views it had: their absence that
 * time is the grant's, not the reel's, and writing null over them would put a
 * junk sample in its history.
 */
export function keepViews(prev, row) {
	if (!prev) return row;
	return {
		...row,
		views: prev.views ?? null,
		data: { ...row.data, insights: prev.data?.insights ?? {} }
	};
}

/** Whether a refusal of the insights is about them (permission, unknown metric), not the call as a whole. */
export function insightsRefused(err) {
	return err instanceof GraphError && (err.code === 10 || err.code === 200 || err.code === 100);
}

/** Why views are not read, in words for the dashboard. */
export function viewsWhy(err) {
	if (err instanceof GraphError && (err.code === 10 || err.code === 200)) {
		return `Views need the read_insights permission: sign the Pages in again with  ${SETUP}`;
	}
	return `Facebook refused the views query (${err.message.split('\n')[0]})`;
}

/** The Page's newest reels, `limit` at most, newest first; pages of 50. */
async function listReels(page, limit, fields) {
	const out = [];
	let after = '';
	while (out.length < limit) {
		const res = await graph(page, `/${page.pageId}/video_reels`, {
			params: { fields, limit: String(Math.min(50, limit - out.length)), after }
		});
		out.push(...(res.data ?? []));
		after = res.paging?.next ? (res.paging.cursors?.after ?? '') : '';
		if (!after) break;
	}
	return out;
}

let off = false;
const said = new Map();
/** Page id -> { until, why }: when the insights were last refused, and why. */
const noInsights = new Map();
const reports = {};
const followerSaid = new Map();
const backfillSaid = new Map();

/** How far back a Page's follower count is filled in, once (Facebook keeps two years and more). */
export const BACKFILL_DAYS = 730;
/** Facebook answers at most 93 days of a day metric at a time. */
const WINDOW_DAYS = 90;

/** Facebook's day values as `[iso, value]`, the day's end and its count. */
export function dailyValues(res) {
	return (res?.data?.[0]?.values ?? [])
		.filter((v) => typeof v?.value === 'number' && v.end_time)
		.map((v) => [new Date(v.end_time).toISOString(), v.value]);
}

/** The Page's follower count at the end of each day, `days` back, oldest first (page_follows, read_insights). */
async function pageFollowsHistory(page, days) {
	const out = [];
	let until = Math.floor(Date.now() / 1000);
	const stop = until - days * 86_400;
	while (until > stop) {
		const since = Math.max(stop, until - WINDOW_DAYS * 86_400);
		const res = await graph(page, `/${page.pageId}/insights`, {
			params: { metric: 'page_follows', period: 'day', since: String(since), until: String(until) }
		});
		const values = dailyValues(res);
		if (values.length === 0) break;
		out.push(...values);
		until = since;
	}
	return out.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
}

/**
 * The Page's past follower counts filled in once, so the Dashboard's periods
 * reach back before flock started reading (worker/followers.mjs). Retried on
 * the next pass if Facebook refuses; said once.
 */
async function backfillPage(pb, page, log) {
	const key = settingKey('facebook', String(page.pageId));
	const state = readState((await pb.getSetting(key))?.value);
	if (!state || state.backfilled) return;
	const daily = await pageFollowsHistory(page, BACKFILL_DAYS);
	const merged = mergeBackfill(state, daily, Date.now());
	await pb.setSetting(key, merged);
	log(`followers ${page.pageName || page.pageId}: filled in ${daily.length} days of past counts from Facebook (since ${merged.since.slice(0, 10)})`);
}

/**
 * The Page's follower count, kept with its history (followers.mjs) for the
 * Dashboard's followers gained per period, its past filled in once from
 * Facebook's daily counts. Nothing is credited from it: Facebook names the
 * reel a follow came from itself (post_video_followers).
 */
async function readPageFollowers(pb, page, log) {
	const name = page.pageName || page.pageId;
	try {
		const me = await graph(page, `/${page.pageId}`, { params: { fields: 'followers_count' } });
		if (typeof me.followers_count !== 'number') throw new Error('Facebook gave no follower count');
		await followerStep({ pb, platform: 'facebook', account: String(page.pageId), name, count: me.followers_count, posts: [] });
		try {
			await backfillPage(pb, page, log);
		} catch (err) {
			const why = explainFacebook(err).message.split('\n')[0];
			const message = `followers ${name}: past counts not filled in (${why}) — tried again next pass`;
			if (backfillSaid.get(page.pageId) !== message) log(message);
			backfillSaid.set(page.pageId, message);
		}
		if (followerSaid.get(page.pageId)) log(`followers ${name}: recovered`);
		followerSaid.delete(page.pageId);
	} catch (err) {
		const message = explainFacebook(err).message;
		if (message !== followerSaid.get(page.pageId)) {
			log(`followers ${name} not read: ${message.split('\n')[0]}`);
			followerSaid.set(page.pageId, message);
		}
	}
}

/** A Page's reels with their insights when the grant allows, without them when it does not. */
async function readPage(page, limit) {
	const refused = noInsights.get(page.pageId);
	if (!refused || Date.now() >= refused.until) {
		try {
			const items = await listReels(page, limit, `${FIELDS},${INSIGHTS}`);
			noInsights.delete(page.pageId);
			return { items, views: '' };
		} catch (err) {
			if (!insightsRefused(err)) throw err;
			noInsights.set(page.pageId, { until: Date.now() + RETRY_INSIGHTS_MS, why: viewsWhy(err) });
		}
	}
	return { items: await listReels(page, limit, FIELDS), views: noInsights.get(page.pageId).why };
}

/**
 * One read of every connected Page. A missing `post_stats` collection turns
 * the pass off for the run with one line; a Page's failure, and its views
 * going unread, are each said once per distinct message.
 */
export async function facebookStatsPass({ pb, config, log }) {
	if (off) return;
	const pages = config.facebook.accounts.filter(facebookReady);
	if (pages.length === 0) return;

	let existing;
	try {
		existing = await pb.listPostStats('facebook');
	} catch (err) {
		if (!/ -> 404\b/.test(err.message)) throw err;
		off = true;
		log('post_stats is missing — run pnpm setup-pb, then restart; Facebook reel numbers are not read until then');
		return;
	}
	const byPost = new Map(existing.map((row) => [row.post_id, row]));

	for (const entry of pages) {
		const page = facebookAccount(config, entry.pageId);
		const name = page.pageName || page.pageId;
		const before = said.get(page.pageId) ?? '';
		try {
			const { items, views } = await readPage(page, config.fbStatsPosts);
			const now = new Date().toISOString();
			const rows = items.map((item) => {
				const row = toFacebookRow(item, page);
				return views ? keepViews(byPost.get(row.post_id), row) : row;
			});
			const added = await saveRows(pb, byPost, rows, now);
			await readPageFollowers(pb, page, log);
			if (added) log(`facebook stats ${name}: ${added} new reel${added === 1 ? '' : 's'}`);
			const note = views ? `views: ${views}` : '';
			if (note !== before) {
				if (note) log(`facebook stats ${name}: no ${note}`);
				else if (before) log(`facebook stats ${name}: ${before.startsWith('views:') ? 'reading views' : 'recovered'}`);
			}
			if (note) said.set(page.pageId, note);
			else said.delete(page.pageId);
			reports[page.pageId] = { name, polledAt: now, posts: items.length, error: '', views };
		} catch (err) {
			const message = explainFacebook(err).message;
			if (message !== before) {
				log(`facebook stats ${name} failed: ${message.split('\n')[0]}`);
				said.set(page.pageId, message);
			}
			reports[page.pageId] = { name, polledAt: new Date().toISOString(), posts: 0, error: message.slice(0, 500), views: '' };
		}
	}

	// What the dashboard shows of the pass: when each Page was read, or why not.
	await pb
		.setSetting('facebook_stats_status', {
			polledAt: new Date().toISOString(),
			intervalSeconds: config.fbStatsSeconds,
			pages: reports
		})
		.catch(() => {});
}
