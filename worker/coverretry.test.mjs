import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_RETRY_MS, nextCoverPause, triedFor, withCoverRetries } from './coverretry.mjs';

// A clock the pauses move on, so five minutes of retries take no time.
function clock() {
	let t = 1_000_000;
	return { now: () => t, sleep: async (ms) => void (t += ms), add: (ms) => void (t += ms) };
}

const offline = () => Object.assign(new Error('Cannot reach https://graph.facebook.com (ETIMEDOUT)'), { cause: {} });

test('the pauses grow to a minute, the last cut short so the last try starts at five minutes', () => {
	const start = 0;
	assert.equal(nextCoverPause(1, start, 0), 10_000);
	assert.equal(nextCoverPause(2, start, 10_000), 20_000);
	assert.equal(nextCoverPause(3, start, 30_000), 30_000);
	assert.equal(nextCoverPause(4, start, 60_000), 60_000);
	assert.equal(nextCoverPause(9, start, 120_000), 60_000);
	assert.equal(nextCoverPause(9, start, COVER_RETRY_MS - 40_000), 40_000);
	assert.equal(nextCoverPause(9, start, COVER_RETRY_MS - 5_000), 5_000);
	assert.equal(nextCoverPause(9, start, COVER_RETRY_MS - 4_999), null);
});

test('a cover that works on a later try is taken, with each retry logged', async () => {
	const c = clock();
	const lines = [];
	let tries = 0;
	const got = await withCoverRetries(
		async () => {
			tries += 1;
			if (tries < 3) throw offline();
			return 'photo';
		},
		{ retryable: () => true, log: (l) => lines.push(l), sleep: c.sleep, now: c.now }
	);
	assert.deepEqual(got, { value: 'photo', attempts: 3 });
	assert.equal(lines.length, 2);
	assert.match(lines[0], /Cannot reach .* — trying again in 10s/);
});

test('a network that stays down is given five minutes, then the warning says so', async () => {
	const c = clock();
	const got = await withCoverRetries(
		async () => {
			c.add(2_000);
			throw offline();
		},
		{ retryable: () => true, log: () => {}, sleep: c.sleep, now: c.now }
	);
	assert.ok(got.error);
	// Its last try starts at five minutes, give or take the minimum pause.
	assert.ok(got.ms <= COVER_RETRY_MS + 2_000, `took ${got.ms} ms`);
	assert.ok(got.ms >= COVER_RETRY_MS - 5_000, `gave up early, after ${got.ms} ms`);
	assert.equal(triedFor(got), ` (gave up after ${got.attempts} tries over 5 min)`);
});

test('a refusal not worth asking again gives up at once', async () => {
	const c = clock();
	let tries = 0;
	const got = await withCoverRetries(
		async () => {
			tries += 1;
			throw new Error('(#10) permission');
		},
		{ retryable: () => false, log: () => {}, sleep: c.sleep, now: c.now }
	);
	assert.equal(tries, 1);
	assert.equal(got.attempts, 1);
	assert.equal(triedFor(got), '');
});
