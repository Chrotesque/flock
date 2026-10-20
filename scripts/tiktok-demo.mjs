#!/usr/bin/env node
// The TikTok demo: a sign-in that asks for the Dashboard's reading scopes
// (video.list, user.info.stats), then a read of the signed-in accounts'
// videos and followers into PocketBase — through a worker config of its own,
// worker/.worker-config.demo.json (gitignored), so the demo never touches the
// live worker's config or its rotating TikTok refresh tokens. Meant for an
// app's TikTok sandbox, which can grant scopes the live app has not been
// approved for yet.
//
//   pnpm tiktok:demo init      write the demo config: the TikTok app's key, secret and
//                              redirect URI and the PocketBase address, copied from
//                              worker/.worker-config.json (or --from <file>); nothing else
//   pnpm tiktok:demo sign-in   TikTok's consent, asking for video.list and user.info.stats too
//   pnpm tiktok:demo read      one read of the demo accounts' videos and followers
//   pnpm tiktok:demo check     who each demo account is, and what its sign-in allows
//
// Nothing else is offered on purpose: a polling worker on this config would
// take up the queue's TikTok posts and refuse them as accounts it holds no
// token for, and its account pass would remove the live accounts' rows.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = resolve(root, 'worker', '.worker-config.demo.json');
const [command, ...rest] = process.argv.slice(2);

function run(script, args) {
	if (!existsSync(DEMO)) {
		console.error(`No demo config at ${DEMO}. Run:  pnpm tiktok:demo init`);
		process.exitCode = 1;
		return;
	}
	const res = spawnSync(process.execPath, [resolve(root, 'worker', script), ...args], {
		stdio: 'inherit',
		env: { ...process.env, FLOCK_WORKER_CONFIG: DEMO }
	});
	process.exitCode = res.status ?? 1;
}

function init() {
	const at = rest.indexOf('--from');
	const from = resolve(at >= 0 && rest[at + 1] ? rest[at + 1] : resolve(root, 'worker', '.worker-config.json'));
	if (existsSync(DEMO) && !rest.includes('--force')) {
		console.log(`${DEMO} exists already (its signed-in accounts are kept). Add --force to write it again.`);
		return;
	}
	const source = existsSync(from) ? JSON.parse(readFileSync(from, 'utf8')) : {};
	const tiktok = source.tiktok ?? {};
	const demo = {
		pocketbaseUrl: source.pocketbaseUrl || 'http://<pocketbase-host>:8091',
		// Read-only commands only (see above); no preview server, no other platform.
		previewPort: 0,
		ttStatsPosts: 100,
		tiktok: {
			clientKey: tiktok.clientKey || 'PASTE-SANDBOX-CLIENT-KEY',
			clientSecret: tiktok.clientSecret || 'PASTE-SANDBOX-CLIENT-SECRET',
			redirectUri: tiktok.redirectUri || 'http://localhost:8765/tiktok',
			accounts: []
		}
	};
	writeFileSync(DEMO, `${JSON.stringify(demo, null, 2)}\n`);
	console.log(`Wrote ${DEMO}${existsSync(from) ? `, from ${from}` : ''}.`);
	// TikTok's sandbox keys start "sb"; the live app's key cannot grant the new scopes before review.
	if (!String(demo.tiktok.clientKey).startsWith('sb')) {
		console.log(
			'\nThe TikTok client key does not look like a sandbox key. Put the Sandbox tab\'s client key and\n' +
				'secret (developers.tiktok.com, your app, Sandbox) into tiktok.clientKey / tiktok.clientSecret there,\n' +
				'with video.list and user.info.stats added to the sandbox and the account as a target user.'
		);
	}
	console.log('\nNext:  pnpm tiktok:demo sign-in');
}

switch (command) {
	case 'init':
		init();
		break;
	case 'sign-in':
		run('authorize.mjs', ['--tiktok', '--with-stats', ...rest]);
		break;
	case 'read':
		run('index.mjs', ['--stats']);
		break;
	case 'check':
		run('index.mjs', ['--tiktok']);
		break;
	default:
		console.log('Usage: pnpm tiktok:demo init | sign-in | read | check');
		process.exitCode = command ? 1 : 0;
}
