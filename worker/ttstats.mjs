// TikTok's own counts for the connected accounts' videos — views, likes,
// comments and shares — into `post_stats` beside Instagram's and Facebook's
// (igstats.mjs, fbstats.mjs), keyed by (platform 'tiktok', the video id) and
// written the same way: only what changed, a history sample only when a
// counter moved. Every public video on the account is read, not only
// flock's: TikTok's video/list returns public videos only. Each pass also
// reads the account's follower count for the Dashboard's followers per video
// (followers.mjs) — TikTok names no video for a follow, so a rise is
// credited by time, as Instagram's is.
//
// Both reads need scopes the posting grant lacks — video.list for the
// videos, user.info.stats for the counts — which a sign-in asks for only
// with `pnpm worker:auth --tiktok --with-stats`. An account whose grant
// holds neither is left alone, said once.
//
// TikTok's publish status gave no post id on 20 Oct 2026, so a post flock
// made was linked to the profile only. This pass finds such a post among the
// account's videos — by when it went out and its caption — and records the
// video's own address on the post.

import { TikTokError, grantedTikTokScope, hasScope, listVideos, userStats } from './tiktok.mjs';
import { saveRows } from './igstats.mjs';
import { creditWords, followerStep } from './followers.mjs';
import { inJob } from './jobscope.mjs';

const SETUP = 'pnpm worker:auth --tiktok --with-stats';

/**
 * TikTok's cover addresses live six hours (its video/list reference), so a
 * stored one is renewed once it is this old, at the cost of one write per
 * video per four hours — and never otherwise, or every read would write.
 */
export const COVER_RENEW_MS = 4 * 60 * 60_000;
/** A post flock made is looked for among the videos this long after it went out. */
export const LINK_DAYS = 3;
/** Its video went up within this of the post's recorded time, or it is not it. */
export const LINK_WINDOW_MS = 2 * 60 * 60_000;
/** A post with no caption is linked only to the one video this close to it. */
export const BARE_WINDOW_MS = 30 * 60_000;
/** Another worker's report on the status row (the demo's, say) is kept this long. */
const REPORT_KEPT_MS = 7 * 24 * 60 * 60_000;

/** Which reads an account's grant allows: its videos, its counts. */
export function statsReach(scope) {
	return { videos: hasScope(scope, 'video.list'), counts: hasScope(scope, 'user.info.stats') };
}

/** The video's own address: the share link without its tracking query, else built from the handle. */
export function videoUrl(item, username = '') {
	const shared = String(item?.share_url ?? '').replace(/[?#].*$/, '');
	if (/\/video\/\d+/.test(shared)) return shared;
	return username ? `https://www.tiktok.com/@${username}/video/${item.id}` : '';
}

/** The video id in a TikTok link; '' when it names none (a profile). */
export function videoIdOf(url) {
	return /\/video\/(\d+)/.exec(String(url ?? ''))?.[1] ?? '';
}

const count = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * One listed video as a `post_stats` row. `data` holds what has no column:
 * its title, length, share count and cover, with when the cover address was
 * taken (`now`, ISO).
 */
export function toTikTokRow(item, account, now) {
	const at = Number(item.create_time);
	return {
		platform: 'tiktok',
		post_id: String(item.id),
		account: String(account.openId ?? ''),
		handle: account.username ?? '',
		permalink: videoUrl(item, account.username),
		caption: String(item.video_description || item.title || '').slice(0, 2200),
		published_at: Number.isFinite(at) && at > 0 ? new Date(at * 1000).toISOString() : '',
		product_type: 'VIDEO',
		views: count(item.view_count),
		reach: null,
		likes: count(item.like_count),
		comments: count(item.comment_count),
		data: {
			title: String(item.title ?? ''),
			duration: count(item.duration),
			share_count: count(item.share_count),
			cover_image_url: String(item.cover_image_url ?? ''),
			cover_at: now
		}
	};
}

/** The stored cover while it is fresh, so a read that changed nothing else writes nothing. */
export function keepCover(prev, row, now) {
	const taken = Date.parse(String(prev?.data?.cover_at ?? ''));
	if (!prev?.data?.cover_image_url || !Number.isFinite(taken) || Date.parse(now) - taken >= COVER_RENEW_MS) return row;
	return { ...row, data: { ...row.data, cover_image_url: prev.data.cover_image_url, cover_at: prev.data.cover_at } };
}

/* ---- the post flock made, found among the videos ---- */

const squash = (text) =>
	String(text ?? '')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();

/**
 * Whether the caption flock sent is the one on a video: the same, or one
 * beginning with the other's first 60 characters (TikTok may add to the end
 * of a caption, and cuts nothing short of 2,200). A short caption must be
 * the same.
 */
export function captionsMatch(sent, posted) {
	const a = squash(sent);
	const b = squash(posted);
	if (a === b) return true;
	if (!a || !b) return false;
	return (a.length >= 12 && b.startsWith(a.slice(0, 60))) || (b.length >= 12 && a.startsWith(b.slice(0, 60)));
}

const time = (iso) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/**
 * The video a post flock made became, among `videos` (video/list items) not
 * `taken` by another post: the nearest in time whose caption matches, within
 * two hours of the post's recorded time; for a post without a caption, the
 * only video within half an hour. Null when none, or no telling.
 */
export function findPost(target, videos, taken = new Set()) {
	const out = time(target.published_at);
	if (!Number.isFinite(out)) return null;
	const sent = target.description || target.title || '';
	const near = videos
		.filter((v) => !taken.has(String(v.id)))
		.map((v) => ({ v, gap: Math.abs(Number(v.create_time) * 1000 - out) }))
		.filter((x) => Number.isFinite(x.gap) && x.gap <= LINK_WINDOW_MS)
		.sort((a, b) => a.gap - b.gap);
	if (squash(sent)) return near.find((x) => captionsMatch(sent, x.v.video_description || x.v.title || ''))?.v ?? null;
	const close = near.filter((x) => x.gap <= BARE_WINDOW_MS);
	return close.length === 1 ? close[0].v : null;
}

/** Whether a post is the account's: named by its open id, or naming none while it is the only account. */
export function postOf(target, account, accounts) {
	return target.account ? target.account === account.openId : accounts.length === 1;
}

/**
 * Gives every post flock made on the account in the last days, still linked
 * to the profile only, its video's address — found among `videos`. Returns
 * how many were linked.
 */
async function linkPosts(pb, account, accounts, videos, log) {
	const since = new Date(Date.now() - LINK_DAYS * 24 * 60 * 60_000);
	const posts = (await pb.tiktokPostsSince(since)).filter((t) => postOf(t, account, accounts));
	const taken = new Set(posts.map((t) => videoIdOf(t.remote_url)).filter(Boolean));
	let linked = 0;
	for (const target of posts) {
		if (videoIdOf(target.remote_url)) continue;
		const video = findPost(target, videos, taken);
		const url = video ? videoUrl(video, account.username) : '';
		if (!url) continue;
		taken.add(String(video.id));
		await inJob(target.job, async () => {
			await pb.updateTarget(target.id, { remote_url: url });
			log(`tiktok @${account.username}: found the post among its videos — ${url}`);
			pb.log('Linked the TikTok post', `${target.title || target.description?.split('\n')[0] || '(no caption)'} -> ${url}`);
		});
		linked++;
	}
	return linked;
}

/* ---- the pass ---- */

let off = false;
const said = new Map();
const reports = {};
const followerSaid = new Map();
const linkSaid = new Map();

/**
 * The account's follower count, and the rise since the last read credited
 * to its videos by the views they gained meanwhile (followers.mjs). Returns
 * the counts TikTok gave.
 */
async function readFollowers(pb, config, account, rows, byPost, log) {
	const stats = await userStats(config, account);
	if (stats.followers === null) throw new Error('TikTok gave no follower count');
	const name = account.username ? `@${account.username}` : account.openId;
	const step = await followerStep({
		pb,
		platform: 'tiktok',
		account: String(account.openId),
		name: account.username ? `@${account.username}` : stats.displayName,
		count: stats.followers,
		posts: rows.map((row) => ({
			id: row.post_id,
			at: Date.parse(row.published_at),
			views: row.views,
			history: byPost.get(row.post_id)?.history ?? []
		}))
	});
	if (step.gained) {
		const captions = new Map(rows.map((row) => [row.post_id, row.caption.split('\n')[0]]));
		log(creditWords(name, step, (id) => captions.get(id) ?? ''));
	}
	return stats;
}

/** Why a read was refused, in words for the log and the Dashboard. */
export function explainStats(err) {
	if (err instanceof TikTokError && err.code === 'scope_not_authorized') {
		return `TikTok refused: the grant lacks the scope. Sign the account in again with  ${SETUP}`;
	}
	return String(err?.message ?? err);
}

/** One account's read: its videos and its counts, as far as its grant goes. */
async function readAccount({ pb, config, account, byPost, log }) {
	const reach = statsReach(grantedTikTokScope(account));
	const now = new Date().toISOString();
	const name = account.username ? `@${account.username}` : account.openId;
	const report = { username: account.username ?? '', polledAt: now, posts: 0, error: '', missing: [], counts: null };
	if (!reach.videos) report.missing.push('video.list');
	if (!reach.counts) report.missing.push('user.info.stats');

	let rows = [];
	if (reach.videos) {
		const videos = await listVideos(config, account, config.ttStatsPosts);
		rows = videos.map((item) => keepCover(byPost.get(String(item.id)), toTikTokRow(item, account, now), now));
		const added = await saveRows(pb, byPost, rows, now);
		if (added) log(`tiktok stats ${name}: ${added} new video${added === 1 ? '' : 's'}`);
		report.posts = videos.length;
		// A failed lookup costs the links this time, never the numbers.
		try {
			await linkPosts(pb, account, config.tiktok.accounts, videos, log);
			linkSaid.delete(account.openId);
		} catch (err) {
			const message = String(err?.message ?? err).split('\n')[0];
			if (message !== linkSaid.get(account.openId)) log(`tiktok ${name}: posts not linked to their videos (${message})`);
			linkSaid.set(account.openId, message);
		}
	}
	if (reach.counts) {
		try {
			const stats = await readFollowers(pb, config, account, rows, byPost, log);
			report.counts = { followers: stats.followers, likes: stats.likes, videos: stats.videos };
			if (followerSaid.get(account.openId)) log(`followers ${name}: recovered`);
			followerSaid.delete(account.openId);
		} catch (err) {
			const message = explainStats(err);
			if (message !== followerSaid.get(account.openId)) {
				log(`followers ${name} not read: ${message.split('\n')[0]}`);
				followerSaid.set(account.openId, message);
			}
			report.error = message.slice(0, 500);
		}
	}
	return report;
}

/**
 * One read of every connected account whose grant allows it. A missing
 * `post_stats` collection turns the pass off for the run with one line; an
 * account's failure, or its grant lacking the scopes, is said once.
 */
export async function tiktokStatsPass({ pb, config, log }) {
	if (off) return;
	const accounts = config.tiktok.accounts.filter((account) => account.openId);
	if (accounts.length === 0) return;
	// Nothing at all to read: no call, so no token refresh either.
	const readable = accounts.filter((account) => {
		const reach = statsReach(grantedTikTokScope(account));
		return reach.videos || reach.counts;
	});

	let existing = [];
	if (readable.length > 0) {
		try {
			existing = await pb.listPostStats('tiktok');
		} catch (err) {
			if (!/ -> 404\b/.test(err.message)) throw err;
			off = true;
			log('post_stats is missing — run pnpm setup-pb, then restart; TikTok numbers are not read until then');
			return;
		}
	}
	const byPost = new Map(existing.map((row) => [row.post_id, row]));

	for (const account of accounts) {
		const name = account.username ? `@${account.username}` : account.openId;
		const before = said.get(account.openId) ?? '';
		if (!readable.includes(account)) {
			const note = `off: its sign-in has neither video.list nor user.info.stats (${SETUP})`;
			if (note !== before) log(`tiktok stats ${name} ${note}`);
			said.set(account.openId, note);
			reports[account.openId] = {
				username: account.username ?? '',
				polledAt: new Date().toISOString(),
				posts: 0,
				error: '',
				missing: ['video.list', 'user.info.stats'],
				counts: null
			};
			continue;
		}
		try {
			reports[account.openId] = await readAccount({ pb, config, account, byPost, log });
			const note = reports[account.openId].missing.length ? `reads no ${reports[account.openId].missing.join(' / ')} (${SETUP})` : '';
			if (note !== before) {
				if (note) log(`tiktok stats ${name} ${note}`);
				else if (before) log(`tiktok stats ${name}: reading`);
			}
			if (note) said.set(account.openId, note);
			else said.delete(account.openId);
		} catch (err) {
			const message = explainStats(err);
			if (message !== before) {
				log(`tiktok stats ${name} failed: ${message.split('\n')[0]}`);
				said.set(account.openId, message);
			}
			reports[account.openId] = {
				username: account.username ?? '',
				polledAt: new Date().toISOString(),
				posts: 0,
				error: message.slice(0, 500),
				missing: [],
				counts: null
			};
		}
	}

	// What the Dashboard shows of the pass: when each account was read, or why
	// not. Merged with what is stored, so another worker reading other
	// accounts (a demo's sandbox config, say) keeps its lines for a while.
	const stored = (await pb.getSetting('tiktok_stats_status').catch(() => null))?.value;
	await pb
		.setSetting('tiktok_stats_status', mergeReports(stored, reports, config.ttStatsSeconds, Date.now()))
		.catch(() => {});
}

/** The status row: this worker's reports over the stored ones, those of others kept a week. */
export function mergeReports(stored, own, intervalSeconds, now) {
	const kept = {};
	const old = stored && typeof stored === 'object' && stored.accounts && typeof stored.accounts === 'object' ? stored.accounts : {};
	for (const [id, report] of Object.entries(old)) {
		const at = Date.parse(String(report?.polledAt ?? ''));
		if (Number.isFinite(at) && now - at < REPORT_KEPT_MS) kept[id] = report;
	}
	return {
		polledAt: new Date(now).toISOString(),
		intervalSeconds,
		accounts: { ...kept, ...own }
	};
}
