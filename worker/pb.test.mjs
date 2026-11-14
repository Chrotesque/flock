import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, videoIdFilter } from './pb.mjs';

test('videoIdFilter matches any of the ids, once each, and drops anything that is not an id', () => {
	assert.equal(videoIdFilter(['abc_DEF-123', 'xyz', 'abc_DEF-123']), 'video_id="abc_DEF-123" || video_id="xyz"');
	assert.equal(videoIdFilter(['ok', 'bad" || 1=1', '', null]), 'video_id="ok"');
	assert.equal(videoIdFilter([]), '');
});

test('videoStatsFor asks by id, not for the newest rows', async () => {
	const asked = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		asked.push(String(url));
		return new Response(JSON.stringify({ items: [{ id: 'r1', video_id: 'old1' }] }), { status: 200 });
	};
	try {
		const pb = makeClient('http://pb.test');
		const rows = await pb.videoStatsFor(['old1', 'new2']);
		assert.deepEqual(rows, [{ id: 'r1', video_id: 'old1' }]);
		assert.equal(asked.length, 1);
		const filter = new URL(asked[0]).searchParams.get('filter');
		assert.equal(filter, 'video_id="old1" || video_id="new2"');
		assert.equal(await pb.videoStatsFor([]).then((r) => r.length), 0);
		assert.equal(asked.length, 1, 'no ids, no request');
	} finally {
		globalThis.fetch = realFetch;
	}
});
