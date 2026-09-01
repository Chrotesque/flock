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

/** Whether this browser has already been named. */
export function isDeviceNamed(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return Boolean(localStorage.getItem(DEVICE_KEY)?.trim());
	} catch {
		return false;
	}
}

/**
 * Names this browser, once and for good.
 *
 * Permanent by design: the log attributes past actions to this name, and
 * letting it change later would silently rewrite what every existing entry
 * means. Enforced here rather than only in the UI. Returns false if the name
 * was rejected.
 */
export function setDeviceName(name: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	if (isDeviceNamed()) return false;
	const trimmed = name.trim();
	if (!trimmed) return false;
	try {
		localStorage.setItem(DEVICE_KEY, trimmed);
		return true;
	} catch {
		// Private windows and blocked site data throw; the log falls back to the
		// guessed name.
		return false;
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

/**
 * The log is append-only. There is deliberately no clear/delete helper: an
 * audit trail you can erase from the app it audits is not one.
 */
export async function listLog(limit = 400): Promise<LogEntry[]> {
	const res = await pb.collection('activity_log').getList(1, limit, { sort: '-created' });
	return res.items as unknown as LogEntry[];
}
