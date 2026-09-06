#!/usr/bin/env node
// One-time consent for each platform, run as:
//
//   pnpm worker:auth                    Google, for YouTube
//   pnpm worker:auth --tiktok           TikTok's Login Kit
//   pnpm worker:auth --instagram        Instagram Login
//   pnpm worker:auth --instagram --token <token>
//                                       a token generated in the Meta dashboard
//
// Each prints a consent URL, collects the code the platform redirects back
// with, and writes the resulting token into worker/.worker-config.json.
//
// Google's out-of-band flow is long gone, so a Desktop-app client with a
// localhost redirect is the supported route there — that client type does
// not need the port registering in the console, so a listener on any free
// port does. TikTok and Instagram both require the redirect URI to be
// registered on the app in advance and may refuse a localhost one, so for
// those the configured URI decides: a loopback address is listened on, and
// anything else is handled by pasting the address of the page the browser
// lands on — the code is in its query string whether or not the page loads.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig, requireConfig, saveRefreshToken, saveSection, CONFIG_PATH } from './config.mjs';
import { TIKTOK_SCOPES, creatorInfo, privacyLabel } from './tiktok.mjs';
import { INSTAGRAM_SCOPES, accountInfo } from './instagram.mjs';
import { fetchOrExplain } from './net.mjs';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const TIKTOK_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const INSTAGRAM_AUTH = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_GRAPH = 'https://graph.instagram.com';

/**
 * Google: upload plus read-only by default, deliberately.
 *
 * `youtube.upload` is exactly what videos.insert needs and nothing more — it
 * cannot edit or delete anything on the channel. `youtube.readonly` is the
 * scope Google documents for reading the channel and its counters, and it can
 * change nothing; an upload-only grant has read them fine in practice, but that
 * is not the documented behaviour, so it is asked for. Adding a video to a
 * playlist needs `youtube`, which the consent screen describes as "see, edit,
 * and permanently delete your YouTube videos, ratings, comments and
 * captions". There is no narrower playlist scope, so that convenience is not
 * worth handing a publishing tool delete rights by default.
 *
 * Pass --with-playlists to opt into the broader grant.
 */
const GOOGLE_DEFAULT = [
	'https://www.googleapis.com/auth/youtube.upload',
	'https://www.googleapis.com/auth/youtube.readonly'
];
const GOOGLE_WITH_PLAYLISTS = [...GOOGLE_DEFAULT, 'https://www.googleapis.com/auth/youtube'];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
	const at = argv.indexOf(flag);
	return at >= 0 ? (argv[at + 1] ?? '') : '';
};

function reply(res, status, title, body) {
	res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
	res.end(
		'<!doctype html><meta charset="utf-8"><title>flock</title>' +
			'<body style="font:15px system-ui;padding:3rem;max-width:34rem;margin:auto">' +
			`<h1 style="font-size:1.2rem">${title}</h1><p>${body}</p></body>`
	);
}

/** { port, path } for http://localhost[:port]/path or 127.0.0.1, else null. */
function parseLoopback(uri) {
	if (!uri) return null;
	try {
		const url = new URL(uri);
		if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) return null;
		return { port: Number(url.port) || 80, path: url.pathname || '/' };
	} catch {
		return null;
	}
}

/**
 * Listens on a loopback address and resolves with the code the redirect
 * carries. Port 0 lets the OS pick one; `onReady` gets the port actually
 * bound, so the URL printed can name it.
 */
function listenForCode({ port, path, state, onReady }) {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname !== path) {
				reply(res, 404, 'Not here', 'Nothing at this path.');
				return;
			}

			const error = url.searchParams.get('error');
			if (error) {
				const why = url.searchParams.get('error_description') ?? '';
				reply(res, 400, 'Authorisation refused', `The platform said: ${error} ${why}`);
				server.close();
				reject(new Error(`Authorisation refused: ${error} ${why}`.trim()));
				return;
			}
			if (url.searchParams.get('state') !== state) {
				reply(res, 400, 'State mismatch', 'That did not come from this run. Start again.');
				server.close();
				reject(new Error('State mismatch — nothing was saved.'));
				return;
			}

			reply(res, 200, 'flock is authorised', 'Close this tab and go back to the terminal.');
			server.close();
			resolve(url.searchParams.get('code'));
		});

		server.on('error', reject);
		server.listen(port, '127.0.0.1', () => onReady(server.address().port));
	});
}

/**
 * Asks for the address of the page the browser landed on and pulls the code
 * out of it. A bare code pasted on its own is accepted too.
 */
async function askForCode(state) {
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		for (;;) {
			const answer = (
				await rl.question('\nPaste the full address of the page you landed on (or just the code): ')
			).trim();
			if (!answer) continue;

			let code = answer;
			let got = null;
			try {
				const url = new URL(answer);
				const error = url.searchParams.get('error');
				if (error) {
					throw new Error(
						`Authorisation refused: ${error} ${url.searchParams.get('error_description') ?? ''}`.trim()
					);
				}
				code = url.searchParams.get('code') ?? '';
				got = url.searchParams.get('state');
			} catch (err) {
				if (String(err.message).startsWith('Authorisation refused')) throw err;
				// Not an address: treat the whole answer as the code.
			}

			if (!code) {
				console.log('There is no code in that. Try again.');
				continue;
			}
			if (got !== null && got !== state) throw new Error('State mismatch — nothing was saved.');
			return code;
		}
	} finally {
		rl.close();
	}
}

/**
 * Runs one consent: prints the URL, then collects the code however the
 * redirect URI allows. With no redirect URI configured (Google), a listener
 * on a free port stands in, and its address is what the token exchange must
 * repeat byte for byte.
 */
async function obtainCode({ buildUrl, redirectUri, state, intro }) {
	const loopback = parseLoopback(redirectUri);
	if (!redirectUri || loopback) {
		let resolvedUri = redirectUri;
		const code = await listenForCode({
			port: loopback?.port ?? 0,
			path: loopback?.path ?? '/',
			state,
			onReady: (port) => {
				if (!redirectUri) resolvedUri = `http://localhost:${port}`;
				console.log(intro);
				console.log('\nOpen this in a browser signed in to the account:\n');
				console.log(buildUrl(resolvedUri) + '\n');
				console.log('Waiting for the redirect...');
			}
		});
		return { code, redirectUri: resolvedUri };
	}

	console.log(intro);
	console.log('\nOpen this in a browser signed in to the account:\n');
	console.log(buildUrl(redirectUri) + '\n');
	console.log(`It will send the browser to ${redirectUri}. That page need not load —`);
	console.log('the code is in the address bar either way.');
	const code = await askForCode(state);
	return { code, redirectUri };
}

async function google(config) {
	const withPlaylists = has('--with-playlists');
	const scopes = withPlaylists ? GOOGLE_WITH_PLAYLISTS : GOOGLE_DEFAULT;
	const state = randomBytes(16).toString('hex');

	const flow = await obtainCode({
		redirectUri: '',
		state,
		intro: withPlaylists
			? '\nRequesting upload + read-only + full account access (needed for "Add to playlist").'
			: '\nRequesting upload and read-only access. Re-run with --with-playlists if you\n' +
				'want the "Add to playlist" option to work; it needs far broader permission.',
		buildUrl: (redirectUri) => {
			const auth = new URL(GOOGLE_AUTH);
			auth.searchParams.set('client_id', config.google.clientId);
			auth.searchParams.set('redirect_uri', redirectUri);
			auth.searchParams.set('response_type', 'code');
			auth.searchParams.set('scope', scopes.join(' '));
			// offline + consent together are what guarantee a refresh token comes
			// back at all. Without prompt=consent a repeat authorisation returns
			// none, leaving the worker an access token that dies within the hour.
			auth.searchParams.set('access_type', 'offline');
			auth.searchParams.set('prompt', 'consent');
			auth.searchParams.set('state', state);
			return auth.toString();
		}
	});

	const res = await fetch(GOOGLE_TOKEN, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code: flow.code,
			client_id: config.google.clientId,
			client_secret: config.google.clientSecret,
			redirect_uri: flow.redirectUri,
			grant_type: 'authorization_code'
		})
	});

	const text = await res.text();
	if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${text}`);

	const body = JSON.parse(text);
	if (!body.refresh_token) {
		throw new Error(
			'Google returned no refresh token.\n' +
				'That happens when this client was already authorised. Revoke flock at\n' +
				'https://myaccount.google.com/permissions and run this again.'
		);
	}

	saveRefreshToken(body.refresh_token);
	console.log(`\nRefresh token saved to ${CONFIG_PATH}`);
	console.log('Check it end to end with:  pnpm worker:once\n');
}

async function tiktok(config) {
	const t = config.tiktok;
	const missing = ['clientKey', 'clientSecret', 'redirectUri'].filter((key) => !t[key]);
	if (missing.length > 0) {
		throw new Error(
			`Missing tiktok.${missing.join(', tiktok.')} in ${CONFIG_PATH}.\n` +
				'The client key and secret are on the app at developers.tiktok.com; the redirect URI\n' +
				'must be one registered there under Login Kit, character for character.'
		);
	}

	const state = randomBytes(16).toString('hex');
	// PKCE, which TikTok requires of desktop apps and accepts from web ones.
	// Their challenge is the SHA-256 of the verifier as hex, not base64url.
	const pkce = !has('--no-pkce');
	const verifier = randomBytes(48).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('hex');

	const flow = await obtainCode({
		redirectUri: t.redirectUri,
		state,
		intro: `\nRequesting TikTok scopes: ${TIKTOK_SCOPES.join(', ')}`,
		buildUrl: (redirectUri) => {
			const auth = new URL(TIKTOK_AUTH);
			auth.searchParams.set('client_key', t.clientKey);
			auth.searchParams.set('scope', TIKTOK_SCOPES.join(','));
			auth.searchParams.set('response_type', 'code');
			auth.searchParams.set('redirect_uri', redirectUri);
			auth.searchParams.set('state', state);
			if (pkce) {
				auth.searchParams.set('code_challenge', challenge);
				auth.searchParams.set('code_challenge_method', 'S256');
			}
			return auth.toString();
		}
	});

	const res = await fetchOrExplain(TIKTOK_TOKEN, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_key: t.clientKey,
			client_secret: t.clientSecret,
			code: flow.code,
			grant_type: 'authorization_code',
			redirect_uri: flow.redirectUri,
			...(pkce ? { code_verifier: verifier } : {})
		})
	});
	const text = await res.text();
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		// Reported below as the raw text.
	}
	if (!res.ok || !body.access_token) {
		throw new Error(
			`TikTok token exchange failed (${body.error || res.status}): ${body.error_description || text}` +
				(pkce ? '\n\nIf TikTok objects to the code_verifier or code_challenge, re-run with --no-pkce.' : '')
		);
	}
	if (!body.refresh_token) throw new Error('TikTok returned no refresh token.');

	saveSection('tiktok', {
		refreshToken: body.refresh_token,
		openId: body.open_id ?? '',
		scope: body.scope ?? ''
	});
	config.tiktok.refreshToken = body.refresh_token;
	console.log(`\nRefresh token saved to ${CONFIG_PATH} (scopes: ${body.scope || 'not reported'})`);
	if (!String(body.scope ?? '').includes('video.publish')) {
		console.log('WARNING: video.publish was not granted — posting will fail until it is.');
	}

	try {
		const creator = await creatorInfo(config);
		const audiences = creator.privacyOptions.map(privacyLabel).join(', ') || 'none reported';
		console.log(
			`Posting as ${creator.nickname} (@${creator.username}); audiences offered: ${audiences}` +
				(creator.maxDurationSeconds ? `; videos up to ${creator.maxDurationSeconds}s` : '')
		);
	} catch (err) {
		console.log(`Token saved, but reading the creator failed: ${err.message}`);
	}
	console.log('Check the queue with:  pnpm worker:dry\n');
}

async function instagram(config) {
	const ig = config.instagram;
	const pasted = valueOf('--token');
	if (has('--token') && !pasted) throw new Error('--token needs the token after it.');

	let token = pasted;
	let expiresIn = 60 * 24 * 3600;
	let userId = '';

	if (!token) {
		const missing = ['appId', 'appSecret', 'redirectUri'].filter((key) => !ig[key]);
		if (missing.length > 0) {
			throw new Error(
				`Missing instagram.${missing.join(', instagram.')} in ${CONFIG_PATH}.\n` +
					'Either fill those in for the consent flow, or generate a token in the Meta app\n' +
					'dashboard (Instagram, API setup with Instagram login, Generate token) and run:\n' +
					'  pnpm worker:auth --instagram --token <paste>'
			);
		}

		const state = randomBytes(16).toString('hex');
		const flow = await obtainCode({
			redirectUri: ig.redirectUri,
			state,
			intro: `\nRequesting Instagram scopes: ${INSTAGRAM_SCOPES.join(', ')}`,
			buildUrl: (redirectUri) => {
				const auth = new URL(INSTAGRAM_AUTH);
				auth.searchParams.set('client_id', ig.appId);
				auth.searchParams.set('redirect_uri', redirectUri);
				auth.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
				auth.searchParams.set('response_type', 'code');
				auth.searchParams.set('state', state);
				return auth.toString();
			}
		});

		// A short-lived token first, good for an hour...
		const res = await fetchOrExplain(INSTAGRAM_TOKEN, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: ig.appId,
				client_secret: ig.appSecret,
				grant_type: 'authorization_code',
				redirect_uri: flow.redirectUri,
				code: flow.code
			})
		});
		const text = await res.text();
		let body = {};
		try {
			body = JSON.parse(text);
		} catch {
			// Reported below as the raw text.
		}
		if (!res.ok || !body.access_token) {
			throw new Error(
				`Instagram code exchange failed (${res.status}): ` +
					`${body.error_message || body.error?.message || text}`
			);
		}
		userId = String(body.user_id ?? '');

		// ...then the long-lived one, which is the only kind that can be renewed.
		const long = new URL(`${INSTAGRAM_GRAPH}/access_token`);
		long.searchParams.set('grant_type', 'ig_exchange_token');
		long.searchParams.set('client_secret', ig.appSecret);
		long.searchParams.set('access_token', body.access_token);
		const res2 = await fetchOrExplain(long);
		const text2 = await res2.text();
		let body2 = {};
		try {
			body2 = JSON.parse(text2);
		} catch {
			// Reported below as the raw text.
		}
		if (!res2.ok || !body2.access_token) {
			throw new Error(
				`Instagram long-lived exchange failed (${res2.status}): ${body2.error?.message || text2}`
			);
		}
		token = body2.access_token;
		expiresIn = Number(body2.expires_in) || expiresIn;
	}

	const now = new Date();
	const saved = {
		accessToken: token,
		tokenObtainedAt: now.toISOString(),
		tokenExpiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
		...(userId ? { userId } : {})
	};
	saveSection('instagram', saved);
	Object.assign(config.instagram, saved);
	console.log(`\nAccess token saved to ${CONFIG_PATH}`);

	try {
		const account = await accountInfo(config);
		saveSection('instagram', { userId: account.userId, username: account.username });
		console.log(
			`Posting as @${account.username} (${account.accountType || 'account type unknown'}` +
				(account.quotaTotal ? `; ${account.quotaUsed} of ${account.quotaTotal} posts used today` : '') +
				')'
		);
		if (account.accountType && !/BUSINESS|CREATOR/i.test(account.accountType)) {
			console.log(
				'WARNING: not a professional account. Instagram publishes through the API only for\n' +
					'Business or Creator accounts; switch it in the Instagram app under Account type.'
			);
	}
	} catch (err) {
		console.log(`Token saved, but reading the account failed: ${err.message}`);
	}
	console.log('Check the queue with:  pnpm worker:dry\n');
}

async function run() {
	if (has('--tiktok')) return tiktok(loadConfig());
	if (has('--instagram')) return instagram(loadConfig());
	return google(requireConfig({ needToken: false }));
}

run().catch((err) => {
	console.error(`\n${err instanceof Error ? err.message : err}\n`);
	process.exit(1);
});
