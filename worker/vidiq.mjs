// A minimal MCP client, just enough to ask vidIQ to score a title.
//
// vidIQ has no REST API — an MCP server is their entire public surface, so
// speaking JSON-RPC to it is the only way in. That is also why this lives in
// the worker: the key is a credential, and the SPA is a static build where
// anything shipped is readable by whoever opens the page.
//
// Deliberately hand-rolled rather than pulling in an MCP SDK. The worker has no
// dependencies and this is three requests.

const ENDPOINT = 'https://mcp.vidiq.com/mcp';
const PROTOCOL = '2025-06-18';

/**
 * Streamable HTTP replies either as JSON or as an SSE stream carrying the same
 * envelope. Both are single-response here, so the SSE case is just a matter of
 * finding the last `data:` line rather than holding a stream open.
 */
function parseBody(contentType, text) {
	if (!text.trim()) return null;

	if ((contentType || '').includes('text/event-stream')) {
		const payloads = text
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim())
			.filter(Boolean);
		if (payloads.length === 0) return null;
		return JSON.parse(payloads[payloads.length - 1]);
	}
	return JSON.parse(text);
}

function makeSession(key) {
	let sessionId = null;
	let nextId = 1;

	async function send(method, params, { notify = false } = {}) {
		const body = notify
			? { jsonrpc: '2.0', method, params }
			: { jsonrpc: '2.0', id: nextId++, method, params };

		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': PROTOCOL,
				...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
			},
			body: JSON.stringify(body)
		});

		// Handed back on initialize and required on everything after it.
		const issued = res.headers.get('mcp-session-id');
		if (issued) sessionId = issued;

		const text = await res.text();

		if (res.status === 401 || res.status === 403) {
			throw new Error(
				'vidIQ rejected the key. Generate one at app.vidiq.com/account/settings/mcp ' +
					`and put it in the worker config as vidiqKey. (${res.status})`
			);
		}
		if (!res.ok) throw new Error(`vidIQ ${method} -> ${res.status}: ${text.slice(0, 400)}`);
		if (notify) return null;

		const envelope = parseBody(res.headers.get('content-type'), text);
		if (envelope?.error) {
			throw new Error(`vidIQ ${method}: ${envelope.error.message ?? JSON.stringify(envelope.error)}`);
		}
		return envelope?.result ?? null;
	}

	return { send };
}

/**
 * Runs the handshake and hands back a ready session.
 *
 * A session is set up per call rather than held open. Scoring happens a handful
 * of times a day, so the two extra requests cost nothing next to the complexity
 * of keeping a long-lived session healthy in a process that also does uploads.
 */
async function connect(key) {
	const session = makeSession(key);

	await session.send('initialize', {
		protocolVersion: PROTOCOL,
		capabilities: {},
		clientInfo: { name: 'flock', version: '1' }
	});
	await session.send('notifications/initialized', {}, { notify: true });

	return session;
}

async function callTool(key, name, args) {
	const session = await connect(key);
	return session.send('tools/call', { name, arguments: args });
}

/**
 * Pulls a number out of whatever shape the tool replied with.
 *
 * MCP tool results are content blocks meant for a model to read, so the score
 * arrives as text rather than a typed field. `structuredContent` is preferred
 * when the server sends it; the text fallback is what actually runs today.
 */
function extractScore(result) {
	if (typeof result?.structuredContent?.score === 'number') return result.structuredContent.score;

	const text = (result?.content ?? [])
		.filter((block) => block?.type === 'text')
		.map((block) => block.text)
		.join('\n');

	if (!text) return null;

	try {
		const parsed = JSON.parse(text);
		if (typeof parsed?.score === 'number') return parsed.score;
	} catch {
		// Not JSON — fall through to reading a number out of the prose.
	}

	const match = text.match(/(\d{1,3})\s*(?:\/\s*100)?/);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Scores one title. Returns 0-100, or throws with something worth reading. */
export async function scoreTitle(key, { title, format = 'long', channelId }) {
	const result = await callTool(key, 'vidiq_score_title', {
		title,
		type: format === 'short' ? 'short' : 'long',
		...(channelId ? { channelId } : {})
	});

	const score = extractScore(result);
	if (score === null) {
		throw new Error(`vidIQ returned no score: ${JSON.stringify(result).slice(0, 300)}`);
	}
	return score;
}

/**
 * Cheap round trip, so the key can be checked without spending credits.
 *
 * `tools/list` is a method in its own right, not a tool — scoring costs 5
 * credits a call, and "is this key any good" should not.
 */
export async function listTools(key) {
	const session = await connect(key);
	const result = await session.send('tools/list', {});
	return (result?.tools ?? []).map((tool) => tool.name);
}
