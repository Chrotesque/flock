import { describe, expect, it } from 'vitest';
import { clock, isValidZone, zoneTime } from './timezones';

const BERLIN = 'Europe/Berlin';

describe('isValidZone', () => {
	it('knows real zones and rejects made-up ones', () => {
		expect(isValidZone('America/Los_Angeles')).toBe(true);
		expect(isValidZone('Asia/Tokyo')).toBe(true);
		expect(isValidZone('Nowhere/Land')).toBe(false);
		expect(isValidZone('')).toBe(false);
	});
});

describe('zoneTime', () => {
	it('reads the west coast nine hours behind Berlin in summer', () => {
		// 09:00 CEST on 5 September.
		const t = zoneTime(new Date('2026-09-05T07:00:00Z'), 'America/Los_Angeles', BERLIN);
		expect(t).toEqual({ hour: 0, minute: 0, dayOffset: 0 });
	});

	it('reads the east coast six hours behind', () => {
		const t = zoneTime(new Date('2026-09-05T07:00:00Z'), 'America/New_York', BERLIN);
		expect(t).toEqual({ hour: 3, minute: 0, dayOffset: 0 });
	});

	it('marks the previous day when the zone has not reached midnight', () => {
		// 07:00 CEST on 5 September is 22:00 on the 4th in Los Angeles.
		const t = zoneTime(new Date('2026-09-05T05:00:00Z'), 'America/Los_Angeles', BERLIN);
		expect(t).toEqual({ hour: 22, minute: 0, dayOffset: -1 });
	});

	it('marks the next day for a zone ahead', () => {
		// 22:00 CEST on 5 September is 05:00 on the 6th in Tokyo.
		const t = zoneTime(new Date('2026-09-05T20:00:00Z'), 'Asia/Tokyo', BERLIN);
		expect(t).toEqual({ hour: 5, minute: 0, dayOffset: 1 });
	});

	it('follows daylight saving on both sides', () => {
		// 09:00 CET on 10 January is midnight PST.
		const t = zoneTime(new Date('2026-01-10T08:00:00Z'), 'America/Los_Angeles', BERLIN);
		expect(t).toEqual({ hour: 0, minute: 0, dayOffset: 0 });
	});

	it('keeps minutes', () => {
		const t = zoneTime(new Date('2026-09-05T07:30:00Z'), 'America/New_York', BERLIN);
		expect(t && clock(t)).toBe('03:30');
	});

	it('has nothing for a zone the runtime does not know', () => {
		expect(zoneTime(new Date(), 'Nowhere/Land', BERLIN)).toBeNull();
	});
});
