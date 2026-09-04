#!/usr/bin/env node
// One-time Google consent, run as:  pnpm worker:auth
//
// Opens a loopback listener, prints the consent URL, and writes the resulting
// refresh token into worker/.worker-config.json. Google's out-of-band flow is
// long gone, so a Desktop-app client with a localhost redirect is the supported
// route — that client type does not need the port registering in the console.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { requireConfig, saveRefreshToken, CONFIG_PATH } from './config.mjs';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Upload plus read-only by default, deliberately.
 *
 * `youtube.upload` is exactly what videos.insert needs and nothing more — it
 * cannot edit or delete anything on the channel. `youtube.readonly` is the
 * scope Google documents for reading the channel and its counters, and it can
 * change nothing; an upload-only grant has read them fine in practice, but that
 * is not the documented behaviour, so it is asked for. Adding a video to a
 * playlist needs `youtube`, which the
 * consent screen describes as "see, edit, and permanently delete your YouTube
 * videos, ratings, comments and captions". There is no narrower playlist
 * scope, so that convenience is not worth handing a publishing tool delete
 * rights by default.
 *
 * Pass --with-playlists to opt into the broader grant.
 */
const DEFAULT = [
	'https://www.googleapis.com/auth/youtube.upload',
	'https://www.googleapis.com/auth/youtube.readonly'
];
const WITH_PLAYLISTS = [...DEFAULT, 'https://www.googleapis.com/auth/youtube'];

const withPlaylists = process.argv.includes('--with-playlists');
const SCOPES = withPlaylists ? WITH_PLAYLISTS : DEFAULT;

function reply(res, status, title, body) {
	res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
	res.end(
		'<!doctype html><meta charset="utf-8"><title>flock</title>' +
			'<body style="font:15px system-ui;padding:3rem;max-width:34rem;margin:auto">' +
			`<h1 style="font-size:1.2rem">${title}</h1><p>${body}</p></body>`
	);
}

/**
 * Listens on a loopback port, prints the consent URL, resolves with the code.
 *
 * The redirect URI is captured out of the same closure that built it, because
 * the token exchange has to present a byte-identical value.
 */
function getCode(clientId) {
	const state = randomBytes(16).toString('hex');
	let redirectUri = '';

	const code = new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname !== '/') {
				reply(res, 404, 'Not here', 'Nothing at this path.');
				return;
			}

			const error = url.searchParams.get('error');
			if (error) {
				reply(res, 400, 'Authorisation refused', `Google said: ${error}`);
				server.close();
				reject(new Error(`Authorisation refused: ${error}`));
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

		// Port 0 lets the OS pick one; Desktop clients accept any loopback port.
		server.listen(0, '127.0.0.1', () => {
			redirectUri = `http://localhost:${server.address().port}`;

			const auth = new URL(AUTH_URL);
			auth.searchParams.set('client_id', clientId);
			auth.searchParams.set('redirect_uri', redirectUri);
			auth.searchParams.set('response_type', 'code');
			auth.searchParams.set('scope', SCOPES.join(' '));
			// offline + consent together are what guarantee a refresh token comes
			// back at all. Without prompt=consent a repeat authorisation returns
			// none, leaving the worker an access token that dies within the hour.
			auth.searchParams.set('access_type', 'offline');
			auth.searchParams.set('prompt', 'consent');
			auth.searchParams.set('state', state);

			console.log(
				withPlaylists
					? '\nRequesting upload + read-only + full account access (needed for "Add to playlist").'
					: '\nRequesting upload and read-only access. Re-run with --with-playlists if you\n' +
							'want the "Add to playlist" option to work; it needs far broader permission.'
			);
			console.log('\nOpen this in a browser signed in to the YouTube channel:\n');
			console.log(auth.toString() + '\n');
			console.log('Waiting for the redirect...');
		});
	});

	return { code, redirectUri: () => redirectUri };
}

async function run() {
	const config = requireConfig({ needToken: false });

	const flow = getCode(config.google.clientId);
	const code = await flow.code;

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: config.google.clientId,
			client_secret: config.google.clientSecret,
			redirect_uri: flow.redirectUri(),
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

run().catch((err) => {
	console.error(`\n${err instanceof Error ? err.message : err}\n`);
	process.exit(1);
});
