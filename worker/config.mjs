// Worker configuration: where flock's PocketBase is, and the credentials each
// platform adapter authenticates with.
//
// Values come from worker/.worker-config.json (gitignored) or the matching
// environment variables, same convention as scripts/.pb-creds.json. The tokens
// are not something to fill in by hand — `pnpm worker:auth` (and its
// `--tiktok` / `--instagram` forms) write them back into the file after the
// consent flow, and the worker itself writes a rotated one back.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

/**
 * Where the config file lives. Beside this module when the worker runs from
 * the checkout; beside the program when it runs as the single-file executable
 * `pnpm build:worker` makes, where there is no module directory to speak of;
 * or wherever FLOCK_WORKER_CONFIG points, which is what a container will use.
 */
function configDir() {
	if (isSea()) return dirname(process.execPath);
	return dirname(fileURLToPath(import.meta.url));
}

export const CONFIG_PATH = process.env.FLOCK_WORKER_CONFIG
	? resolve(process.env.FLOCK_WORKER_CONFIG)
	: resolve(configDir(), '.worker-config.json');

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
	const tiktok = file.tiktok ?? {};
	const instagram = file.instagram ?? {};
	return {
		// Trailing slashes would double up in every request path.
		pocketbaseUrl: (process.env.FLOCK_PB_URL || file.pocketbaseUrl || '').replace(/\/+$/, ''),
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || google.clientId || '',
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || google.clientSecret || '',
			refreshToken: process.env.GOOGLE_REFRESH_TOKEN || google.refreshToken || ''
		},
		// TikTok's Login Kit issues a refresh token good for a year that may be
		// rotated on every refresh; the worker writes the new one back itself.
		tiktok: {
			clientKey: process.env.TIKTOK_CLIENT_KEY || tiktok.clientKey || '',
			clientSecret: process.env.TIKTOK_CLIENT_SECRET || tiktok.clientSecret || '',
			// Must be byte-identical to a redirect URI registered on the app.
			redirectUri: process.env.TIKTOK_REDIRECT_URI || tiktok.redirectUri || '',
			refreshToken: process.env.TIKTOK_REFRESH_TOKEN || tiktok.refreshToken || '',
			openId: tiktok.openId || '',
			scope: tiktok.scope || ''
		},
		// Instagram through Facebook Login: the Meta app's own id and secret
		// (App settings, Basic), and the Facebook Page the Instagram account is
		// linked to. The consent flow stores the Page's token, which does not
		// expire, so there is nothing to renew. `configId` is the Facebook
		// Login for Business configuration, when the app uses one; without it
		// the consent asks for the scopes directly. `pageId` picks a Page when
		// the person runs more than one with an Instagram account.
		instagram: {
			appId: process.env.INSTAGRAM_APP_ID || instagram.appId || '',
			appSecret: process.env.INSTAGRAM_APP_SECRET || instagram.appSecret || '',
			configId: process.env.INSTAGRAM_CONFIG_ID || instagram.configId || '',
			redirectUri:
				process.env.INSTAGRAM_REDIRECT_URI || instagram.redirectUri || 'http://localhost:8766/instagram',
			pageId: process.env.INSTAGRAM_PAGE_ID || instagram.pageId || '',
			pageName: instagram.pageName || '',
			pageAccessToken: process.env.INSTAGRAM_PAGE_TOKEN || instagram.pageAccessToken || '',
			igUserId: instagram.igUserId || '',
			username: instagram.username || '',
			apiVersion: instagram.apiVersion || 'v23.0'
		},
		pollSeconds: Number(process.env.FLOCK_POLL_SECONDS || file.pollSeconds || 60),
		// The hold-and-fire platforms are checked on their own, tighter tick, so
		// a release lands within seconds of its slot rather than within a poll.
		slotSeconds: Number(process.env.FLOCK_SLOT_SECONDS || file.slotSeconds || 15),
		// How far ahead of its slot an Instagram reel is uploaded, so the
		// container is processed and waiting when the minute comes.
		instagramLeadSeconds: Number(
			process.env.FLOCK_INSTAGRAM_LEAD_SECONDS ?? file.instagramLeadSeconds ?? 600
		),
		// Scoring is answered on its own, much faster tick: a person is watching
		// the button spin, where nobody is watching an upload queue.
		scoreSeconds: Number(process.env.FLOCK_SCORE_SECONDS || file.scoreSeconds || 3),
		// The Upload step plays listed videos from a loopback server of the
		// worker's own, on this port; 0 turns it off. `previewUrl` is what the
		// page is told to use instead of http://127.0.0.1:<port> — for when
		// something like Tailscale Serve fronts the port.
		previewPort: Number(process.env.FLOCK_PREVIEW_PORT ?? file.previewPort ?? 8790),
		previewUrl: (process.env.FLOCK_PREVIEW_URL || file.previewUrl || '').replace(/\/+$/, ''),
		vidiqKey: process.env.VIDIQ_API_KEY || file.vidiqKey || '',
		// The stats pass. One videos.list covers fifty videos for one unit, so the
		// interval alone sets the daily cost: 30s is 2,880 of the 10,000 units
		// that also pay 1,600 per upload. 0 turns the pass off.
		statsSeconds: Number(process.env.FLOCK_STATS_SECONDS ?? file.statsSeconds ?? 30),
		statsVideos: Number(process.env.FLOCK_STATS_VIDEOS ?? file.statsVideos ?? 50),
		// Units the pass may spend in a day before it pauses until Google's reset.
		statsBudget: Number(process.env.FLOCK_STATS_BUDGET ?? file.statsBudget ?? 6000)
	};
}

/**
 * Merges a patch into one section of the file, leaving everything else as it
 * was — including keys the worker does not know about. Used for the tokens
 * the consent flows produce and the ones the worker rotates on its own.
 */
export function saveSection(section, patch) {
	const file = readFile();
	file[section] = { ...(file[section] ?? {}), ...patch };
	writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + '\n');
}

/** Writes the Google refresh token back, leaving everything else in the file alone. */
export function saveRefreshToken(token) {
	saveSection('google', { refreshToken: token });
}

/** Whether the TikTok adapter has what it needs to publish. */
export function hasTikTok(config) {
	const t = config.tiktok;
	return Boolean(t.clientKey && t.clientSecret && t.refreshToken);
}

/** Whether the Instagram adapter has what it needs to publish. */
export function hasInstagram(config) {
	const ig = config.instagram;
	return Boolean(ig.pageAccessToken && ig.igUserId && ig.pageId);
}

/**
 * `needGoogle` is off for a dry run, which only reads PocketBase — being able
 * to check the queue before any credentials exist is most of the point of it.
 * TikTok and Instagram are never required here: each adapter is simply left
 * out until its credentials exist, and the loop says so.
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
