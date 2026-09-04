import { describe, expect, it } from 'vitest';
import { kindOf, SHORT_MAX_SECONDS } from './videokind';

describe('kindOf', () => {
	it('calls anything under three minutes a short', () => {
		expect(kindOf({ duration: 1, live: false })).toBe('short');
		expect(kindOf({ duration: SHORT_MAX_SECONDS - 1, live: false })).toBe('short');
	});

	it('calls anything over three minutes long form', () => {
		expect(kindOf({ duration: SHORT_MAX_SECONDS + 1, live: false })).toBe('long');
		expect(kindOf({ duration: 4 * 3600, live: false })).toBe('long');
	});

	it('lets a stream win at any length', () => {
		expect(kindOf({ duration: 20, live: true })).toBe('live');
		expect(kindOf({ duration: 5 * 3600, live: true })).toBe('live');
		expect(kindOf({ duration: 0, live: true })).toBe('live');
	});

	it('sends the edge cases to other so they can be seen', () => {
		expect(kindOf({ duration: SHORT_MAX_SECONDS, live: false })).toBe('other');
		expect(kindOf({ duration: 0, live: false })).toBe('other');
		expect(kindOf({ duration: Number.NaN, live: false })).toBe('other');
	});
});
