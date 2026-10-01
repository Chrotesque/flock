import { pb } from './pb';
import type { LogCategory, LogEntry, WorkerLine } from './types';

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
 * Claims a name for this browser, once and for good.
 *
 * Permanent by design: the log attributes past actions to this name, and
 * letting it change later would silently rewrite what every existing entry
 * means.
 *
 * The name is registered in the `devices` collection first. Its unique index is
 * what enforces uniqueness — checking for a clash and then writing would let two
 * machines claim the same name in the gap.
 */
export async function claimDeviceName(
	name: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const trimmed = name.trim();
	if (!trimmed) return { ok: false, reason: 'Enter a name for this device.' };
	if (isDeviceNamed()) return { ok: false, reason: 'This browser already has a name.' };

	const key = trimmed.toLowerCase();

	try {
		await pb.collection('devices').create({ name: trimmed, key });
	} catch (err) {
		// The SDK reports every rejection as "Failed to create record", so ask
		// what actually happened rather than pattern-matching that string. The
		// unique index still does the enforcing — this only picks the message.
		const taken = await pb
			.collection('devices')
			.getFirstListItem(pb.filter('key={:key}', { key }))
			.catch(() => null);

		if (taken) {
			return { ok: false, reason: `"${trimmed}" is already used by another machine.` };
		}
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `Could not register the name — ${message}` };
	}

	try {
		localStorage.setItem(DEVICE_KEY, trimmed);
	} catch {
		return { ok: false, reason: 'This browser refused to store the name (private window?).' };
	}
	return { ok: true };
}

/**
 * Throws unless this browser has been named.
 *
 * Called at the top of every write, so the rule survives the UI: disabling an
 * overlay or re-enabling a button in devtools still cannot get a change past
 * this, because the block is in the code that talks to PocketBase.
 */
export function assertDeviceNamed(): void {
	if (!isDeviceNamed()) {
		throw new Error('Name this device in Settings before making changes.');
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
		.create({ category, action, detail: trim(detail, DETAIL_MAX), device: deviceName() })
		.catch(() => {});
}

/** `activity_log.detail` is capped at 2000 characters in the schema. */
const DETAIL_MAX = 1900;

function trim(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}… (${text.length} characters)`;
}

/**
 * The log is append-only. There is deliberately no clear/delete helper: an
 * audit trail you can erase from the app it audits is not one.
 */
export async function listLog(limit = 400): Promise<LogEntry[]> {
	const res = await pb.collection('activity_log').getList(1, limit, { sort: '-created' });
	return res.items as unknown as LogEntry[];
}

/**
 * The worker's console, newest first. Written by the worker alone and pruned
 * by it after 14 days — see worker/remotelog.mjs.
 */
export async function listWorkerLog(limit = 1500): Promise<WorkerLine[]> {
	const res = await pb
		.collection('worker_log')
		.getList(1, limit, { sort: '-created', skipTotal: true });
	return res.items as unknown as WorkerLine[];
}

/** New worker lines as they are written. Returns the unsubscribe. */
export function subscribeWorkerLog(onLine: (line: WorkerLine) => void): () => void {
	const sub = pb.collection('worker_log').subscribe('*', (e) => {
		if (e.action === 'create') onLine(e.record as unknown as WorkerLine);
	});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}
