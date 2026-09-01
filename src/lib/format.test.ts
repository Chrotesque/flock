import { describe, expect, it } from 'vitest';
import {
	nextDayMatching,
	isoDate,
	startOfWeek,
	addDays,
	weekLabel,
	hourOf,
	minuteOf,
	makeTime
} from './format';

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

describe('week helpers', () => {
	it('snaps back to Monday from any day of the week', () => {
		// 2026-09-01 is a Tuesday; 2026-09-06 is the Sunday that ends its week.
		expect(isoDate(startOfWeek(new Date(2026, 8, 1)))).toBe('2026-08-31');
		expect(isoDate(startOfWeek(new Date(2026, 8, 6)))).toBe('2026-08-31');
		expect(isoDate(startOfWeek(new Date(2026, 7, 31)))).toBe('2026-08-31');
	});

	it('labels a week inside one month, and one that straddles two', () => {
		const start = new Date(2026, 8, 7);
		expect(weekLabel(start, addDays(start, 6))).toBe('Sep 2026');
		const straddle = new Date(2026, 7, 31);
		expect(weekLabel(straddle, addDays(straddle, 6))).toBe('Aug – Sep 2026');
	});

	it('parses and rebuilds times, falling back to midnight', () => {
		expect(hourOf('21:30')).toBe(21);
		expect(minuteOf('21:30')).toBe(30);
		expect(hourOf('')).toBe(0);
		expect(makeTime(9, 5)).toBe('09:05');
	});
});
