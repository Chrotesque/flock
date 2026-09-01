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
