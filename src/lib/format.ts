export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exp;
	return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
}

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '';
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export { DAY_NAMES, MONTH_NAMES };

/** "Wed 3 Sep, 09:00" — the schedule summary format. */
export function formatSchedule(date: string, time: string): string {
	if (!date) return 'Not scheduled';
	const d = new Date(`${date}T${time || '00:00'}`);
	if (Number.isNaN(d.getTime())) return 'Invalid date';
	const month = MONTH_NAMES[d.getMonth()].slice(0, 3);
	return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${month}, ${time || '00:00'}`;
}

/** Local "YYYY-MM-DD" — never use toISOString for this, it shifts to UTC. */
export function isoDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "in 3 days", "tomorrow", "in 4 hours" — the relative hint on the review list. */
export function relativeTo(date: string, time: string, now = new Date()): string {
	if (!date) return '';
	const target = new Date(`${date}T${time || '00:00'}`);
	if (Number.isNaN(target.getTime())) return '';

	const diffMs = target.getTime() - now.getTime();
	const past = diffMs < 0;
	const mins = Math.round(Math.abs(diffMs) / 60000);

	if (mins < 1) return 'now';
	if (mins < 60) return past ? `${mins} min ago` : `in ${mins} min`;

	const hours = Math.round(mins / 60);
	if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;

	// Compare calendar days rather than 24h blocks, so "tomorrow at 09:00"
	// does not read as "in 1 day" when it is 22 hours away.
	const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOfDay(target) - startOfDay(now)) / 86400000);

	if (days === 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days === -1) return 'yesterday';
	return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday-first order, matching the calendar grid, as Date.getDay() numbers. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function dayLabel(day: number): string {
	return DAY_LABELS[day] ?? '';
}

/**
 * The first date on or after `from` whose weekday is in `days`.
 * Returns `from` unchanged when `days` is empty, so an enabled-but-empty day
 * set never sends the search into its 14-day bail-out.
 */
export function nextDayMatching(from: Date, days: number[]): Date {
	if (days.length === 0) return new Date(from);
	const walker = new Date(from);
	for (let i = 0; i < 14; i++) {
		if (days.includes(walker.getDay())) return walker;
		walker.setDate(walker.getDate() + 1);
	}
	return new Date(from);
}

/** The Monday on or before `date`, at midnight local time. */
export function startOfWeek(date: Date): Date {
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	// getDay() is Sunday-first; the calendar grid is Monday-first.
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d;
}

export function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

/** "09:00" -> 9. Anything unparseable reads as midnight. */
export function hourOf(time: string): number {
	const hour = Number.parseInt(time?.split(':')[0] ?? '', 10);
	return Number.isFinite(hour) ? hour : 0;
}

export function minuteOf(time: string): number {
	const minute = Number.parseInt(time?.split(':')[1] ?? '', 10);
	return Number.isFinite(minute) ? minute : 0;
}

export function makeTime(hour: number, minute: number): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(hour)}:${pad(minute)}`;
}

/** "Sep 2026", or "Feb – Mar 2026" when the week straddles two months. */
export function weekLabel(start: Date, end: Date): string {
	const a = MONTH_NAMES[start.getMonth()].slice(0, 3);
	const b = MONTH_NAMES[end.getMonth()].slice(0, 3);
	if (start.getFullYear() !== end.getFullYear()) {
		return `${a} ${start.getFullYear()} – ${b} ${end.getFullYear()}`;
	}
	return a === b ? `${a} ${start.getFullYear()}` : `${a} – ${b} ${start.getFullYear()}`;
}
