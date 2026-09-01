import { describe, expect, it } from 'vitest';
import { nextDayMatching, isoDate } from './format';

describe('nextDayMatching', () => {
	// 2026-09-01 is a Tuesday.
	const tuesday = new Date(2026, 8, 1);

	it('returns the same day when it already matches', () => {
		expect(isoDate(nextDayMatching(tuesday, [2]))).toBe('2026-09-01');
	});

	it('walks forward to the next matching weekday', () => {
		// Friday is day 5.
		expect(isoDate(nextDayMatching(tuesday, [5]))).toBe('2026-09-04');
	});

	it('wraps into the following week', () => {
		// Monday is day 1, so the next one is six days on.
		expect(isoDate(nextDayMatching(tuesday, [1]))).toBe('2026-09-07');
	});

	it('picks the soonest of several days', () => {
		expect(isoDate(nextDayMatching(tuesday, [1, 4, 6]))).toBe('2026-09-03');
	});

	it('returns the start date unchanged when no days are set', () => {
		expect(isoDate(nextDayMatching(tuesday, []))).toBe('2026-09-01');
	});

	it('does not mutate the date it is given', () => {
		nextDayMatching(tuesday, [5]);
		expect(isoDate(tuesday)).toBe('2026-09-01');
	});
});
