// Worker configuration: where flock's PocketBase is, and the Google OAuth
// client the YouTube adapter authenticates with.
//
// Values come from worker/.worker-config.json (gitignored) or the matching
// environment variables, same convention as scripts/.pb-creds.json. The refresh
// token is not something to fill in by hand — `pnpm worker:auth` writes it back
// into the file after the consent flow.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = resolve(here, '.worker-config.json');

function readFile() {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
	} catch (err) {
		throw new Error(`${CONFIG_PATH} is not valid JSON: ${err.message}`);
	}
}

export function loadConfig() {
	const file = readFile();
	const google = file.google ?? {};
	return {
		// Trailing slashes would double up in every request path.
		pocketbaseUrl: (process.env.FLOCK_PB_URL || file.pocketbaseUrl || '').replace(/\/+$/, ''),
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || google.clientId || '',
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || google.clientSecret || '',
			refreshToken: process.env.GOOGLE_REFRESH_TOKEN || google.refreshToken || ''
		},
		pollSeconds: Number(process.env.FLOCK_POLL_SECONDS || file.pollSeconds || 60),
		// Scoring is answered on its own, much faster tick: a person is watching
		// the button spin, where nobody is watching an upload queue.
		scoreSeconds: Number(process.env.FLOCK_SCORE_SECONDS || file.scoreSeconds || 3),
		vidiqKey: process.env.VIDIQ_API_KEY || file.vidiqKey || ''
	};
}

/** Writes the refresh token back, leaving everything else in the file alone. */
export function saveRefreshToken(token) {
	const file = readFile();
	file.google = { ...(file.google ?? {}), refreshToken: token };
	writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + '\n');
}

/**
 * `needGoogle` is off for a dry run, which only reads PocketBase — being able
 * to check the queue before any credentials exist is most of the point of it.
 */
export function requireConfig({ needToken = true, needGoogle = true } = {}) {
	const config = loadConfig();
	const missing = [];
	if (!config.pocketbaseUrl) missing.push('pocketbaseUrl');
	if (needGoogle && !config.google.clientId) missing.push('google.clientId');
	if (needGoogle && !config.google.clientSecret) missing.push('google.clientSecret');
	if (needToken && !config.google.refreshToken) missing.push('google.refreshToken');

	if (missing.length > 0) {
		const hint = missing.includes('google.refreshToken')
			? '\n\nFor the refresh token specifically, run:  pnpm worker:auth'
			: '';
		throw new Error(
			`Missing worker configuration: ${missing.join(', ')}\n` +
				`Expected in ${CONFIG_PATH}\n` +
				`Copy worker/.worker-config.example.json and fill it in.${hint}`
		);
	}
	return config;
}
