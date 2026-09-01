#!/usr/bin/env node
// Runs a PocketBase script with superuser credentials injected, so nobody has
// to paste them per-invocation. Same convention as cortex.
//
//   node scripts/runpb.mjs setup-pb.mjs [args...]
//
// Credentials come from scripts/.pb-creds.json (gitignored) or from the
// PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD environment variables.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const credsPath = resolve(here, '.pb-creds.json');

let creds = {};
if (existsSync(credsPath)) {
	creds = JSON.parse(readFileSync(credsPath, 'utf8'));
}

const url = process.env.PB_URL || creds.url;
const email = process.env.PB_ADMIN_EMAIL || creds.email;
const password = process.env.PB_ADMIN_PASSWORD || creds.password;

if (!url || !email || !password) {
	console.error(
		'Missing PocketBase credentials.\n' +
			'Create scripts/.pb-creds.json with { "url", "email", "password" },\n' +
			'or set PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD.'
	);
	process.exit(1);
}

const [script, ...rest] = process.argv.slice(2);
if (!script) {
	console.error('Usage: node scripts/runpb.mjs <script.mjs> [args...]');
	process.exit(1);
}

const target = resolve(here, script);
if (!existsSync(target)) {
	console.error(`No such script: ${target}`);
	process.exit(1);
}

// shell: true is required on Windows, where spawning without it throws ENOENT.
const res = spawnSync(process.execPath, [target, ...rest], {
	stdio: 'inherit',
	env: { ...process.env, PB_URL: url, PB_ADMIN_EMAIL: email, PB_ADMIN_PASSWORD: password }
});

process.exit(res.status ?? 1);
