// Node's fetch reports every network failure as a bare "fetch failed" and
// hides the reason in `cause`. That is what the worker printed when the NAS
// was unreachable, and it answers none of the questions it raises. This names
// the host and the reason, so an unplugged NAS, a Tailscale that has not come
// up yet or a DNS miss each read as exactly that.

/** Turns a failed fetch into an error that names where and why. */
export function describeFetchError(url, err) {
	const cause = err?.cause;
	const why = cause?.code || cause?.message || err?.message || String(err);
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

/** fetch, with a network failure rethrown as a readable error. */
export async function fetchOrExplain(url, options) {
	try {
		return await fetch(url, options);
	} catch (err) {
		throw describeFetchError(url, err);
	}
}
