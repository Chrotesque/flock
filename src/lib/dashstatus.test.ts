import { describe, expect, it } from 'vitest';
import { limitLevel, lineLevel, worstLevel } from './dashstatus';

describe('limitLevel', () => {
	it('is ok under half', () => {
		expect(limitLevel(30, 6000)).toBe('ok');
		expect(limitLevel(49, 100)).toBe('ok');
	});

	it('is half from 50 % and close from 80 %', () => {
		expect(limitLevel(50, 100)).toBe('half');
		expect(limitLevel(79, 100)).toBe('half');
		expect(limitLevel(80, 100)).toBe('close');
		expect(limitLevel(5999, 6000)).toBe('close');
	});

	it('is bad once used up, or past it', () => {
		expect(limitLevel(100, 100)).toBe('bad');
		expect(limitLevel(6400, 6000)).toBe('bad');
	});

	it('says nothing about a limit it cannot read', () => {
		expect(limitLevel(5, 0)).toBe('ok');
		expect(limitLevel(Number.NaN, 100)).toBe('ok');
	});
});

describe('worstLevel', () => {
	it('takes the worst, ok for none', () => {
		expect(worstLevel([])).toBe('ok');
		expect(worstLevel(['ok', 'half'])).toBe('half');
		expect(worstLevel(['close', 'half', 'ok'])).toBe('close');
		expect(worstLevel(['half', 'bad', 'close'])).toBe('bad');
	});
});

describe('lineLevel', () => {
	it('is bad on an error whatever the limit says', () => {
		expect(lineLevel({ error: 'invalid_grant', used: 1, total: 100 })).toBe('bad');
	});

	it('follows its limit', () => {
		expect(lineLevel({ used: 2, total: 100 })).toBe('ok');
		expect(lineLevel({ used: 3100, total: 6000 })).toBe('half');
		expect(lineLevel({ used: 100, total: 100 })).toBe('bad');
	});

	it('is ok with no limit and no error', () => {
		expect(lineLevel({})).toBe('ok');
		expect(lineLevel({ error: '' })).toBe('ok');
	});

	it('makes a partial read at least close, never less than its limit', () => {
		expect(lineLevel({ partial: true })).toBe('close');
		expect(lineLevel({ partial: true, used: 100, total: 100 })).toBe('bad');
	});
});
