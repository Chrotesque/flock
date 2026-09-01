// Tiny shared fetch wrapper for the PocketBase admin API. Every script in
// scripts/ goes through this; run them via `node scripts/runpb.mjs <script>`.

const url = process.env.PB_URL;
const email = process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD;

let token = null;

export async function auth() {
	if (token) return token;
	const res = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: email, password })
	});
	if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);
	token = (await res.json()).token;
	return token;
}

export async function api(path, options = {}) {
	const t = await auth();
	const res = await fetch(`${url}${path}`, {
		...options,
		headers: {
			Authorization: t,
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			...options.headers
		}
	});
	const text = await res.text();
	const body = text ? JSON.parse(text) : null;
	if (!res.ok) {
		throw new Error(`${options.method || 'GET'} ${path} -> ${res.status}\n${text}`);
	}
	return body;
}

export const pbUrl = url;
