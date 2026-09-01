import { pb } from './pb';
import type { LogCategory, LogEntry } from './types';

const DEVICE_KEY = 'flock.device';

/**
 * A browser cannot read the machine's hostname — there is no API for it. So the
 * device name is set once per browser and kept in localStorage; the fallback is
 * a guess from the user agent, which is enough to tell two machines apart until
 * one is named properly in Settings.
 */
function guessDevice(): string {
	if (typeof navigator === 'undefined') return 'Unknown device';
	const ua = navigator.userAgent;
	if (/Windows/i.test(ua)) return 'Windows device';
	if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
	if (/Android/i.test(ua)) return 'Android device';
	if (/iPhone|iPad/i.test(ua)) return 'iOS device';
	if (/Linux/i.test(ua)) return 'Linux device';
	return 'Unknown device';
}

export function deviceName(): string {
	if (typeof localStorage === 'undefined') return guessDevice();
	try {
		return localStorage.getItem(DEVICE_KEY)?.trim() || guessDevice();
	} catch {
		// Private windows and blocked site data both throw here.
		return guessDevice();
	}
}

export function setDeviceName(name: string) {
	if (typeof localStorage === 'undefined') return;
	try {
		const trimmed = name.trim();
		if (trimmed) localStorage.setItem(DEVICE_KEY, trimmed);
		else localStorage.removeItem(DEVICE_KEY);
	} catch {
		// Nothing to do — the log just falls back to the guessed name.
	}
}

/**
 * Records something the user did.
 *
 * Deliberately fire-and-forget: a log write must never break, block or roll
 * back the action it is describing, so failures are swallowed rather than
 * surfaced. The timestamp is PocketBase's `created`, so entries are ordered by
 * the server's clock rather than whichever machine wrote them.
 */
export function logAction(category: LogCategory, action: string, detail = ''): void {
	void pb
		.collection('activity_log')
		.create({ category, action, detail, device: deviceName() })
		.catch(() => {});
}

export async function listLog(limit = 400): Promise<LogEntry[]> {
	const res = await pb.collection('activity_log').getList(1, limit, { sort: '-created' });
	return res.items as unknown as LogEntry[];
}

export async function clearLog(): Promise<void> {
	const rows = await pb.collection('activity_log').getFullList({ fields: 'id' });
	for (const row of rows) {
		await pb.collection('activity_log').delete(row.id);
	}
}
