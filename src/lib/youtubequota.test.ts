import { describe, expect, it } from 'vitest';
import { nextPacificMidnight, pacificDay, quotaToday, refreshDue, stopToday, stopWords } from './youtubequota';
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
