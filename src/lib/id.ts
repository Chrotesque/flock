/**
 * A unique id that works where flock is actually served from.
 *
 * `crypto.randomUUID` is restricted to secure contexts, and flock is served
 * over plain HTTP from a LAN address — so on the deployed copy the function
 * does not exist at all and calling it throws. Because every "add" handler ran
 * it first, that silently broke creating a template, a NAS destination, a
 * filter rule, a scheduling profile or a tag set: the click did nothing and
 * said nothing. It only ever worked in dev, where localhost counts as secure.
 *
 * `crypto.getRandomValues` carries no such restriction, so the fallback is a
 * real version-4 UUID rather than a weaker shape.
 */
export function newId(): string {
	const source = globalThis.crypto;

	if (typeof source?.randomUUID === 'function') return source.randomUUID();

	if (typeof source?.getRandomValues === 'function') {
		const bytes = source.getRandomValues(new Uint8Array(16));
		// Version and variant bits, so the result is a well-formed UUID v4 and
		// not merely 32 random hex characters.
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;

		const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
		return [
			hex.slice(0, 8),
			hex.slice(8, 12),
			hex.slice(12, 16),
			hex.slice(16, 20),
			hex.slice(20)
		].join('-');
	}

	// Last resort. Not cryptographically random, but these ids only ever have to
	// be unique within one short list on one machine.
	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
