import { pb } from './pb';
import type { LogCategory, LogEntry, WorkerLine } from './types';
import { userKey, type User } from './users';

/**
 * Who is using this browser: a profile (users.ts), chosen at the gate and
 * switched in Settings → Profiles. No logins — a profile is a name, and the
 * browser keeps its id and name here. The id is what writes check; the name
 * is what every Log row is signed with, kept here so a row written before the
 * profiles have loaded is still signed.
 *
 * The id key is the one 0.20.10's users used, so a browser that picked a user
 * then keeps it as its profile.
 */
const PROFILE_KEY = 'flock.user';
const PROFILE_NAME_KEY = 'flock.user.name';
/** What browsers were named before profiles: only a signature until the profile's name is known. */
const OLD_DEVICE_KEY = 'flock.device';

function read(key: string): string {
	if (typeof localStorage === 'undefined') return '';
	try {
		return localStorage.getItem(key)?.trim() ?? '';
	} catch {
		// Private windows and blocked site data both throw here.
		return '';
	}
}

/** This browser's profile id, '' while it has none. */
export function currentUserId(): string {
	return read(PROFILE_KEY);
}

/** The name this browser signs the Log with: its profile's. */
export function deviceName(): string {
	return read(PROFILE_NAME_KEY) || read(OLD_DEVICE_KEY) || 'Nobody yet';
}

/** Whether this browser has a profile. */
export function isDeviceNamed(): boolean {
	return Boolean(currentUserId());
}

/** Writes down this browser's profile, or with null that it has none (its profile was deleted). */
export function rememberUser(user: Pick<User, 'id' | 'name'> | null): void {
	try {
		if (user) {
			localStorage.setItem(PROFILE_KEY, user.id);
			localStorage.setItem(PROFILE_NAME_KEY, user.name);
		} else {
			localStorage.removeItem(PROFILE_KEY);
			localStorage.removeItem(PROFILE_NAME_KEY);
		}
	} catch {
		// a private window: asked again on the next visit
	}
}

/**
 * Makes a profile. Not behind `assertDeviceNamed`: the gate makes one for a
 * browser that has none. The unique index on `key` refuses a name taken
 * already — checking first and then writing would leave a gap.
 */
export async function createUser(name: string): Promise<User> {
	const clean = name.trim();
	const key = userKey(clean);
	try {
		return (await pb.collection('profiles').create({ name: clean, key })) as unknown as User;
	} catch (err) {
		// The SDK reports every rejection alike, so ask what happened.
		const taken = await pb
			.collection('profiles')
			.getFirstListItem(pb.filter('key={:key}', { key }))
			.catch(() => null);
		if (taken) throw new Error(`"${clean}" is a profile already — pick it instead.`);
		throw new Error(`Could not make the profile — ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Throws unless this browser has a profile.
 *
 * Called at the top of every write, so the rule survives the UI: disabling an
 * overlay or re-enabling a button in devtools still cannot get a change past
 * this, because the block is in the code that talks to PocketBase.
 */
export function assertDeviceNamed(): void {
	if (!currentUserId()) throw new Error('Choose a profile before making changes.');
}

/**
 * Records something the user did.
 *
 * Deliberately fire-and-forget: a log write must never break, block or roll
 * back the action it is describing, so failures are swallowed rather than
 * surfaced. The timestamp is PocketBase's `created`, so entries are ordered by
 * the server's clock rather than whichever machine wrote them.
 *
 * `job` names the upload a row is about, so the Log can gather everything
 * that happened to one upload; `data` is the upload's own record
 * (uploadrecord.ts), only on the row written at the confirm.
 */
export function logAction(
	category: LogCategory,
	action: string,
	detail = '',
	extra: { job?: string; data?: unknown } = {}
): void {
	void pb
		.collection('activity_log')
		.create({
			category,
			action,
			detail: trim(detail, DETAIL_MAX),
			device: deviceName(),
			...(extra.job ? { job: extra.job } : {}),
			...(extra.data !== undefined ? { data: extra.data } : {})
		})
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
	// Of an upload's record only how each post was sent (`data.timing`); the
	// rest is read on the upload's own page.
	const res = await pb.collection('activity_log').getList(1, limit, {
		sort: '-created',
		fields: 'id,category,action,detail,device,job,created,data.timing'
	});
	return res.items as unknown as LogEntry[];
}

/** One row, record included; null when there is no such row. */
export async function getLogEntry(id: string): Promise<LogEntry | null> {
	try {
		return (await pb.collection('activity_log').getOne(id)) as unknown as LogEntry;
	} catch {
		return null;
	}
}

/** Every row about one upload, oldest first, records included. */
export async function listJobLog(job: string): Promise<LogEntry[]> {
	const rows = await pb.collection('activity_log').getFullList({
		filter: pb.filter('job = {:job}', { job }),
		sort: 'created'
	});
	return rows as unknown as LogEntry[];
}

/** The worker's console lines printed for one upload, oldest first (kept 14 days). */
export async function listJobWorkerLines(job: string): Promise<WorkerLine[]> {
	const rows = await pb.collection('worker_log').getFullList({
		filter: pb.filter('job = {:job}', { job }),
		sort: 'created'
	});
	return rows as unknown as WorkerLine[];
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
