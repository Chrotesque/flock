import { describe, expect, it } from 'vitest';
import { changeWords } from './trend';

describe('changeWords', () => {
	it('says how far from 1 a ratio is, signed, in whole percent', () => {
		expect(changeWords(1.34, 'en-US')).toBe('+34 %');
		expect(changeWords(0.876, 'en-US')).toBe('−12 %');
		expect(changeWords(1.002, 'en-US')).toBe('±0 %');
		expect(changeWords(12.5, 'en-US')).toBe('+1,150 %');
	});
});
