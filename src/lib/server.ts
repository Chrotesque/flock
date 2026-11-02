/**
 * The flock server the copy of flock on its website talks to.
 *
 * flock's page is normally served by its own PocketBase and talks to the
 * address it was opened at (pb.ts). The copy built for the website
 * (`pnpm build:site`, under /app/) is served by no PocketBase: the browser
 * names its server once (ServerSetup), it is kept here, and from then on the
 * page is flock as usual. Nothing passes through the website itself.
 */

/** The server this browser named. */
export const SERVER_KEY = 'flock.server';
/** The one before a change, so the form starts from it. */
export const LAST_SERVER_KEY = 'flock.server.last';

/** What a server serves under its address: flock's pages, the admin and the API. */
const SERVED_PATHS = /\/(?:upload|calendar|log|settings|devtest|analytics|_|api)(?:\/.*)?$/;

/**
 * An address as typed, made into the base flock talks to: https added when no
 * scheme was given, and a page of flock, the admin (`/_/`) or an API path
 * pasted from the address bar dropped, with any query and trailing slash.
 * Null when it is no http(s) address at all.
 */
export function serverAddress(input: string): string | null {
	let text = input.trim();
	if (!text) return null;
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
	const path = url.pathname.replace(SERVED_PATHS, '').replace(/\/+$/, '');
	return `${url.protocol}//${url.host}${path}`;
}

/** This machine itself, which a browser treats as secure even over http. */
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Why the browser would refuse the address before asking it anything, or
 * ''. A page served over https may not talk to an http server, bar this
 * machine's own.
 */
export function blockedReason(address: string, pageProtocol: string): string {
	const url = new URL(address);
	if (pageProtocol === 'https:' && url.protocol === 'http:' && !LOOPBACK.test(url.hostname)) {
		return (
			'This page is served over https, so the browser will not let it talk to an http address. ' +
			"Give the server's https address (Tailscale Serve or a reverse proxy in front of it)."
		);
	}
	return '';
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Asks the address whether flock's server is there: PocketBase's health
 * check, then flock's brands, which every flock has and every browser may
 * read. '' when it answered as flock, else why not, in words.
 */
export async function checkServer(address: string, fetcher: Fetcher = fetch, timeoutMs = 8000): Promise<string> {
	const ask = (path: string) => fetcher(`${address}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
	let health: Response;
	try {
		health = await ask('/api/health');
	} catch {
		return (
			`Nothing answered at ${address}. Check the address, that this device can reach it, ` +
			'and that the server lets other sites ask it (PocketBase does unless told otherwise).'
		);
	}
	if (!health.ok) return `${address} answered, but not as PocketBase does (${health.status}).`;
	let brands: Response;
	try {
		brands = await ask('/api/collections/brands/records?perPage=1&fields=id');
	} catch {
		return `${address} stopped answering. Try again.`;
	}
	if (brands.status === 404) {
		return `A PocketBase answers at ${address}, but flock is not set up in it (pnpm setup-pb).`;
	}
	if (!brands.ok) return `A PocketBase answers at ${address}, but would not show flock's data (${brands.status}).`;
	return '';
}

// Private windows and blocked site data throw rather than return null.
function read(key: string): string {
	try {
		return localStorage.getItem(key) ?? '';
	} catch {
		return '';
	}
}

/** The server this browser named, or '' when it has none (or a stored one no longer reads as an address). */
export function storedServer(): string {
	return serverAddress(read(SERVER_KEY)) ?? '';
}

/** What the form starts from: the server named before a change, else nothing. */
export function lastServer(): string {
	return read(LAST_SERVER_KEY);
}

/** Remembers the server; false when the browser would not keep it. */
export function keepServer(address: string): boolean {
	try {
		localStorage.setItem(SERVER_KEY, address);
		localStorage.removeItem(LAST_SERVER_KEY);
		return localStorage.getItem(SERVER_KEY) === address;
	} catch {
		return false;
	}
}

/** Forgets the server, keeping it as where the form starts. */
export function forgetServer(): void {
	try {
		const current = localStorage.getItem(SERVER_KEY);
		if (current) localStorage.setItem(LAST_SERVER_KEY, current);
		localStorage.removeItem(SERVER_KEY);
	} catch {
		// Nothing was kept, so nothing is left to forget.
	}
}
