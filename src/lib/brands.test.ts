import { describe, expect, it } from 'vitest';
import {
	brandKey,
	brandNameProblem,
	brandSettingKey,
	nextBrandName,
	orderBrands,
	rowsToAdopt
} from './brands';
import type { Brand } from './types';

const brand = (id: string, name: string, sort_order = 0): Brand => ({ id, name, sort_order });

describe('brandNameProblem', () => {
	const brands = [brand('a', 'Acme'), brand('b', 'North Star')];

	it('accepts a new name', () => {
		expect(brandNameProblem('Studio', brands)).toBe('');
	});

	it('refuses an empty name', () => {
		expect(brandNameProblem('   ', brands)).not.toBe('');
	});

	it('refuses a name another brand has, ignoring case and outer spaces', () => {
		expect(brandNameProblem('  acme ', brands)).not.toBe('');
	});

	it('lets a brand keep its own name', () => {
		expect(brandNameProblem('ACME', brands, 'a')).toBe('');
	});

	it('refuses an overlong name', () => {
		expect(brandNameProblem('x'.repeat(121), brands)).not.toBe('');
	});
});

describe('nextBrandName', () => {
	it('takes the stem when it is free', () => {
		expect(nextBrandName([brand('a', 'Acme')])).toBe('New brand');
	});

	it('numbers past the ones taken', () => {
		expect(nextBrandName([brand('a', 'new brand'), brand('b', 'New brand 2')])).toBe('New brand 3');
	});
});

describe('orderBrands', () => {
	it('sorts by order, then name', () => {
		const sorted = orderBrands([brand('a', 'B', 1), brand('b', 'Z', 0), brand('c', 'A', 1)]);
		expect(sorted.map((b) => b.id)).toEqual(['b', 'c', 'a']);
	});
});

describe('keys', () => {
	it('lowercases and trims for comparison', () => {
		expect(brandKey('  North STAR ')).toBe('north star');
	});

	it('suffixes per-brand settings with the brand id', () => {
		expect(brandSettingKey('templates', 'abc')).toBe('templates:abc');
	});
});

describe('rowsToAdopt', () => {
	const platforms = ['youtube', 'instagram', 'tiktok', 'facebook'] as const;

	it('adopts every brandless row for a brand that has none', () => {
		const rows = [
			{ id: '1', brand: '', platform: 'youtube' },
			{ id: '2', brand: '', platform: 'tiktok' }
		];
		expect(rowsToAdopt(rows, 'B', platforms).map((r) => r.id)).toEqual(['1', '2']);
	});

	it('skips platforms the brand already has a row for', () => {
		const rows = [
			{ id: '1', brand: 'B', platform: 'youtube' },
			{ id: '2', brand: '', platform: 'youtube' },
			{ id: '3', brand: '', platform: 'instagram' }
		];
		expect(rowsToAdopt(rows, 'B', platforms).map((r) => r.id)).toEqual(['3']);
	});

	it('adopts only one brandless row per platform, and none for unknown platforms', () => {
		const rows = [
			{ id: '1', brand: '', platform: 'youtube' },
			{ id: '2', brand: '', platform: 'youtube' },
			{ id: '3', brand: '', platform: 'myspace' }
		];
		expect(rowsToAdopt(rows, 'B', platforms).map((r) => r.id)).toEqual(['1']);
	});

	it('leaves rows of other brands alone', () => {
		const rows = [{ id: '1', brand: 'other', platform: 'youtube' }];
		expect(rowsToAdopt(rows, 'B', platforms)).toEqual([]);
	});
});
