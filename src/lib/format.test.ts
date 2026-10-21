import { describe, expect, it } from 'vitest';
import {
	nextDayMatching,
	isoDate,
	startOfWeek,
	dayStart,
	rangeLabel,
	addDays,
	weekLabel,
	hourOf,
	minuteOf,
	makeTime,
	firstLine,
	parseTagList,
	shortCount,
	tagListLength
} from './format';

describe('parseTagList', () => {
	it('splits a comma-separated paste and trims each tag', () => {
		expect(parseTagList('cthulhu game, arkham ,  frogwares')).toEqual([
			'cthulhu game',
			'arkham',
			'frogwares'
		]);
	});

	it('drops empties from stray or trailing commas', () => {
		expect(parseTagList('a,,b,')).toEqual(['a', 'b']);
	});

	it('de-duplicates case-insensitively, keeping the first casing', () => {
		expect(parseTagList('the sinking city 2,The Sinking City 2')).toEqual(['the sinking city 2']);
	});

	it('never re-adds what the field already holds', () => {
		expect(parseTagList('arkham,frogwares', ['Arkham'])).toEqual(['frogwares']);
	});
});

describe('tagListLength', () => {
	it('is zero for no tags', () => {
		expect(tagListLength([])).toBe(0);
	});

	it('counts a single tag as its own length', () => {
		expect(tagListLength(['frogwares'])).toBe(9);
	});

	// YouTube's own worked example: "Foo Baz" is nine characters, "Foo-Baz" seven.
	it('counts a tag containing a space as though it were quoted', () => {
		expect(tagListLength(['Foo Baz'])).toBe(9);
		expect(tagListLength(['Foo-Baz'])).toBe(7);
	});

	it('counts the separators between tags', () => {
		// 7 + 7 for the tags, plus one comma.
		expect(tagListLength(['Foo-Baz', 'Bar-Qux'])).toBe(15);
	});
});

describe('firstLine', () => {
	it('takes the first line and trims it', () => {
		expect(firstLine('  hello  \nworld')).toBe('hello');
	});

	it('returns the whole string when there is no break', () => {
		expect(firstLine('just one line')).toBe('just one line');
	});

	it('handles an empty string', () => {
		expect(firstLine('')).toBe('');
	});
});

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

describe('dayStart and rangeLabel', () => {
	it('takes a moment back to its local midnight', () => {
		const d = dayStart(new Date(2026, 9, 12, 21, 30));
		expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 12, 0, 0]);
	});

	it('labels a run of days', () => {
		expect(rangeLabel(new Date(2026, 9, 12), new Date(2026, 9, 25))).toBe('12 – 25 Oct 2026');
		expect(rangeLabel(new Date(2026, 9, 28), new Date(2026, 10, 10))).toBe('28 Oct – 10 Nov 2026');
		expect(rangeLabel(new Date(2026, 11, 28), new Date(2027, 0, 10))).toBe('28 Dec 2026 – 10 Jan 2027');
	});
});

describe('shortCount', () => {
	it('keeps a count under 1,000 as it is', () => {
		expect(shortCount(0, 'en-US')).toBe('0');
		expect(shortCount(999, 'en-US')).toBe('999');
	});

	it('shortens from 1,000 up to one decimal, dropping a .0', () => {
		expect(shortCount(1000, 'en-US')).toBe('1k');
		expect(shortCount(1024, 'en-US')).toBe('1k');
		expect(shortCount(1100, 'en-US')).toBe('1.1k');
		expect(shortCount(1234, 'en-US')).toBe('1.2k');
		expect(shortCount(80_638, 'en-US')).toBe('80.6k');
		expect(shortCount(85_821, 'en-US')).toBe('85.8k');
		expect(shortCount(1_234_567, 'en-US')).toBe('1.2m');
	});

	it('drops the decimal from 100 of the unit up', () => {
		expect(shortCount(99_999, 'en-US')).toBe('99.9k');
		expect(shortCount(100_000, 'en-US')).toBe('100k');
		expect(shortCount(102_481, 'en-US')).toBe('102k');
		expect(shortCount(165_700, 'en-US')).toBe('165k');
		expect(shortCount(123_456_789, 'en-US')).toBe('123m');
	});

	it('cuts rather than rounds, so it never says more than there is', () => {
		expect(shortCount(1999, 'en-US')).toBe('1.9k');
		expect(shortCount(999_999, 'en-US')).toBe('999k');
		expect(shortCount(1_000_000, 'en-US')).toBe('1m');
		for (let n = 1000; n < 20_000; n += 100) expect(shortCount(n, 'en-US')).toBe(`${n / 1000}k`);
	});

	it("uses the locale's decimal mark and keeps a sign", () => {
		expect(shortCount(80_638, 'de-DE')).toBe('80,6k');
		expect(shortCount(-1500, 'en-US')).toBe('-1.5k');
		expect(shortCount(-12, 'en-US')).toBe('-12');
	});
});
