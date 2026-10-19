import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyValues, insightsRefused, keepViews, publishedAt, readInsights, toFacebookRow, viewsWhy } from './fbstats.mjs';
import { differs, saveRows } from './igstats.mjs';
import { GraphError } from './instagram.mjs';

const page = { pageId: '4100', pageName: 'Owls Nest' };

const item = {
	id: '2229',
	created_time: '2026-10-14T13:27:11+0000',
	description: 'Werbung – a reel',
	permalink_url: '/reel/2229/',
	length: 27.4,
	likes: { data: [], summary: { total_count: 4 } },
	comments: { data: [], summary: { total_count: 2, order: 'ranked' } },
	video_insights: {
		data: [
			{ name: 'fb_reels_total_plays', period: 'lifetime', values: [{ value: 312 }] },
			{ name: 'blue_reels_play_count', period: 'lifetime', values: [{ value: 280 }] },
			{ name: 'post_video_social_actions', period: 'lifetime', values: [{ value: { COMMENT: 2, SHARE: 1 } }] }
		]
	}
};

test('insights read as one value each, objects kept whole', () => {
	assert.deepEqual(readInsights(item.video_insights), {
		fb_reels_total_plays: 312,
		blue_reels_play_count: 280,
		post_video_social_actions: { COMMENT: 2, SHARE: 1 }
	});
	assert.deepEqual(readInsights(undefined), {});
});

test('a reel becomes a row with views, likes and comments in columns', () => {
	const row = toFacebookRow(item, page);
	assert.equal(row.platform, 'facebook');
	assert.equal(row.post_id, '2229');
	assert.equal(row.account, '4100');
	assert.equal(row.handle, 'Owls Nest');
	assert.equal(row.product_type, 'REELS');
	assert.equal(row.permalink, 'https://www.facebook.com/reel/2229/');
	assert.equal(row.published_at, '2026-10-14T13:27:11.000Z');
	assert.deepEqual([row.views, row.reach, row.likes, row.comments], [312, null, 4, 2]);
	assert.equal(row.data.likes, undefined);
	assert.equal(row.data.video_insights, undefined);
	assert.equal(row.data.insights.blue_reels_play_count, 280);
	assert.equal(row.data.length, 27.4);
});

test('a reel is dated by when it went out, not when it was uploaded', () => {
	// Held by Facebook for its slot: uploaded at 01:24, out at 19:00.
	const held = {
		...item,
		created_time: '2026-10-14T01:24:50+0000',
		status: { video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published', publish_time: '2026-10-14T19:00:00+0000' } }
	};
	const row = toFacebookRow(held, page);
	assert.equal(row.published_at, '2026-10-14T19:00:00.000Z');
	assert.equal(row.data.status, undefined);
	// No status in the answer: when it was made.
	assert.equal(publishedAt(item), '2026-10-14T13:27:11.000Z');
	assert.equal(publishedAt({}), '');
});

test('a reel read without insights has no views, not zero', () => {
	const row = toFacebookRow({ ...item, video_insights: undefined }, page);
	assert.equal(row.views, null);
	assert.equal(row.likes, 4);
});

test('a read without insights keeps the views a reel had', () => {
	const stored = { ...toFacebookRow(item, page), id: 'rec1' };
	const bare = toFacebookRow({ ...item, video_insights: undefined, likes: { summary: { total_count: 5 } } }, page);
	const kept = keepViews(stored, bare);
	assert.equal(kept.views, 312);
	assert.equal(kept.likes, 5);
	assert.equal(kept.data.insights.fb_reels_total_plays, 312);
	// A reel never seen before has nothing to keep.
	assert.equal(keepViews(undefined, bare).views, null);
});

test('a permission or metric refusal turns the views off; anything else is the call failing', () => {
	assert.equal(insightsRefused(new GraphError({ code: 200, message: 'read_insights permission missing' }, 400)), true);
	assert.equal(insightsRefused(new GraphError({ code: 10, message: 'needs permission' }, 403)), true);
	assert.equal(insightsRefused(new GraphError({ code: 100, message: 'The value must be a valid insights metric' }, 400)), true);
	assert.equal(insightsRefused(new GraphError({ code: 190, message: 'token' }, 400)), false);
	assert.equal(insightsRefused(new Error('fetch failed')), false);
	assert.match(viewsWhy(new GraphError({ code: 200, message: 'x' }, 400)), /read_insights/);
	assert.match(viewsWhy(new GraphError({ code: 100, message: 'bad metric' }, 400)), /refused the views query/);
});

test('saveRows creates new posts, patches changed ones and samples only moved counters', async () => {
	const calls = [];
	const pb = {
		createPostStats: async (data) => calls.push(['create', data]),
		updatePostStats: async (id, data) => calls.push(['update', id, data])
	};
	const row = toFacebookRow(item, page);
	const quiet = { ...row, id: 'a', post_id: 'q', history: [['2026-10-14T00:00:00Z', 312, 4, 2]] };
	const moved = { ...row, id: 'b', post_id: 'm', views: 300, history: [['2026-10-14T00:00:00Z', 300, 4, 2]] };
	assert.equal(differs(quiet, { ...row, post_id: 'q' }), false);
	const byPost = new Map([
		['q', quiet],
		['m', moved]
	]);
	const now = '2026-10-14T14:00:00.000Z';
	const added = await saveRows(pb, byPost, [{ ...row, post_id: 'q' }, { ...row, post_id: 'm' }, { ...row, post_id: 'n' }], now);
	assert.equal(added, 1);
	assert.equal(calls.length, 2);
	assert.equal(calls[0][0], 'update');
	assert.equal(calls[0][1], 'b');
	assert.deepEqual(calls[0][2].history.at(-1), [now, 312, 4, 2]);
	assert.equal(calls[1][0], 'create');
	assert.deepEqual(calls[1][1].history, [[now, 312, 4, 2]]);
});

test("a reel's follows ride in its insights, and a change in them alone is a change", () => {
	const followed = {
		...item,
		video_insights: { data: [...item.video_insights.data, { name: 'post_video_followers', period: 'lifetime', values: [{ value: 3 }] }] }
	};
	const row = toFacebookRow(followed, page);
	assert.equal(row.data.insights.post_video_followers, 3);
	const before = toFacebookRow(item, page);
	assert.equal(differs(before, row), true);
	assert.equal(differs(row, toFacebookRow(followed, page)), false);
});

test("a Page's daily follower counts read as [day's end, count]", () => {
	const res = {
		data: [
			{
				name: 'page_follows',
				period: 'day',
				values: [
					{ value: 1016, end_time: '2026-10-19T07:00:00+0000' },
					{ value: 'x', end_time: '2026-10-20T07:00:00+0000' },
					{ value: 1015 }
				]
			}
		]
	};
	assert.deepEqual(dailyValues(res), [['2026-10-19T07:00:00.000Z', 1016]]);
	assert.deepEqual(dailyValues({}), []);
});
