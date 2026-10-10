#!/usr/bin/env node
// One-time consent for each platform, run as:
//
//   pnpm worker:auth                    Google, for YouTube
//   pnpm worker:auth --tiktok           TikTok's Login Kit
//   pnpm worker:auth --instagram --token
//                                       Instagram, from a user token made in
//                                       the Graph API Explorer and pasted at
//                                       the prompt (or given after --token)
//   pnpm worker:auth --instagram        Instagram through the Facebook Login
//                                       for Business consent instead
//
// Each prints a consent URL, collects the code the platform redirects back
// with, and writes the resulting token into worker/.worker-config.json.
//
// For Instagram the Explorer is the usual route: Facebook Login for Business
// asks for Advanced Access on public_profile, which Meta ties to Business
// Verification, while the Explorer works for anyone with a role on the app
// and ends in the same Page token.
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
import {
	loadConfig,
	requireConfig,
	saveRefreshToken,
	saveSection,
	saveInstagramAccounts,
	CONFIG_PATH
} from './config.mjs';
import { mergeAccounts, parseChoice } from './accounts.mjs';
import { TIKTOK_SCOPES, creatorInfo, privacyLabel } from './tiktok.mjs';
import {
	INSTAGRAM_PERMISSIONS,
	INSTAGRAM_SCOPES,
	accountInfo,
	checkGrant,
	grantedPermissions,
	listPages
} from './instagram.mjs';
import { fetchOrExplain } from './net.mjs';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const TIKTOK_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const FACEBOOK_GRAPH = 'https://graph.facebook.com';

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

/** One Graph call during the consent, with its error spelled out. */
async function graphGet(url, what) {
	const res = await fetchOrExplain(url);
	const text = await res.text();
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		// Reported below as the raw text.
	}
	if (!res.ok || body.error) {
		throw new Error(`${what} failed (${res.status}): ${body.error?.message || text.slice(0, 300)}`);
	}
	return body;
}

/** A user token good for sixty days, from a short-lived one. Needs the app secret. */
async function longLivedUserToken(ig, short) {
	const url = new URL(`${FACEBOOK_GRAPH}/${ig.apiVersion}/oauth/access_token`);
	url.searchParams.set('grant_type', 'fb_exchange_token');
	url.searchParams.set('client_id', ig.appId);
	url.searchParams.set('client_secret', ig.appSecret);
	url.searchParams.set('fb_exchange_token', short);
	const body = await graphGet(url, 'Long-lived token exchange');
	return body.access_token;
}

/**
 * Walks through making a user token in the Graph API Explorer and asks for it.
 * Asked for rather than taken from the command line, so the token stays out
 * of the shell's history.
 */
async function askForExplorerToken() {
	const width = Math.max(...INSTAGRAM_PERMISSIONS.map((p) => p.name.length));
	console.log('\nMake a user token in the Graph API Explorer:\n');
	console.log('  1. Open https://developers.facebook.com/tools/explorer');
	console.log('  2. On the right, set "Meta App" to your app and choose "User Token".');
	console.log('  3. Under "Permissions", add each of these:\n');
	for (const p of INSTAGRAM_PERMISSIONS) {
		console.log(`       ${p.name.padEnd(width)}  ${p.use}${p.required ? '' : ' (optional)'}`);
	}
	console.log('\n  4. Click "Generate Access Token" and allow the Page and the Instagram account.');
	console.log('  5. Copy the token from the "Access Token" field and paste it here.');
	console.log('\n  If instagram_content_publish is not in the list, the app lacks the Instagram');
	console.log('  product set up for Facebook login.');

	const rl = createInterface({ input: stdin, output: stdout });
	try {
		for (;;) {
			const answer = (await rl.question('\nToken: ')).trim();
			if (answer) return answer;
		}
	} finally {
		rl.close();
	}
}

/**
 * Stops before anything is saved when the token lacks a permission flock
 * cannot post without, and says what an optional one's absence will cost.
 * A failed check is reported and passed: Instagram's own answers later name
 * any missing permission too.
 */
async function checkInstagramGrant(ig, userToken, fromExplorer) {
	let grant;
	try {
		grant = checkGrant(await grantedPermissions(ig.apiVersion, userToken));
	} catch (err) {
		console.log(`Could not read which permissions were granted: ${err.message}`);
		return;
	}
	for (const p of grant.optional) console.log(`Not granted: ${p.name} — ${p.without}.`);
	if (grant.missing.length > 0) {
		throw new Error(
			`The token lacks ${grant.missing.map((p) => p.name).join(', ')}, which flock cannot post without. ` +
				'Nothing was saved.\n' +
				(fromExplorer
					? 'Generate a new token in the Graph API Explorer with them added, and run this again.'
					: 'Run this again and leave them ticked on the consent screen.')
		);
	}
}

/**
 * Picks the Pages whose Instagram accounts flock may post to, asking when
 * there is a choice: one answer can take several ("1,2") or all of them. The
 * ones already connected are marked, since running this again is also how a
 * token is refreshed.
 */
async function choosePages(ig, pages) {
	const linked = pages.filter((page) => page.igUserId);
	if (linked.length === 0) {
		const names = pages.map((p) => `"${p.name}"`).join(', ') || 'none';
		throw new Error(
			`None of the Pages granted has an Instagram account linked (Pages: ${names}).\n` +
				'Link the Instagram account to a Facebook Page (Instagram app: Settings, Accounts Center,\n' +
				'or the Page\'s settings, Linked accounts), make sure that Page was ticked on the consent\n' +
				'screen, and run this again.'
		);
	}
	if (linked.length === 1) return linked;

	const known = new Set(ig.accounts.map((a) => a.igUserId));
	console.log('\nThese Pages have an Instagram account:');
	linked.forEach((p, i) =>
		console.log(`  ${i + 1}. ${p.name}  ->  @${p.username}${known.has(p.igUserId) ? '   (connected)' : ''}`)
	);
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		for (;;) {
			const picked = parseChoice(
				await rl.question('Which should flock post to? Numbers separated by commas, or "all": '),
				linked.length
			);
			if (picked) return picked.map((i) => linked[i]);
		}
	} finally {
		rl.close();
	}
}

/**
 * Instagram through Facebook Login. A user token — made in the Graph API
 * Explorer with `--token`, or from the Facebook Login for Business consent
 * without it — is swapped for a sixty-day one; the Page tokens taken from
 * that do not expire, and they are the only tokens kept, one per account
 * chosen. Accounts are added to the list (or refreshed), never dropped: one
 * Facebook login can connect several Instagram accounts at once.
 */
async function instagram(config) {
	const ig = config.instagram;
	const fromExplorer = has('--token');
	const given = valueOf('--token');

	const missing = ['appId', 'appSecret'].filter((key) => !ig[key]);
	if (missing.length > 0) {
		throw new Error(
			`Missing instagram.${missing.join(', instagram.')} in ${CONFIG_PATH}.\n` +
				"These are the Meta app's own App ID and App secret (App settings, Basic)."
		);
	}

	let userToken;
	if (fromExplorer) {
		// A value after --token is taken as it is; the next flag is not a token.
		const pasted = given && !given.startsWith('--') ? given : await askForExplorerToken();
		userToken = await longLivedUserToken(ig, pasted);
	} else {
		const state = randomBytes(16).toString('hex');
		const flow = await obtainCode({
			redirectUri: ig.redirectUri,
			state,
			intro: ig.configId
				? `\nRequesting the permissions in Facebook Login configuration ${ig.configId}`
				: `\nRequesting: ${INSTAGRAM_SCOPES.join(', ')}`,
			buildUrl: (redirectUri) => {
				const auth = new URL(`https://www.facebook.com/${ig.apiVersion}/dialog/oauth`);
				auth.searchParams.set('client_id', ig.appId);
				auth.searchParams.set('redirect_uri', redirectUri);
				auth.searchParams.set('state', state);
				auth.searchParams.set('response_type', 'code');
				if (ig.configId) auth.searchParams.set('config_id', ig.configId);
				else auth.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
				return auth.toString();
			}
		});

		const exchange = new URL(`${FACEBOOK_GRAPH}/${ig.apiVersion}/oauth/access_token`);
		exchange.searchParams.set('client_id', ig.appId);
		exchange.searchParams.set('client_secret', ig.appSecret);
		exchange.searchParams.set('redirect_uri', flow.redirectUri);
		exchange.searchParams.set('code', flow.code);
		const short = (await graphGet(exchange, 'Code exchange')).access_token;
		userToken = await longLivedUserToken(ig, short);
	}

	await checkInstagramGrant(ig, userToken, fromExplorer);
	const pages = await choosePages(ig, await listPages(ig.apiVersion, userToken));
	const tokenless = pages.filter((page) => !page.accessToken);
	if (tokenless.length > 0) {
		throw new Error(
			`Facebook returned no token for ${tokenless.map((p) => `"${p.name}"`).join(', ')}; ` +
				'does this Facebook account manage those Pages? Nothing was saved.'
		);
	}

	const chosen = pages.map((page) => ({
		igUserId: page.igUserId,
		username: page.username,
		pageId: page.id,
		pageName: page.name,
		pageAccessToken: page.accessToken
	}));
	const accounts = mergeAccounts(ig.accounts, chosen, (a) => a.igUserId);
	saveInstagramAccounts(accounts);
	console.log(
		`\nSaved to ${CONFIG_PATH} — ${accounts.length} Instagram account` +
			`${accounts.length === 1 ? '' : 's'} connected (Page tokens do not expire):`
	);

	for (const account of accounts) {
		const fresh = chosen.some((c) => c.igUserId === account.igUserId);
		try {
			const info = await accountInfo({ ...account, apiVersion: ig.apiVersion });
			console.log(
				`  @${info.username} through the Page "${account.pageName}"` +
					(info.quotaTotal ? ` — ${info.quotaUsed} of ${info.quotaTotal} posts used today` : '') +
					(fresh ? '' : '   (kept from before)')
			);
		} catch (err) {
			console.log(`  @${account.username}: saved, but reading the account failed: ${err.message.split('\n')[0]}`);
		}
	}
	console.log(
		'\nChoose which brand posts as which account in Settings → Brands once the worker has\n' +
			'run (it lists the accounts there). Check the queue with:  pnpm worker:dry\n'
	);
}

async function run() {
	if (has('--tiktok')) return tiktok(loadConfig());
	if (has('--instagram')) return instagram(loadConfig());
	return google(requireConfig({ needToken: false }));
}

// exitCode rather than process.exit(): on Windows, Node 24 aborts with a libuv
// assertion when exit() lands while fetch's sockets are still closing.
run().catch((err) => {
	console.error(`\n${err instanceof Error ? err.message : err}\n`);
	process.exitCode = 1;
});
