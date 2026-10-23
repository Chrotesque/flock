import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	GAP_MS,
	LIMITED_MAX_MS,
	LIMITED_MIN_MS,
	answerPatch,
	captionHandles,
	lookupTikTokHandle,
	nextDelay,
	seedHandles,
	tiktokHandlePass
} from './tiktokhandles.mjs';

/** A fetch answering once with `status` and `body`, keeping the address asked. */
function answer(status, body) {
	const asked = [];
	const fetchImpl = async (url, init) => {
		asked.push({ url, init });
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
	};
	return { asked, fetchImpl };
}

// Shaped as TikTok answered on 24 Oct 2026, with a made-up account.
const OWLS = {
	version: '1.0',
	type: 'rich',
	title: "Owls Nest Games's Creator Profile",
	author_url: 'https://www.tiktok.com/@owlsnestgamesltd',
	author_name: 'Owls Nest Games',
	provider_name: 'TikTok',
	embed_product_id: 'owlsnestgamesltd',
	embed_type: 'profile'
};

test('the handles named in captions, lower case, once each', () => {
	assert.deepEqual(
		captionHandles([
			'wishlist it @OwlsNestGamesLtd. VR? @moth_and_marrow',
			'@owlsnestgamesltd me@mail.com @a @dune.studios.',
			null
		]),
		['owlsnestgamesltd', 'moth_and_marrow', 'dune.studios']
	);
});

test("an account TikTok knows comes back with its name, asked by its profile's address", async () => {
	const { asked, fetchImpl } = answer(200, OWLS);
	assert.deepEqual(await lookupTikTokHandle('owlsnestgamesltd', { fetchImpl }), {
		state: 'found',
		handle: 'owlsnestgamesltd',
		name: 'Owls Nest Games'
	});
	assert.equal(
		asked[0].url,
		'https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40owlsnestgamesltd'
	);
});

test("TikTok's 400 is a handle no account has; its 429 says ask later", async () => {
	const missing = answer(400, { code: 400, message: 'Something went wrong' });
	assert.deepEqual(await lookupTikTokHandle('nobody_zz', missing), { state: 'missing' });
	assert.deepEqual(await lookupTikTokHandle('x', answer(429, 'ratelimit triggered')), { state: 'limited' });
});

test('anything else is a failure that says what TikTok answered', async () => {
	assert.deepEqual(await lookupTikTokHandle('x', answer(500, 'oops')), {
		state: 'failed',
		error: 'TikTok answered 500: oops'
	});
	// A video's embed is not an account.
	assert.equal((await lookupTikTokHandle('x', answer(200, { embed_type: 'video', embed_product_id: '1' }))).state, 'failed');
	const offline = await lookupTikTokHandle('x', {
		fetchImpl: async () => {
			throw new Error('ENOTFOUND');
		}
	});
	assert.deepEqual(offline, { state: 'failed', error: 'TikTok did not answer (ENOTFOUND)' });
});

test('lookups are spaced out, and a 429 backs off doubling up to ten minutes', () => {
	assert.equal(nextDelay('found', 0), GAP_MS);
	assert.equal(nextDelay('limited', GAP_MS), LIMITED_MIN_MS);
	assert.equal(nextDelay('limited', LIMITED_MIN_MS), 2 * LIMITED_MIN_MS);
	assert.equal(nextDelay('limited', LIMITED_MAX_MS), LIMITED_MAX_MS);
	assert.equal(nextDelay('missing', LIMITED_MAX_MS), GAP_MS);
});

test('an answer becomes the row, a 429 leaves it pending', () => {
	const now = Date.parse('2026-10-24T01:00:00Z');
	assert.deepEqual(answerPatch({ state: 'found', name: 'Owls Nest Games', handle: 'owlsnestgamesltd' }, now), {
		status: 'found',
		name: 'Owls Nest Games',
		error: '',
		checked_at: '2026-10-24T01:00:00.000Z'
	});
	assert.equal(answerPatch({ state: 'missing' }, now).status, 'missing');
	assert.equal(answerPatch({ state: 'failed', error: 'TikTok answered 500' }, now).error, 'TikTok answered 500');
	assert.equal(answerPatch({ state: 'limited' }, now), null);
});

/** A stand-in for the worker's PocketBase client over a list of rows. */
function fakePb(rows, captions = []) {
	const patches = [];
	return {
		patches,
		rows,
		async nextTikTokHandle() {
			return rows.filter((r) => r.status === 'pending').sort((a, b) => b.updated.localeCompare(a.updated))[0] ?? null;
		},
		async updateTikTokHandle(id, data) {
			patches.push({ id, data });
			Object.assign(rows.find((r) => r.id === id), data);
		},
		async listTikTokHandles() {
			return rows.map(({ id, handle, used }) => ({ id, handle, used }));
		},
		async createTikTokHandle(data) {
			if (rows.some((r) => r.handle === data.handle)) throw new Error('POST -> 400');
			rows.push({ id: `n${rows.length}`, updated: '', ...data });
		},
		async tiktokCaptions() {
			return captions;
		}
	};
}

test('the pass answers the newest ask, then waits out the gap', async () => {
	const pb = fakePb([
		{ id: 'old', handle: 'lanternworks', status: 'pending', updated: '2026-10-24 00:00:00.000Z' },
		{ id: 'new', handle: 'owlsnestgamesltd', status: 'pending', updated: '2026-10-24 00:05:00.000Z' }
	]);
	const state = { nextAt: 0, delay: 0 };
	const { fetchImpl } = answer(200, OWLS);
	await tiktokHandlePass({ pb, log() {}, state, now: 1000, fetchImpl });
	assert.deepEqual(pb.patches.map((p) => [p.id, p.data.status, p.data.name]), [['new', 'found', 'Owls Nest Games']]);
	assert.equal(state.nextAt, 1000 + GAP_MS);
	await tiktokHandlePass({ pb, log() {}, state, now: 2000, fetchImpl });
	assert.equal(pb.patches.length, 1);
});

test('a 429 keeps the row pending, says when, and logs once', async () => {
	const pb = fakePb([{ id: 'a', handle: 'papermoonplay', status: 'pending', updated: '1' }]);
	const lines = [];
	const state = { nextAt: 0, delay: 0 };
	const limited = answer(429, 'ratelimit triggered');
	await tiktokHandlePass({ pb, log: (l) => lines.push(l), state, now: 0, fetchImpl: limited.fetchImpl });
	await tiktokHandlePass({ pb, log: (l) => lines.push(l), state, now: LIMITED_MIN_MS, fetchImpl: limited.fetchImpl });
	assert.equal(pb.rows[0].status, 'pending');
	assert.match(pb.rows[0].error, /^TikTok is limiting lookups; asking again at \d\d:\d\d\.$/);
	assert.equal(state.delay, 2 * LIMITED_MIN_MS);
	assert.equal(lines.length, 1);
});

test('a missing collection turns the pass off with one line', async () => {
	const lines = [];
	const state = { nextAt: 0, delay: 0 };
	const pb = {
		async nextTikTokHandle() {
			throw new Error('GET /api/collections/tiktok_handles/records -> 404\n{}');
		}
	};
	await tiktokHandlePass({ pb, log: (l) => lines.push(l), state, now: 0 });
	await tiktokHandlePass({ pb, log: (l) => lines.push(l), state, now: GAP_MS });
	assert.equal(state.off, true);
	assert.equal(lines.length, 1);
});

test('seeding lists past handles as used, once, and marks known ones used', async () => {
	const pb = fakePb(
		[{ id: 'k', handle: 'owlsnestgamesltd', status: 'found', used: false, updated: '' }],
		['Wishlist it @OwlsNestGamesLtd', 'by @papermoonplay', 'again @papermoonplay']
	);
	await seedHandles({ pb, log() {} });
	assert.deepEqual(
		pb.rows.map((r) => [r.handle, r.status, r.used]),
		[
			['owlsnestgamesltd', 'found', true],
			['papermoonplay', 'pending', true]
		]
	);
	await seedHandles({ pb, log() {} });
	assert.equal(pb.rows.length, 2);
});
