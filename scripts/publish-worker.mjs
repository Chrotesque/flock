// Signs the background exe that `pnpm build:worker` made and uploads it to
// PocketBase's `worker_builds`, where PC workers find it (worker/exeupdate.mjs).
// PocketBase is on the NAS, so the build waits there for whichever PC comes
// on next. Older builds beyond the newest three are deleted.
//
//   pnpm publish:worker     after pnpm build:worker; pnpm deploy:worker runs both

import { createHash, sign } from 'node:crypto';
import { existsSync, openAsBlob, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSigningKey } from './worker-key.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = 'win32-x64';
const KEEP = 3;

function appVersion() {
	const match = readFileSync(join(root, 'src', 'lib', 'version.ts'), 'utf8').match(/VERSION\s*=\s*'([^']+)'/);
	if (!match) throw new Error('No VERSION in src/lib/version.ts');
	return match[1];
}

/** What is signed; the same text as worker/exeupdate.mjs signedText. */
function signedText({ version, platform, size, sha256 }) {
	return `flock-worker\n${version}\n${platform}\n${size}\n${sha256}`;
}

export async function publishWorker({ pbUrl, log = console.log } = {}) {
	try {
		process.loadEnvFile(join(root, '.env'));
	} catch {
		// The environment alone.
	}
	const base = (pbUrl ?? process.env.PUBLIC_POCKETBASE_URL ?? '').replace(/\/+$/, '');
	if (!base) throw new Error('PUBLIC_POCKETBASE_URL is not set, so there is nowhere to publish to.');
	const key = loadSigningKey();
	if (!key) throw new Error('No signing key yet — run pnpm worker:key once, then build again.');
	const exe = join(root, 'dist', 'worker', 'flock-worker-background.exe');
	if (!existsSync(exe)) throw new Error(`${exe} is not there — run pnpm build:worker first.`);

	const version = appVersion();
	const size = statSync(exe).size;
	const sha256 = createHash('sha256').update(readFileSync(exe)).digest('hex');
	const row = { version, platform: PLATFORM, size, sha256 };
	const signature = sign(null, Buffer.from(signedText(row)), key.privateKey).toString('base64');

	const list = async () => {
		const filter = encodeURIComponent(`platform="${PLATFORM}"`);
		const res = await fetch(`${base}/api/collections/worker_builds/records?perPage=200&sort=-created&filter=${filter}`);
		if (!res.ok) throw new Error(`PocketBase answered ${res.status} listing worker_builds — has pnpm setup-pb run?`);
		return (await res.json()).items ?? [];
	};

	// The same version published again replaces the row (a rebuild).
	for (const old of (await list()).filter((r) => r.version === version)) {
		await fetch(`${base}/api/collections/worker_builds/records/${old.id}`, { method: 'DELETE' });
	}

	const form = new FormData();
	for (const [k, v] of Object.entries({ ...row, signature })) form.set(k, String(v));
	form.set('file', await openAsBlob(exe), 'flock-worker-background.exe');
	log(`Uploading the PC worker v${version} (${(size / 1048576).toFixed(0)} MB) to ${base}…`);
	const res = await fetch(`${base}/api/collections/worker_builds/records`, { method: 'POST', body: form });
	if (!res.ok) throw new Error(`Upload refused (${res.status}): ${(await res.text()).slice(0, 300)}`);

	for (const stale of (await list()).slice(KEEP)) {
		await fetch(`${base}/api/collections/worker_builds/records/${stale.id}`, { method: 'DELETE' });
	}
	log(`Published: PC workers offer v${version} in their tray menu within half an hour, or at their next start.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		await publishWorker();
	} catch (err) {
		console.error(`\n${err.message}\n`);
		process.exitCode = 1;
	}
}
