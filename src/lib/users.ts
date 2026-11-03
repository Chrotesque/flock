/**
 * The people using flock, with no logins. A browser is named once and says
 * whose it is (the gate over every page); from then on it is that user's
 * flock. Brands, accounts, uploads, folders and the worker stay shared; what
 * each user has of their own is `PERSONAL_KEYS` of the general settings and
 * the videos hidden on the Dashboard, in `app_settings` under keys ending in
 * the user's id (`userSettingKey`).
 *
 * Nothing here is a lock: every collection has open rules, so users keep
 * people from changing each other's screens, not from reading them.
 */

export interface User {
	id: string;
	name: string;
	/** Lower-cased name, unique in PocketBase — devices.key's trick. */
	key: string;
	created?: string;
}

export interface DeviceRow {
	id: string;
	name: string;
	key: string;
	/** The user's id, '' while the browser has not said whose it is. */
	user: string;
	created?: string;
}

export const USER_NAME_MAX = 60;

export function userKey(name: string): string {
	return name.trim().toLowerCase();
}

/** Why a new user's name cannot be taken, or '' when it can. */
export function userNameProblem(name: string, users: User[]): string {
	const clean = name.trim();
	if (!clean) return 'Enter a name for the new user.';
	if (clean.length > USER_NAME_MAX) return `A user's name is at most ${USER_NAME_MAX} characters.`;
	if (users.some((u) => u.key === userKey(clean))) return `"${clean}" is a user already — pick it instead.`;
	return '';
}

/** The general settings that are each user's own; every other key stays shared. */
export const PERSONAL_KEYS = ['showTodo', 'todoBrands', 'timeZones', 'dashboardColumns', 'jestrIntegration'] as const;

export type PersonalKey = (typeof PERSONAL_KEYS)[number];

/** A user's rows in `app_settings`: their part of the general settings, and the Dashboard's hidden videos. */
export const USER_AREAS = ['user_prefs', 'dashboard_hidden'] as const;

export type UserArea = (typeof USER_AREAS)[number];

export function userSettingKey(area: UserArea, userId: string): string {
	return `${area}:${userId}`;
}

/** What a user has of their own, in words: the Users tab's list, and what a copy copies. */
export const PERSONAL_WORDS = [
	"The Dashboard's columns",
	'The To finish indicator, and the brands it follows',
	'Extra time zones',
	'The Jestr integration',
	'Videos hidden on the Dashboard'
];

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The personal keys of a settings blob, and nothing else. */
export function personalPart(value: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!isObject(value)) return out;
	for (const key of PERSONAL_KEYS) if (key in value) out[key] = value[key];
	return out;
}

/**
 * The general settings as a user reads them: the shared row with the user's
 * own keys over it. A user with no row of their own reads what everyone
 * shared before users existed, so nobody's screen changes the day they
 * arrive.
 */
export function withPersonal(shared: unknown, own: unknown): Record<string, unknown> {
	return { ...(isObject(shared) ? shared : {}), ...personalPart(own) };
}

/**
 * The shared row as it is written: its shared keys as they are now, its
 * personal ones as they were stored. Those are what a user without a row of
 * their own reads, so no user's change may move them.
 */
export function sharedPart(value: Record<string, unknown>, stored: unknown): Record<string, unknown> {
	const was = isObject(stored) ? stored : {};
	const out = { ...value };
	for (const key of PERSONAL_KEYS) {
		if (key in was) out[key] = was[key];
		else delete out[key];
	}
	return out;
}

/** Whose a browser is: its device row's user, while that user exists; '' otherwise. */
export function userOfDevice(deviceName: string, devices: DeviceRow[], users: User[]): string {
	const key = deviceName.trim().toLowerCase();
	const row = devices.find((d) => d.key === key);
	if (!row?.user) return '';
	return users.some((u) => u.id === row.user) ? row.user : '';
}

export interface UserLine {
	user: User;
	/** The names of the browsers that are this user's, oldest first. */
	devices: string[];
	you: boolean;
}

/** The Users tab's list: you first, then by name. */
export function userLines(users: User[], devices: DeviceRow[], currentId: string): UserLine[] {
	const byAge = [...devices].sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
	return users
		.map((user) => ({
			user,
			devices: byAge.filter((d) => d.user === user.id).map((d) => d.name),
			you: user.id === currentId
		}))
		.sort((a, b) => Number(b.you) - Number(a.you) || a.user.name.localeCompare(b.user.name));
}

/** Browsers named before users existed, or whose user was deleted: asked on their next visit. */
export function devicesWithoutUser(devices: DeviceRow[], users: User[]): string[] {
	const known = new Set(users.map((u) => u.id));
	return devices.filter((d) => !d.user || !known.has(d.user)).map((d) => d.name);
}

/** Why a user cannot be deleted from this browser, or '' when it can. */
export function deleteRefusal(userId: string, currentId: string): string {
	if (userId === currentId) return 'This is you. It can be deleted from another user’s browser.';
	return '';
}

/** Why another user's settings cannot be copied to this one, or '' when they can. */
export function copyRefusal(fromId: string, currentId: string): string {
	if (!currentId) return 'This browser has no user yet.';
	if (fromId === currentId) return 'These are your own settings.';
	return '';
}
