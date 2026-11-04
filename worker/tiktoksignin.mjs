// Signing a TikTok account in from flock's page instead of a terminal.
//
// The client secret stays here, so the page only asks and hands back:
//
//   page    app_settings / tiktok_signin = { id, status: 'pending', redirect, requestedAt, by }
//   worker  status 'open' with TikTok's consent address (`url`); the check
//           value and the PKCE verifier stay in this process's memory
//   page    opens it; TikTok sends the browser to `redirect` (flock's
//           /connect/tiktok), which writes status 'code' with code and state
//   worker  exchanges the code, saves the account like `worker:auth --tiktok`
//           and writes 'done' (or 'failed')
//
// A code is worth nothing without the secret and the verifier, so it may sit
// in the open-rules row for the seconds it takes. Which worker answers:
// one whose config has `tiktok.pageSignin` ("stats" asks for the Dashboard's
// reading scopes too), or the TikTok demo's `--tiktok-signins` mode, which
// holds `tiktok_signin_host` while it runs so the publishing worker leaves
// the sign-ins to it (the sandbox key can grant scopes the live app cannot).

import { createHash, randomBytes } from 'node:crypto';
import { mergeAccounts } from './accounts.mjs';
import { saveTikTokAccounts } from './config.mjs';
import { TIKTOK_STATS_SCOPES, creatorInfo, hasScope, tiktokScopes } from './tiktok.mjs';
import { fetchOrExplain } from './net.mjs';

export const TIKTOK_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';

export const SIGNIN_KEY = 'tiktok_signin';
export const HOST_KEY = 'tiktok_signin_host';
/** A request nobody took up within this is given up on. */
export const ASK_MAX_AGE_MS = 2 * 60_000;
/** How long the consent may take before the check value is forgotten. */
export const OPEN_MAX_AGE_MS = 10 * 60_000;
/** How long the demo's claim on sign-ins lasts without being renewed. */
export const HOST_HOLD_MS = 30_000;

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * The address TikTok may send the browser back to, as the page asked for
 * it: flock's own /connect/tiktok page, over https (or this machine's own
 * http), with nothing after it. '' for anything else — TikTok refuses an
 * address not registered on the app anyway, but a hand-edited row must not
 * get a code sent somewhere odd by this worker's hand either.
 */
export function pageRedirect(value) {
	let url;
	try {
		url = new URL(String(value ?? ''));
	} catch {
		return '';
	}
	const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.test(url.hostname));
	if (!secure || url.search || url.hash || !/\/connect\/tiktok$/.test(url.pathname)) return '';
	return url.href;
}

/** A PKCE pair: TikTok wants the challenge as the SHA-256 of the verifier in hex, not base64url. */
export function pkcePair() {
	const verifier = randomBytes(48).toString('base64url');
	return { verifier, challenge: createHash('sha256').update(verifier).digest('hex') };
}

/** TikTok's consent address for one sign-in. */
export function signinUrl({ clientKey, scopes, redirectUri, state, challenge }) {
	const auth = new URL(TIKTOK_AUTH);
	auth.searchParams.set('client_key', clientKey);
	auth.searchParams.set('scope', scopes.join(','));
	auth.searchParams.set('response_type', 'code');
	auth.searchParams.set('redirect_uri', redirectUri);
	auth.searchParams.set('state', state);
	if (challenge) {
		auth.searchParams.set('code_challenge', challenge);
		auth.searchParams.set('code_challenge_method', 'S256');
	}
	return auth.toString();
}

/** Whether another process holds the sign-ins (the demo, while it runs). */
export function heldByOther(host, run, now = Date.now()) {
	if (!host?.run || host.run === run) return false;
	const until = Date.parse(host.until ?? '');
	return Number.isFinite(until) && until > now;
}

/**
 * What to do with the sign-in row now:
 * - `start`: a fresh request, nobody else holding sign-ins — answer it;
 * - `expire`: a request too old to answer, or a consent left open too long;
 * - `exchange`: the page brought a code back for a sign-in this run opened;
 * - `lost`: a code for a sign-in this run opened but no longer remembers
 *   (it was restarted in between) — the page has to start again;
 * - `refused`: TikTok sent the browser back with an error;
 * - `skip`: nothing for this run to do.
 */
export function signinStep(ask, { run, held, hostOther = false, now = Date.now() }) {
	if (!ask?.id) return 'skip';
	if (ask.status === 'pending') {
		if (hostOther) return 'skip';
		return now - Date.parse(ask.requestedAt) > ASK_MAX_AGE_MS ? 'expire' : 'start';
	}
	if (ask.answeredBy !== run) return 'skip';
	if (ask.status === 'open') return now - Date.parse(ask.openedAt) > OPEN_MAX_AGE_MS ? 'expire' : 'skip';
	if (ask.status === 'returned') return 'refused';
	if (ask.status === 'code') return held.has(ask.id) ? 'exchange' : 'lost';
	return 'skip';
}

/** Trades a code for the account's tokens; throws with TikTok's own words. */
export async function exchangeCode({ clientKey, clientSecret, code, redirectUri, verifier }) {
	const res = await fetchOrExplain(TIKTOK_TOKEN, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_key: clientKey,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
			...(verifier ? { code_verifier: verifier } : {})
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
		throw new Error(`TikTok token exchange failed (${body.error || res.status}): ${body.error_description || text}`);
	}
	if (!body.refresh_token) throw new Error('TikTok returned no refresh token.');
	if (!body.open_id) throw new Error('TikTok returned no open id for the account.');
	return body;
}

/**
 * Adds the account a token exchange returned to the config — or replaces its
 * own older entry — with its name read from TikTok, and saves it. The config
 * in memory is changed too, so a running worker uses it at once.
 */
export async function connectAccount(config, body) {
	const added = {
		openId: body.open_id,
		username: '',
		nickname: '',
		refreshToken: body.refresh_token,
		scope: body.scope ?? ''
	};
	let creator = null;
	let creatorError = '';
	try {
		creator = await creatorInfo(config, added);
		added.username = creator.username;
		added.nickname = creator.nickname;
	} catch (err) {
		creatorError = err instanceof Error ? err.message : String(err);
	}
	const accounts = mergeAccounts(config.tiktok.accounts, [added], (account) => account.openId);
	saveTikTokAccounts(accounts);
	config.tiktok.accounts = accounts;
	return { added, accounts, creator, creatorError };
}

/** Which scopes this worker asks for on the page's behalf. */
export function pageScopes(config, forceStats = false) {
	return tiktokScopes(forceStats || config.tiktok?.pageSignin === 'stats');
}

/** The sign-ins this process opened: id → what the exchange needs. */
const opened = new Map();

/**
 * One look at the sign-in row. `stats` asks for the reading scopes whatever
 * the config says (the demo). `afterConnect` runs once an account is saved.
 */
export async function signinPass({ pb, config, log, run, stats = false, afterConnect }) {
	const ask = (await pb.getSetting(SIGNIN_KEY))?.value;
	const host = (await pb.getSetting(HOST_KEY))?.value;
	const step = signinStep(ask, { run, held: opened, hostOther: heldByOther(host, run) });
	if (step === 'skip') return;

	// Writes only while the row still holds the request this answers.
	const answer = async (patch) => {
		const current = (await pb.getSetting(SIGNIN_KEY))?.value;
		if (current?.id !== ask.id) return;
		await pb.setSetting(SIGNIN_KEY, { ...current, ...patch });
	};

	if (step === 'expire') {
		opened.delete(ask.id);
		await answer({ status: 'expired' });
		return;
	}
	if (step === 'refused') {
		opened.delete(ask.id);
		await answer({ status: 'failed', error: `TikTok did not sign in: ${ask.error || 'refused'}` });
		log(`tiktok sign-in refused on TikTok's page: ${ask.error || 'no reason given'}`);
		return;
	}
	if (step === 'lost') {
		await answer({ status: 'failed', error: 'The worker was restarted during the sign-in. Start it again.' });
		return;
	}

	if (step === 'start') {
		const redirectUri = pageRedirect(ask.redirect);
		if (!redirectUri) {
			await answer({ status: 'failed', error: `Not a flock sign-in page: ${String(ask.redirect).slice(0, 200)}` });
			return;
		}
		const { verifier, challenge } = pkcePair();
		const state = randomBytes(16).toString('hex');
		const url = signinUrl({
			clientKey: config.tiktok.clientKey,
			scopes: pageScopes(config, stats),
			redirectUri,
			state,
			challenge
		});
		opened.set(ask.id, { state, verifier, redirectUri });
		await answer({ status: 'open', url, answeredBy: run, openedAt: new Date().toISOString() });
		log(`tiktok sign-in opened for ${ask.by || 'the page'}`);
		return;
	}

	// step === 'exchange'
	const held = opened.get(ask.id);
	opened.delete(ask.id);
	if (ask.state !== held.state) {
		await answer({ status: 'failed', error: 'The answer did not belong to this sign-in. Start it again.' });
		return;
	}
	await answer({ status: 'connecting' });
	try {
		const body = await exchangeCode({
			clientKey: config.tiktok.clientKey,
			clientSecret: config.tiktok.clientSecret,
			code: ask.code,
			redirectUri: held.redirectUri,
			verifier: held.verifier
		});
		const { added, creatorError } = await connectAccount(config, body);
		const missing = TIKTOK_STATS_SCOPES.filter((name) => !hasScope(added.scope, name));
		const who = added.username ? `@${added.username}` : `open id ${added.openId}`;
		log(`tiktok sign-in: ${who} connected${creatorError ? ` (its name was not read: ${creatorError.split('\n')[0]})` : ''}`);
		if (afterConnect) await afterConnect(added).catch((err) => log(`tiktok after sign-in: ${err.message.split('\n')[0]}`));
		await answer({
			status: 'done',
			openId: added.openId,
			username: added.username,
			nickname: added.nickname,
			missing,
			doneAt: new Date().toISOString()
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(`tiktok sign-in failed: ${message.split('\n')[0]}`);
		await answer({ status: 'failed', error: message.slice(0, 1000) });
	}
}

/** The demo's hold on sign-ins: renewed while it runs, given up when it stops. */
export function hostBeat(pb, run, holding = true) {
	return pb.setSetting(HOST_KEY, {
		run,
		until: holding ? new Date(Date.now() + HOST_HOLD_MS).toISOString() : ''
	});
}
