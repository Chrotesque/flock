/**
 * A second clock for the week grid's time column.
 *
 * The grid is drawn in the machine's own zone; this converts each local hour
 * to another zone's wall clock so a release at 21:00 here can be read as
 * 12:00 on the US west coast without arithmetic. Two zones are built in; more
 * come from Settings, as IANA names, and are validated here before use.
 */
export interface TimeZoneChoice {
	id: string;
	label: string;
	/** An IANA zone such as `America/Los_Angeles`. */
	zone: string;
}

export const BUILT_IN_ZONES: TimeZoneChoice[] = [
	{ id: 'us-west', label: 'US West', zone: 'America/Los_Angeles' },
	{ id: 'us-east', label: 'US East', zone: 'America/New_York' }
];

export function isValidZone(zone: string): boolean {
	if (!zone.trim()) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** The calendar day of `date` in a zone, as a UTC midnight, for day arithmetic. */
function calendarDay(date: Date, zone?: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		...(zone ? { timeZone: zone } : {}),
		year: 'numeric',
		month: 'numeric',
		day: 'numeric'
	}).formatToParts(date);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return Date.UTC(get('year'), get('month') - 1, get('day'));
}

export interface ZoneTime {
	hour: number;
	minute: number;
	/** Calendar days the zone is ahead of (+) or behind (−) the reference zone at that instant. */
	dayOffset: number;
}

/**
 * The wall clock in `zone` at the instant `date`, and whether that falls on a
 * different calendar day than in the reference zone — the machine's own
 * unless one is given. Null for a zone the runtime does not know.
 */
export function zoneTime(date: Date, zone: string, reference?: string): ZoneTime | null {
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hour: 'numeric',
			minute: 'numeric',
			hourCycle: 'h23'
		}).formatToParts(date);
		const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
		const hour = get('hour');
		const minute = get('minute');
		if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
		const dayOffset = Math.round((calendarDay(date, zone) - calendarDay(date, reference)) / 86_400_000);
		return { hour: hour % 24, minute, dayOffset };
	} catch {
		return null;
	}
}

export function clock(time: ZoneTime): string {
	return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}
