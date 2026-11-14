/**
 * Signing a TikTok account in from flock's page (worker/tiktoksignin.mjs
 * holds the other half). The page asks in `app_settings` / `tiktok_signin`,
 * the worker answers with TikTok's consent address, TikTok sends the browser
 * back to /connect/tiktok, which hands the code to the worker, and the worker
 * saves the account. The secret never reaches the page.
 */

export const SIGNIN_KEY = 'tiktok_signin';

export type SigninStatus = 'pending' | 'open' | 'code' | 'returned' | 'connecting' | 'done' | 'failed' | 'expired';

export interface SigninRow {
	id: string;
	status: SigninStatus;
	redirect: string;
	requestedAt: string;
	by?: string;
	url?: string;
	answeredBy?: string;
	code?: string;
	state?: string;
	error?: string;
	username?: string;
	nickname?: string;
	/** The Dashboard's reading scopes the sign-in did not grant. */
	missing?: string[];
}

/** Where TikTok sends the browser back: this copy of flock's own return page. */
export function signinRedirect(origin: string, base: string): string {
	return `${origin}${base}/connect/tiktok`;
}

export type SigninReturn =
	| { kind: 'code'; code: string; state: string }
	| { kind: 'error'; error: string }
	| { kind: 'none' };

/** What TikTok's redirect carries: a code and the state, or why it said no. */
export function readReturn(params: URLSearchParams): SigninReturn {
	const error = params.get('error');
	if (error) {
		const said = params.get('error_description');
		return { kind: 'error', error: said ? `${error}: ${said}` : error };
	}
	const code = params.get('code');
	const state = params.get('state');
	if (code && state) return { kind: 'code', code, state };
	return { kind: 'none' };
}

/** Whether a TikTok account's sign-in lets the Dashboard read its numbers. */
export function canRead(report: { missing?: string[] } | undefined | null): boolean {
	return Boolean(report) && (report?.missing ?? []).length === 0;
}

/** The finished sign-in in words. */
export function doneWords(row: Pick<SigninRow, 'username' | 'nickname' | 'missing'>): string {
	const who = row.username ? `@${row.username}` : 'The account';
	const missing = row.missing ?? [];
	const reading = missing.filter((scope) => scope !== 'video.upload');
	const drafts = missing.includes('video.upload') ? ' It cannot be sent drafts (TikTok did not allow video.upload).' : '';
	if (reading.length === 0) return `${who} is connected. Its videos and followers are being read.${drafts}`;
	return `${who} is connected, but TikTok did not allow ${reading.join(' and ')}, so its numbers cannot be read.${drafts}`;
}
