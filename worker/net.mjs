// Node's fetch reports every network failure as a bare "fetch failed" and
// hides the reason in `cause`. That is what the worker printed when the NAS
// was unreachable, and it answers none of the questions it raises. This names
// the host and the reason, so an unplugged NAS, a Tailscale that has not come
// up yet or a DNS miss each read as exactly that.
//
// node:https is worse: a connection that failed on every address of a host
// (Node tries each A and AAAA record in turn) comes back as an AggregateError
// whose message is empty, with the reasons in `errors`. An Instagram upload
// failed that way on 20 Oct 2026 and the post's error read "".

/**
 * Why a connection failed, in a few words: the code, or with several
 * addresses tried, each one's code and address. '' when nothing says.
 */
export function connectReason(err) {
	const tried = Array.isArray(err?.errors) ? err.errors : [];
	if (tried.length > 0) {
		return tried.map((e) => [codeOf(e) || 'failed', e?.address].filter(Boolean).join(' ')).join(', ');
	}
	return codeOf(err);
}

// Only a string code: a DOMException's `code` is a legacy number (20 for an
// abort) that says less than its message.
function codeOf(err) {
	return (typeof err?.code === 'string' && err.code) || (typeof err?.message === 'string' && err.message) || '';
}

/** Turns a failed request into an error that names where and why. */
export function describeNetworkError(url, err) {
	const why = connectReason(err?.cause ?? err) || err?.message || String(err);
	let where = url;
	try {
		where = new URL(url).origin;
	} catch {
		// Leave the raw URL in place.
	}
	const error = new Error(`Cannot reach ${where} (${why})`);
	error.cause = err;
	return error;
}

/**
 * True for a failure that never reached the host — DNS, refused, reset, a
 * Tailscale link that is down. The kind worth retrying, as opposed to an
 * answer from the host that says no.
 */
export function isNetworkError(err) {
	return err instanceof Error && err.cause !== undefined && /^Cannot reach /.test(err.message);
}

/** What an error says, never '' — an empty message falls back to its reason. */
export function errorText(err) {
	if (!(err instanceof Error)) return String(err);
	return err.message || connectReason(err) || err.name || 'unknown error';
}

/** fetch, with a network failure rethrown as a readable error. */
export async function fetchOrExplain(url, options) {
	try {
		return await fetch(url, options);
	} catch (err) {
		throw describeNetworkError(url, err);
	}
}
