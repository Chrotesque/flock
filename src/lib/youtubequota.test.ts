import { describe, expect, it } from 'vitest';
import {
	editReserve,
	editUnits,
	fastestSafePace,
	kindSummaries,
	nextPacificMidnight,
	onCourseFor,
	paceVerdict,
	pacificDay,
	projectPace,
	quotaToday,
	readQuotaHistory,
	refreshDue,
	secondsWords,
	stopToday,
	stopWords
} from './youtubequota';
import type { StatsStatus } from './types';

// 02:24 UTC on 23 Oct is still 22 Oct in California.
const NOW = Date.parse('2026-10-23T02:24:00Z');
const MIN = 60_000;

const status = (over: Partial<StatsStatus> = {}): StatsStatus => ({
	polledAt: '2026-10-23T02:23:30Z',
	unitsToday: 8100,
	budget: 8000,
	ceiling: 9000,
	stopped: '',
	intervalSeconds: 90,
	videos: 0,
	error: '',
	quota: { day: '2026-10-22', units: 8100, kinds: { stats: 7800, playlist: 250, rename: 51 }, uploads: 13 },
	...over
});

describe('the Pacific day', () => {
	it('turns at 07:00 UTC in summer time and 08:00 in winter', () => {
		expect(pacificDay(NOW)).toBe('2026-10-22');
		expect(pacificDay(Date.parse('2026-10-23T07:00:00Z'))).toBe('2026-10-23');
		expect(pacificDay(Date.parse('2026-12-01T07:59:00Z'))).toBe('2026-11-30');
	});

	it('has its next midnight where Google resets the quota, the night the clocks change too', () => {
		expect(new Date(nextPacificMidnight(NOW)).toISOString()).toBe('2026-10-23T07:00:00.000Z');
		expect(new Date(nextPacificMidnight(Date.parse('2026-12-01T12:00:00Z'))).toISOString()).toBe('2026-12-02T08:00:00.000Z');
		// The US clocks go back at 02:00 on 1 Nov 2026: that midnight is still summer time.
		expect(new Date(nextPacificMidnight(Date.parse('2026-10-31T20:00:00Z'))).toISOString()).toBe('2026-11-01T07:00:00.000Z');
		expect(new Date(nextPacificMidnight(Date.parse('2026-11-01T12:00:00Z'))).toISOString()).toBe('2026-11-02T08:00:00.000Z');
	});
});

describe('quotaToday', () => {
	it('lists every kind of work in order, other only when something went on it', () => {
		const q = quotaToday(status(), NOW)!;
		expect(q.units).toBe(8100);
		expect(q.uploads).toBe(13);
		expect(q.ceiling).toBe(9000);
		expect(q.rows.map((r) => [r.kind, r.units])).toEqual([
			['stats', 7800],
			['playlist', 250],
			['rename', 51],
			['move', 0],
			['release', 0],
			['delete', 0],
			['channel', 0]
		]);
		const odd = quotaToday(status({ quota: { day: '2026-10-22', units: 3, kinds: { other: 3 }, uploads: 0 } }), NOW)!;
		expect(odd.rows.at(-1)).toMatchObject({ kind: 'other', units: 3 });
	});

	it("counts an earlier day's record as nothing spent yet", () => {
		const q = quotaToday(status({ quota: { day: '2026-10-21', units: 8100, kinds: { stats: 8100 }, uploads: 4 } }), NOW)!;
		expect(q.units).toBe(0);
		expect(q.uploads).toBe(0);
		expect(q.rows.every((r) => r.units === 0)).toBe(true);
	});

	it('reads a heartbeat from before every kind was counted as the stats alone', () => {
		const q = quotaToday(status({ quota: undefined, ceiling: undefined, unitsToday: 3355, budget: 6000 }), NOW)!;
		expect(q.units).toBe(3355);
		expect(q.rows[0]).toMatchObject({ kind: 'stats', units: 3355 });
		expect(q.uploads).toBeNull();
		expect(q.ceiling).toBe(6000);
	});

	it('has nothing without a heartbeat', () => {
		expect(quotaToday(null, NOW)).toBeNull();
	});
});

describe('the stops and the Refresh button', () => {
	const read = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN).toISOString();

	it('turns red once the automatic reads stopped and the numbers are five minutes old', () => {
		expect(refreshDue(status({ stopped: 'auto', polledAt: read(4) }), NOW)).toBe(false);
		expect(refreshDue(status({ stopped: 'auto', polledAt: read(5) }), NOW)).toBe(true);
	});

	it('goes grey for five minutes when pressed, whether or not the read came', () => {
		const old = status({ stopped: 'auto', polledAt: read(20) });
		expect(refreshDue(old, NOW, NOW - 2 * MIN)).toBe(false);
		expect(refreshDue(old, NOW, NOW - 6 * MIN)).toBe(true);
	});

	it('stays grey while the reads run, past the ceiling, and for a stop said yesterday', () => {
		expect(refreshDue(status({ polledAt: read(20) }), NOW)).toBe(false);
		expect(refreshDue(status({ stopped: 'ceiling', polledAt: read(20) }), NOW)).toBe(false);
		const yesterday = status({ stopped: 'auto', polledAt: read(600), quota: { day: '2026-10-21', units: 8000, kinds: {}, uploads: 0 } });
		expect(stopToday(yesterday, NOW)).toBe('');
		expect(refreshDue(yesterday, NOW)).toBe(false);
	});

	it('says which stop holds and when it lifts', () => {
		const q = quotaToday(status(), NOW)!;
		expect(stopWords('', q, NOW)).toBe('');
		expect(stopWords('auto', q, NOW)).toMatch(/^Automatic reads stopped at 8,000 units; Refresh still reads until 9,000\. Resumes at midnight Pacific \(.+ here\)\.$/);
		expect(stopWords('ceiling', q, NOW)).toMatch(/^Reads stopped at 9,000 units; the rest is kept for/);
		expect(stopWords('exhausted', q, NOW)).toMatch(/^YouTube says today's quota is used up\./);
	});
});

describe('the pace of the stats reads', () => {
	it('costs what 23 Oct 2026 measured at 30 s over three channels: 173 an hour', () => {
		const p = projectPace(30, 3);
		expect(p.perHour).toBeCloseTo(173.14, 1);
		expect(p.stats).toBe(4155);
		expect(p.checks).toBe(144);
		expect(p.channelEvery).toBe(90);
	});

	it('re-reads every listing at each read once a channel comes round slower than its timers', () => {
		// Each channel every 30 min: 6 reads an hour, and each channel's three listings twice.
		expect(projectPace(600, 3).perHour).toBeCloseTo(6 + 3 * 6, 5);
	});

	it("keeps to the worker's limits", () => {
		expect(projectPace(1, 3).seconds).toBe(5);
		expect(projectPace(99_999, 3).seconds).toBe(3600);
		expect(projectPace(30, 0).channels).toBe(1);
	});

	it('lets a pace through only while a day of it, with the edits, stays under the stop', () => {
		const fast = paceVerdict(projectPace(10, 3), 500, 8000);
		expect(fast.ok).toBe(false);
		expect(fast.total).toBe(10_080 + 144 + 500);
		expect(fast.stopsAfter).toBeCloseTo((8000 * 24) / 10_724, 5);
		const fine = paceVerdict(projectPace(30, 3), 500, 8000);
		expect(fine).toEqual({ total: 4799, headroom: 3201, ok: true, stopsAfter: null });
		expect(fastestSafePace(3, 500, 8000)).toBe(15);
		expect(fastestSafePace(3, 2000, 8000)).toBe(20);
	});

	it('words a pace', () => {
		expect(secondsWords(45)).toBe('45 s');
		expect(secondsWords(90)).toBe('1 min 30 s');
		expect(secondsWords(600)).toBe('10 min');
		expect(secondsWords(3600)).toBe('1 h');
		expect(secondsWords(5400)).toBe('1 h 30 min');
	});

	it('says what today will have spent by midnight Pacific at the pace', () => {
		// 02:24 UTC: 4 h 36 min to midnight Pacific.
		expect(onCourseFor(3489, projectPace(30, 3), NOW)).toBe(Math.round(3489 + 4.6 * (173.1428 + 6)));
	});
});

describe('the history of what the units went on', () => {
	const history = {
		days: {
			'2026-10-20': { units: 4300, kinds: { stats: 4100, channel: 100, playlist: 100 }, uploads: 3, events: [['2026-10-20T10:00:00Z', 'playlist', 100]] },
			'2026-10-22': { units: 4600, kinds: { stats: 4150, channel: 144, rename: 51, move: 255 }, uploads: 13, events: [['x', 'move', 51]] },
			'2026-10-21': { units: 4200, kinds: { stats: 4200 }, uploads: 0, events: [] },
			nonsense: { units: 1 }
		}
	};

	it('reads the days field by field, newest first', () => {
		const days = readQuotaHistory(history);
		expect(days.map((d) => d.day)).toEqual(['2026-10-22', '2026-10-21', '2026-10-20']);
		expect(days[0].events).toEqual([]);
		expect(days[2].events).toHaveLength(1);
		expect(readQuotaHistory(null)).toEqual([]);
	});

	it('counts the edits apart from the reads and checks, and never reserves less than 500', () => {
		const days = readQuotaHistory(history);
		expect(editUnits(days[0].kinds)).toBe(306);
		expect(editReserve(days)).toBe(500);
		expect(editReserve(days, 700)).toBe(700);
		expect(editReserve([{ ...days[0], kinds: { move: 1200 } }])).toBe(1200);
	});

	it("gives each kind today's, a typical day's and the most a day took", () => {
		const rows = kindSummaries({ stats: 3000, rename: 51 }, readQuotaHistory(history));
		const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
		expect(by.stats).toMatchObject({ today: 3000, typical: 4150, most: 4200 });
		expect(by.move).toMatchObject({ today: 0, typical: 0, most: 255 });
		expect(by.playlist).toMatchObject({ typical: 0, most: 100 });
		expect(rows.some((r) => r.kind === 'other')).toBe(false);
	});
});
