import { describe, expect, it, afterEach, vi } from 'vitest';
import { newId } from './id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('uses randomUUID where it exists', () => {
		expect(newId()).toMatch(UUID);
	});

	// The case that matters: flock is served over plain HTTP from a LAN address,
	// where randomUUID is simply absent.
	it('still returns a valid v4 UUID without randomUUID', () => {
		vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
		expect(globalThis.crypto.randomUUID).toBeUndefined();
		expect(newId()).toMatch(UUID);
	});

	it('falls back again when crypto is missing entirely', () => {
		vi.stubGlobal('crypto', undefined);
		const id = newId();
		expect(id).toMatch(/^id-/);
		expect(id.length).toBeGreaterThan(10);
	});

	it('does not repeat itself', () => {
		const ids = new Set(Array.from({ length: 500 }, () => newId()));
		expect(ids.size).toBe(500);
	});
});
