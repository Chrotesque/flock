import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	COVER_RENEW_MS,
	captionsMatch,
	explainStats,
	findPost,
	keepCover,
	mergeReports,
	postOf,
	statsReach,
	tiktokStatsPass,
	toTikTokRow,
	videoIdOf,
	videoUrl
} from './ttstats.mjs';
import { TikTokError, forgetToken, hasScope, listVideos, tiktokScopes, userStats } from './tiktok.mjs';
import { counterMoved, differs } from './igstats.mjs';

const account = { openId: 'open-owls', username: 'owlsnest', refreshToken: 'r-owls', scope: 'user.info.basic,video.publish,video.list,user.info.stats' };

const item = {
	id: '7400000000000000001',
	create_time: 1792494000, // 2026-10-20T11:00:00Z
	cover_image_url: 'https://p16.example/cover-1.jpeg?x-expires=1',
	share_url: 'https://www.tiktok.com/@owlsnest/video/7400000000000000001?utm_campaign=tt4d_open_api&utm_source=abc',
	video_description: 'Werbung – an owl at dusk #owls',
	title: 'An owl at dusk',
	duration: 27,
	view_count: 1234,
	like_count: 56,
	comment_count: 7,
	share_count: 3
};

const NOW = '2026-10-20T12:00:00.000Z';

test('the stats scopes are asked for only with the flag', () => {
	assert.deepEqual(tiktokScopes(), ['user.info.basic', 'video.publish']);
	assert.deepEqual(tiktokScopes(true), ['user.info.basic', 'video.publish', 'video.list', 'user.info.stats']);
});

test("a grant's scopes are read from TikTok's comma-separated string", () => {
	assert.equal(hasScope('user.info.basic,video.publish', 'video.publish'), true);
	assert.equal(hasScope('user.info.basic,video.publish', 'video.list'), false);
	assert.equal(hasScope('user.info.basic, video.list', 'video.list'), true);
	assert.equal(hasScope(undefined, 'video.list'), false);
	// No scope is a prefix of another.
	assert.equal(hasScope('user.info.stats', 'user.info'), false);
	assert.deepEqual(statsReach('user.info.basic,video.publish,video.list'), { videos: true, counts: false });
	assert.deepEqual(statsReach('user.info.stats'), { videos: false, counts: true });
});

test('a video becomes a row with its counters in columns and the rest in data', () => {
	const row = toTikTokRow(item, account, NOW);
	assert.equal(row.platform, 'tiktok');
	assert.equal(row.post_id, '7400000000000000001');
	assert.equal(row.account, 'open-owls');
	assert.equal(row.handle, 'owlsnest');
	assert.equal(row.permalink, 'https://www.tiktok.com/@owlsnest/video/7400000000000000001');
	assert.equal(row.published_at, '2026-10-20T11:00:00.000Z');
	assert.equal(row.product_type, 'VIDEO');
	assert.deepEqual([row.views, row.reach, row.likes, row.comments], [1234, null, 56, 7]);
	assert.deepEqual(row.data, {
		title: 'An owl at dusk',
		duration: 27,
		share_count: 3,
		cover_image_url: 'https://p16.example/cover-1.jpeg?x-expires=1',
		cover_at: NOW
	});
	// No counters given: not known, not zero.
	const bare = toTikTokRow({ id: '9', create_time: 0 }, account, NOW);
	assert.deepEqual([bare.views, bare.likes, bare.comments, bare.published_at], [null, null, null, '']);
});

test("a video's address is its share link without the tracking, or built from the handle", () => {
	assert.equal(videoUrl({ id: '5', share_url: '' }, 'owlsnest'), 'https://www.tiktok.com/@owlsnest/video/5');
	assert.equal(videoUrl({ id: '5' }, ''), '');
	assert.equal(videoIdOf('https://www.tiktok.com/@owlsnest/video/7400000000000000001'), '7400000000000000001');
	assert.equal(videoIdOf('https://www.tiktok.com/@owlsnest'), '');
});

test('a fresh cover is kept, so a read that changed nothing writes nothing', () => {
	const stored = { ...toTikTokRow(item, account, '2026-10-20T10:00:00.000Z'), id: 'rec1' };
	const read = toTikTokRow({ ...item, cover_image_url: 'https://p16.example/cover-2.jpeg' }, account, NOW);
	const kept = keepCover(stored, read, NOW);
	assert.equal(kept.data.cover_image_url, stored.data.cover_image_url);
	assert.equal(kept.data.cover_at, stored.data.cover_at);
	assert.equal(differs(stored, kept), false);
	// Old enough: the new address goes in, and that is a write without a sample.
	const later = new Date(Date.parse('2026-10-20T10:00:00.000Z') + COVER_RENEW_MS).toISOString();
	const renewed = keepCover(stored, toTikTokRow({ ...item, cover_image_url: 'https://p16.example/cover-3.jpeg' }, account, later), later);
	assert.equal(renewed.data.cover_image_url, 'https://p16.example/cover-3.jpeg');
	assert.equal(differs(stored, renewed), true);
	assert.equal(counterMoved(stored, renewed), false);
	// Nothing stored: the read as it is.
	assert.equal(keepCover(undefined, read, NOW), read);
});

test('more shares are a change, though not a history sample', () => {
	const stored = toTikTokRow(item, account, NOW);
	const shared = toTikTokRow({ ...item, share_count: 4 }, account, NOW);
	assert.equal(differs(stored, shared), true);
	assert.equal(counterMoved(stored, shared), false);
	assert.equal(counterMoved(stored, toTikTokRow({ ...item, view_count: 1300 }, account, NOW)), true);
});

test('captions match when the same, or when one begins with the other', () => {
	assert.equal(captionsMatch('An owl at dusk', 'an owl  at dusk'), true);
	assert.equal(captionsMatch('Werbung – an owl at dusk', 'Werbung – an owl at dusk #flock'), true);
	assert.equal(captionsMatch('Test', 'Test 2'), false);
	assert.equal(captionsMatch('', 'Anything'), false);
	assert.equal(captionsMatch('', ''), true);
});

test('a post flock made is found among the videos by its time and caption', () => {
	const target = { published_at: '2026-10-20 11:03:00.000Z', description: 'Werbung – an owl at dusk #owls', title: '' };
	const other = { ...item, id: '2', video_description: 'Something else', create_time: 1792494060 };
	const far = { ...item, id: '3', create_time: 1792494000 - 3 * 3600 };
	assert.equal(findPost(target, [other, far, item])?.id, item.id);
	// Taken by another post already, or out of reach in time: none.
	assert.equal(findPost(target, [other, item], new Set([item.id])), null);
	assert.equal(findPost(target, [far]), null);
	// The nearest of two with the caption.
	const twin = { ...item, id: '4', create_time: 1792494000 + 50 * 60 };
	assert.equal(findPost(target, [twin, item])?.id, item.id);
	// No caption sent: only when one video alone is close.
	const bare = { ...target, description: '' };
	assert.equal(findPost(bare, [item])?.id, item.id);
	assert.equal(findPost(bare, [item, { ...item, id: '5', create_time: 1792494120 }]), null);
	assert.equal(findPost({ ...target, published_at: '' }, [item]), null);
});

test("a post is the account's by its open id, or the only account's", () => {
	assert.equal(postOf({ account: 'open-owls' }, account, [account]), true);
	assert.equal(postOf({ account: 'open-moon' }, account, [account]), false);
	assert.equal(postOf({ account: '' }, account, [account]), true);
	assert.equal(postOf({ account: '' }, account, [account, { openId: 'open-moon' }]), false);
});

test("the status keeps another worker's accounts for a week", () => {
	const now = Date.parse(NOW);
	const stored = {
		accounts: {
			'open-demo': { username: 'demo', polledAt: '2026-10-19T12:00:00.000Z' },
			'open-gone': { username: 'gone', polledAt: '2026-10-01T12:00:00.000Z' },
			'open-owls': { username: 'owlsnest', polledAt: '2026-10-20T11:00:00.000Z', posts: 1 }
		}
	};
	const merged = mergeReports(stored, { 'open-owls': { username: 'owlsnest', polledAt: NOW, posts: 2 } }, 600, now);
	assert.deepEqual(Object.keys(merged.accounts).sort(), ['open-demo', 'open-owls']);
	assert.equal(merged.accounts['open-owls'].posts, 2);
	assert.equal(merged.intervalSeconds, 600);
	assert.deepEqual(mergeReports(null, {}, 600, now).accounts, {});
});

test('a refused scope says how to sign in again', () => {
	assert.match(explainStats(new TikTokError('scope_not_authorized', 'no', '', 200)), /--with-stats/);
	assert.equal(explainStats(new Error('fetch failed')), 'fetch failed');
});

/* ---- against a stubbed TikTok ---- */

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A TikTok answering the token refresh, video/list in pages of two and user/info; `calls` records each request. */
function stubTikTok({ videos, followers = 120, scope = account.scope }) {
	const calls = [];
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(String(url));
		calls.push({ path: u.pathname, method: init.method ?? 'GET', query: u.search, body: init.body ? String(init.body) : '' });
		if (u.pathname === '/v2/oauth/token/') {
			const form = new URLSearchParams(String(init.body));
			return json({ access_token: `access-${form.get('refresh_token')}`, expires_in: 86400, refresh_token: form.get('refresh_token'), scope });
		}
		if (u.pathname === '/v2/video/list/') {
			const asked = JSON.parse(String(init.body));
			const from = asked.cursor ? videos.findIndex((v) => v.create_time * 1000 < asked.cursor) : 0;
			const page = from < 0 ? [] : videos.slice(from, from + Math.min(2, asked.max_count));
			const last = page[page.length - 1];
			const more = from >= 0 && from + page.length < videos.length;
			return json({ data: { videos: page, cursor: last ? last.create_time * 1000 : 0, has_more: more }, error: { code: 'ok', message: '' } });
		}
		if (u.pathname === '/v2/user/info/') {
			return json({
				data: { user: { open_id: 'open-owls', display_name: 'Owls Nest', follower_count: followers, following_count: 3, likes_count: 900, video_count: videos.length } },
				error: { code: 'ok', message: '' }
			});
		}
		return json({ error: { code: 'not_found', message: u.pathname } }, 404);
	};
	return calls;
}

function fakePb({ posts = [] } = {}) {
	const settings = new Map();
	const rows = new Map();
	const writes = [];
	const logs = [];
	let n = 0;
	return {
		settings,
		rows,
		writes,
		logs,
		posts,
		async listPostStats() {
			return [...rows.values()];
		},
		async createPostStats(data) {
			const row = { ...data, id: `rec${++n}` };
			rows.set(data.post_id, row);
			writes.push(['create', data.post_id]);
			return row;
		},
		async updatePostStats(id, data) {
			const prev = [...rows.values()].find((r) => r.id === id);
			rows.set(data.post_id, { ...prev, ...data });
			writes.push(['update', data.post_id]);
		},
		async getSetting(key) {
			return settings.has(key) ? { key, value: settings.get(key) } : null;
		},
		async setSetting(key, value) {
			settings.set(key, JSON.parse(JSON.stringify(value)));
		},
		async tiktokPostsSince() {
			return posts;
		},
		async updateTarget(id, data) {
			const post = posts.find((p) => p.id === id);
			Object.assign(post, data);
			writes.push(['target', id]);
		},
		log(action, detail) {
			logs.push([action, detail]);
		}
	};
}

const config = (accounts) => ({
	tiktok: { clientKey: 'k', clientSecret: 's', accounts },
	ttStatsPosts: 100,
	ttStatsSeconds: 600
});

test('video/list is asked for its fields in pages of 20 at most, by cursor', async () => {
	const videos = [1, 2, 3, 4, 5].map((i) => ({ ...item, id: String(i), create_time: 1792494000 - i * 60 }));
	const calls = stubTikTok({ videos });
	const owls = { ...account, refreshToken: 'r-list' };
	forgetToken(owls);
	const listed = await listVideos(config([owls]), owls, 4);
	assert.deepEqual(
		listed.map((v) => v.id),
		['1', '2', '3', '4']
	);
	const lists = calls.filter((c) => c.path === '/v2/video/list/');
	assert.equal(lists.length, 2);
	assert.match(lists[0].query, /fields=id,create_time,cover_image_url,share_url,video_description,title,duration,view_count,like_count,comment_count,share_count/);
	assert.deepEqual(JSON.parse(lists[0].body), { max_count: 4 });
	assert.deepEqual(JSON.parse(lists[1].body), { max_count: 2, cursor: (1792494000 - 2 * 60) * 1000 });
	forgetToken(owls);
});

test('user/info is a GET for the counts', async () => {
	const calls = stubTikTok({ videos: [item], followers: 321 });
	const owls = { ...account, refreshToken: 'r-user' };
	forgetToken(owls);
	const stats = await userStats(config([owls]), owls);
	assert.deepEqual(stats, { openId: 'open-owls', displayName: 'Owls Nest', followers: 321, likes: 900, videos: 1 });
	const call = calls.find((c) => c.path === '/v2/user/info/');
	assert.equal(call.method, 'GET');
	assert.match(call.query, /fields=open_id,display_name,follower_count,likes_count,video_count/);
	forgetToken(owls);
});

test('an account whose grant lacks the scopes costs no call, not even a token refresh', async () => {
	const calls = stubTikTok({ videos: [item] });
	const pb = fakePb();
	const lines = [];
	const posting = { openId: 'open-moon', username: 'papermoon', refreshToken: 'r-moon', scope: 'user.info.basic,video.publish' };
	await tiktokStatsPass({ pb, config: config([posting]), log: (line) => lines.push(line) });
	assert.equal(calls.length, 0);
	assert.equal(pb.writes.length, 0);
	assert.match(lines.join('\n'), /@papermoon off: .*--with-stats/);
	const status = pb.settings.get('tiktok_stats_status');
	assert.deepEqual(status.accounts['open-moon'].missing, ['video.list', 'user.info.stats']);
});

test('the pass reads the videos and the followers, links the post flock made, and writes only what changed', async () => {
	const videos = [
		item,
		{ ...item, id: '7400000000000000000', create_time: 1792486000, video_description: 'An older owl', view_count: 50, share_count: 0 },
		{ ...item, id: '7399999999999999999', create_time: 1792476000, video_description: 'The oldest owl', view_count: 9 }
	];
	const calls = stubTikTok({ videos, followers: 120 });
	const posts = [
		// Out through flock at 11:01, linked to the profile only: it is the first video.
		{
			id: 't1',
			job: 'job1',
			account: 'open-owls',
			title: '',
			description: 'Werbung – an owl at dusk #owls',
			published_at: '2026-10-20 11:01:00.000Z',
			remote_url: 'https://www.tiktok.com/@owlsnest'
		}
	];
	const pb = fakePb({ posts });
	const lines = [];
	const owls = { ...account };
	forgetToken(owls);
	await tiktokStatsPass({ pb, config: config([owls]), log: (line) => lines.push(line) });

	assert.equal(pb.rows.size, 3);
	const first = pb.rows.get(item.id);
	assert.equal(first.views, 1234);
	assert.equal(first.data.share_count, 3);
	assert.equal(first.history.length, 1);
	assert.equal(posts[0].remote_url, 'https://www.tiktok.com/@owlsnest/video/7400000000000000001');
	assert.ok(lines.some((line) => line.includes('found the post among its videos')));
	assert.deepEqual(pb.logs[0][0], 'Linked the TikTok post');

	// The follower record is started, the status says what was read.
	const followers = pb.settings.get('followers:tiktok:open-owls');
	assert.equal(followers.count, 120);
	assert.equal(followers.platform, 'tiktok');
	const status = pb.settings.get('tiktok_stats_status');
	assert.equal(status.accounts['open-owls'].posts, 3);
	assert.deepEqual(status.accounts['open-owls'].counts, { followers: 120, likes: 900, videos: 3 });
	assert.deepEqual(status.accounts['open-owls'].missing, []);
	// One refresh for the account, shared by every call.
	assert.equal(calls.filter((c) => c.path === '/v2/oauth/token/').length, 1);

	// A second read with nothing moved writes nothing; one with more views writes that row only.
	pb.writes.length = 0;
	await tiktokStatsPass({ pb, config: config([owls]), log: (line) => lines.push(line) });
	assert.deepEqual(pb.writes, []);
	videos[0] = { ...item, view_count: 1500 };
	stubTikTok({ videos, followers: 125 });
	await tiktokStatsPass({ pb, config: config([owls]), log: (line) => lines.push(line) });
	assert.deepEqual(pb.writes, [['update', item.id]]);
	assert.equal(pb.rows.get(item.id).history.length, 2);
	// The five new followers went to the one video that gained views meanwhile.
	assert.deepEqual(pb.settings.get('followers:tiktok:open-owls').credits, { [item.id]: 5 });
	forgetToken(owls);
});
