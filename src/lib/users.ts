/**
 * Profiles: who is using flock, with no logins. Each browser picks one at the
 * gate and can switch in Settings → Profiles; a profile can be a person or a
 * machine, and two browsers on one profile share its settings. Brands,
 * accounts, uploads, folders and the worker stay shared; what a profile has
 * of its own is `PERSONAL_KEYS` of the general settings and the videos hidden
 * on the Dashboard, in `app_settings` under keys ending in its id
 * (`userSettingKey`).
 *
 * Nothing here is a lock: every collection has open rules, so profiles keep
 * people from changing each other's screens, not from reading them.
 */

export interface User {
	id: string;
	name: string;
	/** Lower-cased name, unique in PocketBase. */
	key: string;
	created?: string;
}

export const USER_NAME_MAX = 60;

export function userKey(name: string): string {
	return name.trim().toLowerCase();
}

/** Why a new profile's name cannot be taken, or '' when it can. */
export function userNameProblem(name: string, users: User[]): string {
	const clean = name.trim();
	if (!clean) return 'Enter a name for the new profile.';
	if (clean.length > USER_NAME_MAX) return `A profile's name is at most ${USER_NAME_MAX} characters.`;
	if (users.some((u) => u.key === userKey(clean))) return `"${clean}" is a profile already — pick it instead.`;
	return '';
}

/** The general settings that are each profile's own; every other key stays shared. */
export const PERSONAL_KEYS = [
	'showTodo',
	'todoBrands',
	'timeZones',
	'dashboardColumns',
	'dashboardBoxes',
	'jestrIntegration'
] as const;

export type PersonalKey = (typeof PERSONAL_KEYS)[number];

/** A profile's rows in `app_settings`: their part of the general settings, and the Dashboard's hidden videos. */
export const USER_AREAS = ['user_prefs', 'dashboard_hidden'] as const;

export type UserArea = (typeof USER_AREAS)[number];

export function userSettingKey(area: UserArea, userId: string): string {
	return `${area}:${userId}`;
}

/** What a profile has of its own, in words: the Profiles tab's list, and what a copy copies. */
export const PERSONAL_WORDS = [
	"The Dashboard's columns and the stat boxes on it",
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
 * The general settings as a profile reads them: the shared row with its
 * own keys over it. A profile with no row of their own reads what everyone
 * shared before profiles existed, so nobody's screen changes the day they
 * arrive.
 */
export function withPersonal(shared: unknown, own: unknown): Record<string, unknown> {
	return { ...(isObject(shared) ? shared : {}), ...personalPart(own) };
}

/**
 * The shared row as it is written: its shared keys as they are now, its
 * personal ones as they were stored. Those are what a profile without a row of
 * their own reads, so no profile's change may move them.
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

export interface UserLine {
	user: User;
	you: boolean;
}

/** The Profiles tab's list: yours first, then by name. */
export function userLines(users: User[], currentId: string): UserLine[] {
	return users
		.map((user) => ({ user, you: user.id === currentId }))
		.sort((a, b) => Number(b.you) - Number(a.you) || a.user.name.localeCompare(b.user.name));
}

/** Why another profile's settings cannot be copied to this one, or '' when they can. */
export function copyRefusal(fromId: string, currentId: string): string {
	if (!currentId) return 'This browser has no profile yet.';
	if (fromId === currentId) return 'These are your own settings.';
	return '';
}
