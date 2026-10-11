// Bundles the worker and puts it beside a worker's config elsewhere — the
// folder a NAS container mounts.
//
//   pnpm deploy:worker        bundle, copy, and wait for the worker to restart
//   pnpm deploy:worker --dry  say what would happen, copy nothing
//
// The destination comes from FLOCK_WORKER_DEST, in the environment or in .env,
// and must already hold `.worker-config.json`: that is what makes it a
// worker's folder rather than anywhere at all. The bundle goes in under a
// temporary name and is renamed over the old one, so the running worker never
// sees half a file. A worker started with FLOCK_RESTART_ON_UPDATE=1 then
// restarts itself once nothing is in hand (selfupdate.mjs); any other has to
// be restarted by hand.

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorker } from './bundle-worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
	process.loadEnvFile(join(root, '.env'));
} catch {
	// No .env: the environment alone has to say where to deploy.
}
const dest = process.env.FLOCK_WORKER_DEST || '';
const pbUrl = (process.env.PUBLIC_POCKETBASE_URL || '').replace(/\/+$/, '');
const dry = process.argv.includes('--dry');
const NAME = 'flock-worker.cjs';

function fail(message) {
	console.error(`\n${message}\n`);
	process.exit(1);
}

if (!dest) {
	fail(
		'FLOCK_WORKER_DEST is not set.\n\n' +
			"Put the folder the worker runs from — its .worker-config.json beside it — in .env,\n" +
			'for example\n' +
			'  FLOCK_WORKER_DEST=\\\\nas\\appdata\\flock_worker\n' +
			'or set it in the environment.'
	);
}
if (!existsSync(dest)) fail(`Destination is not reachable:\n  ${dest}\n\nIs the share mounted?`);
if (!existsSync(join(dest, '.worker-config.json'))) {
	fail(
		`Refusing to deploy to:\n  ${dest}\n\n` +
			'It holds no .worker-config.json, so it is not a worker folder. Put the\n' +
			"worker's config there first."
	);
}

const out = join(root, 'dist', 'worker');
mkdirSync(out, { recursive: true });
const bundle = join(out, NAME);
await bundleWorker(bundle);
const size = statSync(bundle).size;
console.log(`\nBundled ${bundle} (${(size / 1024).toFixed(0)} KB).`);

if (dry) {
	console.log(`Would copy it to ${join(dest, NAME)}. Nothing copied.\n`);
	process.exit(0);
}

// The heartbeats as they are now, to tell a restart from the same run beating on.
const KEYS = ['worker_all', 'worker_nas', 'worker_local'];
async function beats() {
	const out = {};
	for (const key of KEYS) {
		const filter = encodeURIComponent(`key="${key}"`);
		const res = await fetch(`${pbUrl}/api/collections/app_settings/records?perPage=1&filter=${filter}`);
		if (!res.ok) throw new Error(`PocketBase answered ${res.status}`);
		const value = (await res.json()).items?.[0]?.value;
		if (value) out[key] = value;
	}
	return out;
}
const before = pbUrl ? await beats().catch(() => null) : null;

const partial = join(dest, `${NAME}.partial`);
copyFileSync(bundle, partial);
if (statSync(partial).size !== size) {
	rmSync(partial, { force: true });
	fail('The copy came out a different size; the old worker file is untouched.');
}
renameSync(partial, join(dest, NAME));
console.log(`Copied to ${join(dest, NAME)}.`);

if (!before) {
	console.log(
		'\nCould not read the heartbeats, so not waiting for the restart. A worker started\n' +
			'with FLOCK_RESTART_ON_UPDATE=1 restarts itself once idle; restart any other by hand.\n'
	);
	process.exit(0);
}

// A worker that restarts on updates looks every ten seconds, needs two looks
// to agree, and then finishes what it holds — an upload can take a while.
console.log('Waiting for the worker to restart on it (ctrl-c to stop waiting)…');
const deadline = Date.now() + 3 * 60_000;
while (Date.now() < deadline) {
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const now = await beats().catch(() => null);
	if (!now) continue;
	for (const key of KEYS) {
		const was = before[key];
		const is = now[key];
		if (is && was && is.run !== was.run && !is.stoppedAt) {
			console.log(`Restarted: ${key.slice(7)} worker on ${is.host}, run ${is.run}.\n`);
			process.exit(0);
		}
	}
}
console.log(
	'\nNo restart within three minutes. Either it is finishing an upload (the sidebar\n' +
		'says what it is doing), or it was not started with FLOCK_RESTART_ON_UPDATE=1 and\n' +
		'has to be restarted by hand.\n'
);
