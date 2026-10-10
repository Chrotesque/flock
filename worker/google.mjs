// Google OAuth: turning the stored refresh token into access tokens.
//
// The refresh token is the whole reason a worker exists rather than the SPA
// doing this. flock is a static build served out of pb_public, so a client
// secret placed there would be readable by anyone who opens the page.

import { fetchOrExplain } from './net.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Per grant (one per channel), cached until a minute before it expires, so a
 * batch of uploads reuses one.
 */
const cache = new Map();

export async function accessToken({ clientId, clientSecret, refreshToken }) {
	const cached = cache.get(refreshToken);
	if (cached && Date.now() < cached.expiresAt) return cached.token;

	const res = await fetchOrExplain(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	});

	const text = await res.text();
	if (!res.ok) {
		// The overwhelmingly likely cause, and the error Google returns is too
		// terse to act on. A consent screen left in "Testing" expires its refresh
		// tokens after seven days, which reads as a mystery failure otherwise.
		if (text.includes('invalid_grant')) {
			throw new Error(
				'Google rejected the refresh token (invalid_grant).\n' +
					'It has expired or been revoked. Re-authorise with:  pnpm worker:auth\n\n' +
					'If this keeps happening weekly, the OAuth consent screen is still in\n' +
					'"Testing" mode — Google expires those refresh tokens after 7 days.\n' +
					'Publishing the consent screen stops that.'
			);
		}
		throw new Error(`Token refresh failed (${res.status}): ${text}`);
	}

	const body = JSON.parse(text);
	cache.set(refreshToken, {
		token: body.access_token,
		expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000
	});
	return body.access_token;
}

/** Drops a grant's cached token, so the next call re-refreshes. Used after a 401. */
export function forgetToken(refreshToken) {
	cache.delete(refreshToken);
}
