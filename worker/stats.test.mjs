import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsPass } from './stats.mjs';
import { pacificDay, unitsToday } from './quota.mjs';

// Only the stopped paths: they never reach YouTube, so no token is needed.
// The module keeps its state for the process, so the steps run in order.
test('past the budget the pass stops, says so once and keeps the heartbeat current', async () => {
	const writes = [];
	const lines = [];
	const pb = {
		getSetting: async () => ({
			value: {
				polledAt: '2026-10-23T02:23:32.802Z',
				quota: { day: pacificDay(), units: 8500, kinds: { stats: 8400, playlist: 100 }, uploads: 4 },
				runs: [],
				channels: {}
			}
		}),
		setSetting: async (key, value) => writes.push({ key, value })
	};
	const config = {
		statsSeconds: 30,
		statsBudget: 8000,
		statsCeiling: 9000,
		google: { accounts: [{ channelId: 'UC1', title: 'One', refreshToken: 'r1' }] }
	};
	const log = (line) => lines.push(line);

	assert.equal(await statsPass({ pb, config, log }), 'stopped');
	assert.equal(unitsToday(), 8500, 'the day restored from the heartbeat');
	assert.equal(writes.length, 1);
	assert.equal(writes[0].key, 'stats_status');
	assert.equal(writes[0].value.stopped, 'auto');
	assert.equal(writes[0].value.unitsToday, 8500);
	assert.equal(writes[0].value.ceiling, 9000);
	assert.equal(writes[0].value.polledAt, '2026-10-23T02:23:32.802Z', 'a stopped pass read nothing');
	assert.deepEqual(writes[0].value.quota.kinds, { stats: 8400, playlist: 100 });
	assert.equal(lines.length, 1);

	// Nothing moved: no second write, no second line.
	assert.equal(await statsPass({ pb, config, log }), 'stopped');
	assert.equal(writes.length, 1);
	assert.equal(lines.length, 1);

	// Past the ceiling a Refresh is refused too.
	const high = { ...config, statsCeiling: 8400 };
	assert.equal(await statsPass({ pb, config: high, log, manual: true }), 'ceiling');
	assert.equal(writes.length, 2);
	assert.equal(writes[1].value.stopped, 'ceiling');
	assert.equal(lines.length, 2);
});
