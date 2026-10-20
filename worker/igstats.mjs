// Instagram's own counts for the posts on the connected accounts — above all
// each reel's views, which need the instagram_manage_insights permission.
//
// Rows go to `post_stats`, keyed by (platform, post_id): the newest
// `igStatsPosts` posts of every account each `igStatsSeconds`. As in the
// YouTube stats pass, a row is written only when something in it changed and
// a history sample only when a counter moved, so a quiet account costs no
// writes. Instagram says its insights can lag by up to 48 hours. Each pass
// also reads the account's follower count for the Dashboard's followers per
// reel (followers.mjs) — Instagram names no post for a follow.

import { explain, graph, listMedia } from './instagram.mjs';
import { instagramReady } from './accounts.mjs';
import { creditWords, followerStep } from './followers.mjs';

const HISTORY_CAP = 1000;

/** One insight's value, or null when Instagram gave none (absent, not zero). */
function insight(item, name) {
	const found = (item.insights?.data ?? []).find((d) => d.name === name);
	const value = found?.values?.[0]?.value ?? found?.total_value?.value;
	return value == null ? null : Number(value);
}

/**
 * One Graph media item as a `post_stats` row; `data` is the item without its
 * insights, which have columns — bar a reel's skip rate (the share of its
 * views skipped within the first 3 seconds, Instagram's estimate), kept as
 * `data.insights.reels_skip_rate` like Facebook's insights, so "not given"
 * stays apart from 0 and no schema change was needed.
 */
export function toPostRow(item, account) {
	const count = (v) => (v == null ? null : Number(v));
	const { insights, ...rest } = item;
	const skip = insight(item, 'reels_skip_rate');
	return {
		platform: 'instagram',
		post_id: String(item.id),
		account: String(account.igUserId),
		handle: account.username ?? '',
		permalink: item.permalink ?? '',
		caption: String(item.caption ?? '').slice(0, 2200),
		published_at: item.timestamp ? new Date(item.timestamp).toISOString() : '',
		product_type: item.media_product_type ?? item.media_type ?? '',
		views: insight(item, 'views'),
		reach: insight(item, 'reach'),
		likes: count(item.like_count),
		comments: count(item.comments_count),
		data: skip == null ? rest : { ...rest, insights: { reels_skip_rate: skip } }
	};
}

const skipRate = (row) => row?.data?.insights?.reels_skip_rate ?? null;
// Facebook's count of follows a reel brought (fbstats.mjs); Instagram gives none per post.
const follows = (row) => row?.data?.insights?.post_video_followers ?? null;
// TikTok's share count, and when its cover address was last taken — the
// address lives a few hours, so it is renewed now and then (ttstats.mjs).
const shares = (row) => row?.data?.share_count ?? null;
const coverAt = (row) => row?.data?.cover_at ?? '';

const COUNTERS = ['views', 'likes', 'comments'];
const NUMBERS = ['views', 'reach', 'likes', 'comments'];
const TEXTS = ['account', 'handle', 'permalink', 'caption', 'product_type'];

// PocketBase reads an empty number back as 0 and an empty text as '', and
// writes dates in its own form, so each is compared the way it comes back.
const sameNumber = (a, b) => Number(a ?? 0) === Number(b ?? 0);
const sameDate = (a, b) => Date.parse(String(a ?? '').replace(' ', 'T')) === Date.parse(String(b ?? '').replace(' ', 'T'));

/** Whether the stored row differs from a fresh read in anything worth a write. */
export function differs(prev, row) {
	return (
		NUMBERS.some((k) => !sameNumber(prev[k], row[k])) ||
		TEXTS.some((k) => (prev[k] ?? '') !== (row[k] ?? '')) ||
		!sameDate(prev.published_at, row.published_at) ||
		skipRate(prev) !== skipRate(row) ||
		follows(prev) !== follows(row) ||
		shares(prev) !== shares(row) ||
		coverAt(prev) !== coverAt(row)
	);
}

/** Whether a counter moved, which is what earns a history sample. */
export function counterMoved(prev, row) {
	return COUNTERS.some((k) => !sameNumber(prev[k], row[k]));
}

/**
 * Writes a pass's rows: a new post is created with its first sample, a known
 * one patched only when something differs, with a sample only when a counter
 * moved. `byPost` is the stored rows by post id. Returns how many were new.
 * Shared with the Facebook and TikTok passes (fbstats.mjs, ttstats.mjs).
 */
export async function saveRows(pb, byPost, rows, now) {
	let added = 0;
	for (const row of rows) {
		const prev = byPost.get(row.post_id);
		const sample = [now, row.views, row.likes, row.comments];
		if (!prev) {
			await pb.createPostStats({ ...row, fetched_at: now, history: [sample] });
			added++;
			continue;
		}
		if (!differs(prev, row)) continue;
		const history = Array.isArray(prev.history) ? prev.history : [];
		await pb.updatePostStats(prev.id, {
			...row,
			fetched_at: now,
			history: counterMoved(prev, row) ? [...history, sample].slice(-HISTORY_CAP) : history
		});
	}
	return added;
}

let off = false;
const said = new Map();
const reports = {};
const followerSaid = new Map();

/**
 * The account's follower count, and the rise since the last read credited
 * to its posts by the views they gained meanwhile (followers.mjs). `rows` are
 * the posts as just read, `byPost` the stored rows with their history. A
 * failure is said once and never stops the stats.
 */
async function readFollowers(pb, ig, rows, byPost, log) {
	try {
		const me = await graph(ig, `/${ig.igUserId}`, { params: { fields: 'followers_count' } });
		if (typeof me.followers_count !== 'number') throw new Error('Instagram gave no follower count');
		const step = await followerStep({
			pb,
			platform: 'instagram',
			account: String(ig.igUserId),
			name: ig.username ? `@${ig.username}` : '',
			count: me.followers_count,
			posts: rows.map((row) => ({
				id: row.post_id,
				at: Date.parse(row.published_at),
				views: row.views,
				history: byPost.get(row.post_id)?.history ?? []
			}))
		});
		if (step.gained) {
			const captions = new Map(rows.map((row) => [row.post_id, row.caption.split('\n')[0]]));
			log(creditWords(`@${ig.username}`, step, (id) => captions.get(id) ?? ''));
		}
		if (followerSaid.get(ig.igUserId)) log(`followers @${ig.username}: recovered`);
		followerSaid.delete(ig.igUserId);
	} catch (err) {
		const message = explain(err).message;
		if (message !== followerSaid.get(ig.igUserId)) {
			log(`followers @${ig.username} not read: ${message.split('\n')[0]}`);
			followerSaid.set(ig.igUserId, message);
		}
	}
}

/**
 * One read of every connected account. A missing `post_stats` collection
 * (setup-pb not run since this arrived) turns the pass off for the run with
 * one line; an account's failure is said once per distinct message.
 */
export async function instagramStatsPass({ pb, config, log }) {
	if (off) return;
	const accounts = config.instagram.accounts.filter(instagramReady);
	if (accounts.length === 0) return;

	let existing;
	try {
		existing = await pb.listPostStats('instagram');
	} catch (err) {
		if (!/ -> 404\b/.test(err.message)) throw err;
		off = true;
		log('post_stats is missing — run pnpm setup-pb, then restart; Instagram views are not read until then');
		return;
	}
	const byPost = new Map(existing.map((row) => [row.post_id, row]));

	for (const entry of accounts) {
		const ig = { ...entry, apiVersion: config.instagram.apiVersion };
		const before = said.get(ig.igUserId) ?? '';
		try {
			const items = await listMedia(ig, config.igStatsPosts);
			const now = new Date().toISOString();
			const rows = items.map((item) => toPostRow(item, ig));
			const added = await saveRows(pb, byPost, rows, now);
			await readFollowers(pb, ig, rows, byPost, log);
			if (added) log(`instagram stats @${ig.username}: ${added} new post${added === 1 ? '' : 's'}`);
			if (before) log(`instagram stats @${ig.username}: recovered`);
			said.delete(ig.igUserId);
			reports[ig.igUserId] = { username: ig.username, polledAt: now, posts: items.length, error: '' };
		} catch (err) {
			const message = explain(err).message;
			if (message !== before) {
				log(`instagram stats @${ig.username} failed: ${message.split('\n')[0]}`);
				said.set(ig.igUserId, message);
			}
			reports[ig.igUserId] = {
				username: ig.username,
				polledAt: new Date().toISOString(),
				posts: 0,
				error: message.slice(0, 500)
			};
		}
	}

	// What the page shows of the pass: when each account was read, or why not.
	await pb
		.setSetting('instagram_stats_status', {
			polledAt: new Date().toISOString(),
			intervalSeconds: config.igStatsSeconds,
			accounts: reports
		})
		.catch(() => {});
}
