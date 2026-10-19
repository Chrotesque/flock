import { describe, expect, it } from 'vitest';
import { ago } from './dashboard';

const H = 3_600_000;

describe('ago', () => {
	it('words a span', () => {
		expect(ago(12 * 60_000)).toBe('12 min');
		expect(ago(3 * H)).toBe('3 h');
		expect(ago(72 * H)).toBe('3 days');
	});
});
