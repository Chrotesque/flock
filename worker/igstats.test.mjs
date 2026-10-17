import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counterMoved, differs, toPostRow } from './igstats.mjs';

const account = { igUserId: '1789', username: 'owlsnest' };

const item = {
	id: '1801',
	timestamp: '2026-10-12T10:00:00+0000',
	media_type: 'VIDEO',
	media_product_type: 'REELS',
	permalink: 'https://www.instagram.com/reel/abc/',
	caption: 'A reel',
	like_count: 16,
	comments_count: 3,
	insights: {
		data: [
			{ name: 'views', period: 'lifetime', values: [{ value: 1171 }] },
			{ name: 'reach', period: 'lifetime', values: [{ value: 1062 }] }
		]
	}
};

test('a reel becomes a row with its views and reach in columns', () => {
	const row = toPostRow(item, account);
	assert.equal(row.platform, 'instagram');
	assert.equal(row.post_id, '1801');
	assert.equal(row.account, '1789');
	assert.equal(row.product_type, 'REELS');
	assert.equal(row.published_at, '2026-10-12T10:00:00.000Z');
	assert.deepEqual([row.views, row.reach, row.likes, row.comments], [1171, 1062, 16, 3]);
	assert.equal(row.data.insights, undefined);
});

test("a reel's skip rate is kept in data, and a change in it alone is a change", () => {
	const rated = {
		...item,
		insights: { data: [...item.insights.data, { name: 'reels_skip_rate', period: 'lifetime', values: [{ value: 37.3 }] }] }
	};
	const row = toPostRow(rated, account);
	assert.deepEqual(row.data.insights, { reels_skip_rate: 37.3 });
	assert.equal(differs({ ...row, published_at: '2026-10-12 10:00:00.000Z' }, row), false);
	// Stored before skip rates were read, or with another rate: rewritten, with no history sample.
	const before = toPostRow(item, account);
	assert.equal(differs(before, row), true);
	assert.equal(counterMoved(before, row), false);
	assert.equal(differs({ ...row, data: { ...row.data, insights: { reels_skip_rate: 40 } } }, row), true);
});

test('a post with no insights has no views, not zero', () => {
	const row = toPostRow({ ...item, insights: undefined, like_count: undefined }, account);
	assert.equal(row.views, null);
	assert.equal(row.likes, null);
});

test('a stored row as PocketBase reads it back does not count as changed', () => {
	const row = toPostRow(item, account);
	const stored = { ...row, published_at: '2026-10-12 10:00:00.000Z' };
	assert.equal(differs(stored, row), false);
	// An empty number reads back as 0.
	const blank = toPostRow({ ...item, insights: undefined }, account);
	assert.equal(differs({ ...blank, views: 0, reach: 0 }, blank), false);
});

test('moved views are a change and a history sample; a new caption is a change only', () => {
	const row = toPostRow(item, account);
	const fewer = { ...row, views: 1100 };
	assert.equal(differs(fewer, row), true);
	assert.equal(counterMoved(fewer, row), true);
	const edited = { ...row, caption: 'Old caption' };
	assert.equal(differs(edited, row), true);
	assert.equal(counterMoved(edited, row), false);
});
