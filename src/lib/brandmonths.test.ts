import { describe, expect, it } from 'vitest';
import {
	brandMonths,
	daysIn,
	monthsFromReads,
	nextMonth,
	paceOf,
	partFromReads,
	prevMonth,
	readSince,
	runningWords,
	storedPart,
	type MonthCounts
} from './brandmonths';
import type { Sample } from './releases';

const s = (iso: string, views: number, likes = 0, comments = 0): Sample => [iso, views, likes, comments];

describe('monthsFromReads', () => {
	const now = Date.parse('2026-12-03T10:00:00Z');

	it("adds up the month's gains over the account's posts, from the first month flock read all of", () => {
		const rows = [
			// Read since 14 Oct: October is not whole, November is.
			{ published_at: '2026-09-20T18:00:00Z', history: [s('2026-10-14T18:26:00Z', 1000, 10, 1), s('2026-11-10T00:00:00Z', 1500, 15, 2), s('2026-12-02T00:00:00Z', 1600, 16, 2)] },
			// Out in November: all of it counts there.
			{ published_at: '2026-11-20T12:00:00Z', history: [s('2026-11-20T12:10:00Z', 50, 1, 0), s('2026-11-28T00:00:00Z', 400, 8, 3)] }
		];
		expect(monthsFromReads(rows, now)).toEqual({ '2026-11': [500 + 400, 5 + 8, 1 + 3] });
		// A month still running is never counted.
		expect(Object.keys(monthsFromReads(rows, Date.parse('2026-11-30T23:00:00Z')))).toEqual([]);
	});

	it('counts a post first read during the month from that first read, and nothing without reads', () => {
		const rows = [
			{ published_at: '2026-09-01T00:00:00Z', history: [s('2026-10-31T00:00:00Z', 10)] },
			// Published long before, first read on the 15th: only what it gained after.
			{ published_at: '2026-01-01T00:00:00Z', history: [s('2026-11-15T00:00:00Z', 900), s('2026-11-29T00:00:00Z', 950)] },
			{ published_at: '2026-11-02T00:00:00Z', history: [] }
		];
		expect(monthsFromReads(rows, now)['2026-11']).toEqual([50, 0, 0]);
		expect(monthsFromReads([], now)).toEqual({});
	});

	it('says when reading began and the first month then whole', () => {
		expect(readSince([{ published_at: '', history: [s('2026-10-14T18:26:00Z', 1)] }])).toEqual({
			first: Date.parse('2026-10-14T18:26:00Z'),
			firstWhole: '2026-11'
		});
		expect(readSince([{ published_at: '', history: [s('2026-11-01T00:00:00Z', 1)] }]).firstWhole).toBe('2026-11');
		expect(readSince([])).toEqual({ first: null, firstWhole: null });
	});

	it('never goes below nothing when counts fall', () => {
		const rows = [{ published_at: '2026-09-01T00:00:00Z', history: [s('2026-10-01T00:00:00Z', 100, 9), s('2026-11-05T00:00:00Z', 100, 4)] }];
		expect(monthsFromReads(rows, now)['2026-11']).toEqual([0, 0, 0]);
	});
});

describe('brandMonths', () => {
	const yt: Record<string, MonthCounts> = { '2026-07': [10213, 100, 20], '2026-08': [38227, 524, 55], '2026-09': [31762, 270, 51] };
	const ig: Record<string, MonthCounts> = { '2026-08': [7788, 72, 12], '2026-09': [7616, 121, 14] };

	it('gives each month newest first with its change from the month before, as vs usual judges it', () => {
		const rows = brandMonths([
			{ platform: 'youtube', months: yt },
			{ platform: 'instagram', months: ig }
		]);
		expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-08', '2026-07']);
		const sep = rows[0].cells.views;
		expect(sep.value).toBe(31762 + 7616);
		expect(sep.ratio).toBeCloseTo((31762 + 7616) / (38227 + 7788));
		expect(sep.verdict).toBe('usual');
		expect(sep.parts.map((p) => [p.platform, p.verdict])).toEqual([
			['youtube', 'usual'],
			['instagram', 'usual']
		]);
		expect(rows[0].cells.likes.verdict).toBe('behind');
		expect(rows[0].cells.likes.parts[1].verdict).toBe('ahead');
	});

	it('compares only the platforms that have both months, so a platform joining is no growth', () => {
		const aug = brandMonths([
			{ platform: 'youtube', months: yt },
			{ platform: 'instagram', months: ig }
		])[1].cells.views;
		// Instagram has no July: August is judged on YouTube alone, but shows both.
		expect(aug.value).toBe(38227 + 7788);
		expect(aug.compared).toBe(38227);
		expect(aug.previous).toBe(10213);
		expect(aug.verdict).toBe('ahead');
		expect(aug.parts[1]).toMatchObject({ platform: 'instagram', previous: null, verdict: null });
	});

	it('has no verdict for the first month, and keeps to a year', () => {
		const rows = brandMonths([{ platform: 'youtube', months: yt }]);
		expect(rows.at(-1)?.cells.views).toMatchObject({ previous: null, ratio: null, verdict: null });
		const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`20${25 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, [i, 0, 0] as MonthCounts]));
		expect(brandMonths([{ platform: 'youtube', months: many }])).toHaveLength(12);
		expect(brandMonths([])).toEqual([]);
	});

	it('steps across a year', () => {
		expect(nextMonth('2026-12')).toBe('2027-01');
		expect(prevMonth('2026-01')).toBe('2025-12');
	});
});

describe('the month still running', () => {
	const yt: Record<string, MonthCounts> = { '2026-08': [38227, 524, 55], '2026-09': [31762, 270, 51] };

	it("reads the worker's running month as the days it covers", () => {
		expect(storedPart({ month: '2026-10', counts: [21000, 210, 21], through: '2026-10-21' })).toEqual({ month: '2026-10', counts: [21000, 210, 21], days: 21 });
		// A whole month, a day from another month, nothing covered or a broken row is no part.
		expect(storedPart({ month: '2026-09', counts: [1, 1, 1], through: '2026-09-30' })).toBeNull();
		expect(storedPart({ month: '2026-10', counts: [1, 1, 1], through: '2026-09-30' })).toBeNull();
		expect(storedPart({ month: '2026-10', counts: [1, 1], through: '2026-10-05' })).toBeNull();
		expect(storedPart(null)).toBeNull();
		expect(daysIn('2026-02')).toBe(28);
		expect(daysIn('2028-02')).toBe(29);
	});

	it('scales the count so far up to the whole month', () => {
		expect(paceOf({ month: '2026-10', counts: [21000, 210, 20], days: 21 })).toEqual([31000, 310, 30]);
	});

	it('puts it on top, judged by its pace against the whole month before', () => {
		const rows = brandMonths([{ platform: 'youtube', months: yt, part: { month: '2026-10', counts: [21000, 210, 21], days: 21 } }]);
		expect(rows.map((r) => r.month)).toEqual(['2026-10', '2026-09', '2026-08']);
		const oct = rows[0].cells.views;
		expect(oct).toMatchObject({ value: 21000, pace: 31000, compared: 31000, previous: 31762, verdict: 'usual' });
		expect(oct.parts[0]).toMatchObject({ value: 21000, pace: 31000, days: 21 });
		expect(rows[0].running).toEqual([{ platform: 'youtube', days: 21 }]);
		expect(runningWords(rows[0])).toBe('21 of 31 days');
		// Whole months are as before.
		expect(rows[1].running).toEqual([]);
		expect(rows[1].cells.views).toMatchObject({ value: 31762, pace: 31762 });
		expect(runningWords(rows[1])).toBe('');
		// Twelve whole months still show beside it.
		const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`2025-${String(i + 1).padStart(2, '0')}`.replace('2025-13', '2026-01'), [i, 0, 0] as MonthCounts]));
		expect(brandMonths([{ platform: 'youtube', months: many, part: { month: '2026-02', counts: [1, 0, 0], days: 3 } }])).toHaveLength(13);
	});

	it('names the stretch when platforms cover different days, and a whole month wins over a part', () => {
		const rows = brandMonths([
			{ platform: 'youtube', months: yt, part: { month: '2026-10', counts: [100, 0, 0], days: 21 } },
			{ platform: 'facebook', months: {}, part: { month: '2026-10', counts: [50, 0, 0], days: 24.4 } }
		]);
		expect(runningWords(rows[0])).toBe('21–24 of 31 days');
		// Facebook has no whole September: judged on YouTube's pace alone.
		expect(rows[0].cells.views.compared).toBe(Math.round((100 * 31) / 21));
		expect(brandMonths([{ platform: 'youtube', months: yt, part: { month: '2026-09', counts: [5, 0, 0], days: 3 } }])[0].cells.views.value).toBe(31762);
	});

	it("works it out from flock's own reads up to the last read", () => {
		const rows = [
			{ published_at: '2026-09-20T18:00:00Z', history: [s('2026-10-14T18:26:00Z', 1000, 10, 1), s('2026-11-10T00:00:00Z', 1500, 15, 2)] },
			{ published_at: '2026-11-05T12:00:00Z', history: [s('2026-11-05T13:00:00Z', 10), s('2026-11-11T00:00:00Z', 300, 3, 1)] }
		];
		const until = Date.parse('2026-11-12T12:00:00Z');
		expect(partFromReads(rows, until)).toEqual({ month: '2026-11', counts: [500 + 300, 5 + 3, 1 + 1], days: 11.5 });
		// Not read from the month's first moment, or not a day in yet: none.
		expect(partFromReads(rows, Date.parse('2026-10-25T00:00:00Z'))).toBeNull();
		expect(partFromReads(rows, Date.parse('2026-11-01T06:00:00Z'))).toBeNull();
		expect(partFromReads([], until)).toBeNull();
	});
});
