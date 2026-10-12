// node --test runs each file in its own process, so the config path can be
// pointed at a scratch file before config.mjs reads it at import.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let config;
const write = (data) => writeFile(join(dir, 'config.json'), JSON.stringify(data));

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'flock-config-'));
	process.env.FLOCK_WORKER_CONFIG = join(dir, 'config.json');
	for (const key of ['FLOCK_WORKER_ROLE', 'FLOCK_PB_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
		delete process.env[key];
	}
	config = await import('./config.mjs');
});

after(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('requireConfig', () => {
	it('lets a local worker start with only the PocketBase address', async () => {
		await write({ pocketbaseUrl: 'http://pb:8091', role: 'local' });
		const loaded = config.requireConfig();
		assert.equal(loaded.role, 'local');
		assert.equal(config.hasYouTube(loaded), false);
	});

	it('still wants the Google client from a worker that publishes', async () => {
		for (const role of ['all', 'nas']) {
			await write({ pocketbaseUrl: 'http://pb:8091', role });
			assert.throws(() => config.requireConfig(), /google\.clientId, google\.clientSecret, google\.accounts/);
		}
	});

	it('wants the PocketBase address from every role', async () => {
		await write({ role: 'local' });
		assert.throws(() => config.requireConfig(), /pocketbaseUrl/);
	});

	it('says plainly when there is no config file at all', async () => {
		await rm(join(dir, 'config.json'), { force: true });
		assert.throws(() => config.requireConfig(), (err) => {
			assert.match(err.message, /config\.json does not exist/);
			assert.doesNotMatch(err.message, /google/);
			return true;
		});
	});
});

describe('configFile', () => {
	const dir = 'C:\\flock-worker';
	const has = (...names) => (path) => names.some((name) => path.endsWith(`\\${name}`) || path.endsWith(`/${name}`));

	it('reads the dotted name when it is there', () => {
		const exists = has('.worker-config.json', 'worker-config.json');
		assert.match(config.configFile(dir, { sea: true, exists }), /[\\/]\.worker-config\.json$/);
	});

	it('reads a downloaded copy, which lost its dot, beside the executable', () => {
		assert.match(config.configFile(dir, { sea: true, exists: has('worker-config.json') }), /[\\/]worker-config\.json$/);
		assert.doesNotMatch(config.configFile(dir, { sea: true, exists: has('worker-config.json') }), /\.worker-config/);
	});

	it('names the dotted file when neither is there, so a new one is written under it', () => {
		assert.match(config.configFile(dir, { sea: true, exists: has() }), /[\\/]\.worker-config\.json$/);
	});

	it('never reads the dotless name from the checkout, where only the dotted one is gitignored', () => {
		assert.match(config.configFile(dir, { sea: false, exists: has('worker-config.json') }), /[\\/]\.worker-config\.json$/);
	});
});
