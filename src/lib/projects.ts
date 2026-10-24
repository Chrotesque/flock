import { isPlatformId } from './platforms';
import { sameFolder } from './folders';
import type {
	OptionValue,
	OptionValues,
	PlatformId,
	PlatformText,
	ProjectRow,
	WatchFile,
	WatchFolder
} from './types';

/**
 * Project folders: a subfolder of a configured project folder that holds a
 * flock JSON file (worker/projects.mjs finds them). Each is a `projects` row;
 * the sidebar lists those not yet sent, and the upload it opens is kept on
 * the row as it is written (`draft`, below), so it can be picked up again
 * after a restart or on another machine.
 */

/** Which video a platform gets — draft.svelte.ts's VideoSlot. */
export type Slot = 'all' | PlatformId;

export const SAVED_VERSION = 1;

/**
 * An upload in progress, as kept on its project row. Videos are kept only
 * when they were picked from a listing — a file chosen in the browser has
 * no path to come back to — and the images go on the row as files.
 */
export interface SavedDraft {
	v: typeof SAVED_VERSION;
	/** The project file's `manifest_modified` when its text was filled in. */
	base: string;
	brand: string;
	step: 0 | 1 | 2 | 3;
	composing: PlatformId | null;
	/** The upload's product name (since 0.17.3; '' before). */
	product: string;
	texts: Partial<Record<PlatformId, PlatformText>>;
	selected: Partial<Record<PlatformId, boolean>>;
	overrides: Partial<Record<PlatformId, OptionValues>>;
	schedule: Partial<Record<PlatformId, { date: string; time: string }>>;
	immediate: Partial<Record<PlatformId, boolean>>;
	profile: Partial<Record<PlatformId, string>>;
	split: PlatformId[];
	videos: Partial<Record<Slot, WatchFile>>;
	imagesLinked: boolean;
	/** The images' own names; PocketBase stores them under suffixed ones. */
	thumbnailName: string;
	coverName: string;
	/** Slots already written by a confirm that failed part-way. */
	queued: Slot[];
	/** Hand-picked choices were left out on saving (see HAND_PICKED). */
	repick: boolean;
}

/**
 * What TikTok's Content Sharing Guidelines want chosen by hand on every
 * post — the audience, comments, Duet, Stitch and the disclosure — and the
 * paid-promotion tick that writes TikTok's disclosure too. Never kept in a
 * saved draft, for the reason a flock block never fills them: whatever the
 * page puts there without a click is the default the guidelines forbid.
 */
export const HAND_PICKED: Partial<Record<PlatformId, readonly string[]>> = {
	tiktok: ['privacy', 'allowComments', 'allowDuet', 'allowStitch', 'discloseContent', 'brandOrganic', 'brandContent', 'disclosure'],
	youtube: ['paidPromotion']
};

/** The overrides without the hand-picked choices, and whether any were there. */
export function withoutHandPicked(overrides: Partial<Record<PlatformId, OptionValues>>): {
	overrides: Partial<Record<PlatformId, OptionValues>>;
	dropped: boolean;
} {
	let dropped = false;
	const out: Partial<Record<PlatformId, OptionValues>> = {};
	for (const [id, values] of Object.entries(overrides) as [PlatformId, OptionValues][]) {
		const skip = HAND_PICKED[id] ?? [];
		const kept: OptionValues = {};
		for (const [key, value] of Object.entries(values ?? {})) {
			if (skip.includes(key)) {
				// An unticked box was never a choice worth mentioning.
				if (value !== false && value !== '') dropped = true;
				continue;
			}
			kept[key] = value;
		}
		if (Object.keys(kept).length > 0) out[id] = kept;
	}
	return { overrides: out, dropped };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of a record keyed by platform, each passed through `read`. */
function perPlatform<T>(raw: unknown, read: (value: unknown) => T | undefined): Partial<Record<PlatformId, T>> {
	const out: Partial<Record<PlatformId, T>> = {};
	if (!isRecord(raw)) return out;
	for (const [key, value] of Object.entries(raw)) {
		if (!isPlatformId(key)) continue;
		const read_ = read(value);
		if (read_ !== undefined) out[key] = read_;
	}
	return out;
}

function isOptionValue(value: unknown): value is OptionValue {
	return (
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value)) ||
		(Array.isArray(value) && value.every((v) => typeof v === 'string'))
	);
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** A listed video as stored, or undefined when it is not one. */
export function readWatchFile(raw: unknown): WatchFile | undefined {
	if (!isRecord(raw) || typeof raw.path !== 'string' || !raw.path || typeof raw.name !== 'string') return undefined;
	return {
		name: raw.name,
		path: raw.path,
		size: typeof raw.size === 'number' && raw.size > 0 ? raw.size : 0,
		modified: str(raw.modified),
		...(raw.local === true ? { local: true } : {})
	};
}

export function readVideos(raw: unknown): WatchFile[] {
	return Array.isArray(raw) ? raw.map(readWatchFile).filter((f): f is WatchFile => Boolean(f)) : [];
}

function isSlot(value: unknown): value is Slot {
	return value === 'all' || (typeof value === 'string' && isPlatformId(value));
}

/**
 * A saved draft read back field by field — it was written by some build of
 * this page, maybe an older one, and nothing is trusted to have the shape
 * this one expects. Null when it is not a draft at all.
 */
export function readSavedDraft(raw: unknown): SavedDraft | null {
	if (!isRecord(raw) || raw.v !== SAVED_VERSION) return null;
	const step = Number(raw.step);
	const videos: Partial<Record<Slot, WatchFile>> = {};
	if (isRecord(raw.videos)) {
		for (const [slot, file] of Object.entries(raw.videos)) {
			const read = readWatchFile(file);
			if (isSlot(slot) && read) videos[slot] = read;
		}
	}
	return {
		v: SAVED_VERSION,
		base: str(raw.base),
		brand: str(raw.brand),
		step: step === 1 || step === 2 || step === 3 ? step : 0,
		composing: typeof raw.composing === 'string' && isPlatformId(raw.composing) ? raw.composing : null,
		product: str(raw.product),
		texts: perPlatform(raw.texts, (v) =>
			isRecord(v) ? { title: str(v.title), description: str(v.description) } : undefined
		),
		selected: perPlatform(raw.selected, (v) => (typeof v === 'boolean' ? v : undefined)),
		overrides: withoutHandPicked(
			perPlatform(raw.overrides, (v) => {
				if (!isRecord(v)) return undefined;
				const out: OptionValues = {};
				for (const [key, value] of Object.entries(v)) if (isOptionValue(value)) out[key] = value;
				return out;
			})
		).overrides,
		schedule: perPlatform(raw.schedule, (v) =>
			isRecord(v) && typeof v.date === 'string' && typeof v.time === 'string'
				? { date: v.date, time: v.time }
				: undefined
		),
		immediate: perPlatform(raw.immediate, (v) => (typeof v === 'boolean' ? v : undefined)),
		profile: perPlatform(raw.profile, (v) => (typeof v === 'string' ? v : undefined)),
		split: Array.isArray(raw.split) ? [...new Set(raw.split.filter((id): id is PlatformId => typeof id === 'string' && isPlatformId(id)))] : [],
		videos,
		imagesLinked: raw.imagesLinked !== false,
		thumbnailName: str(raw.thumbnailName),
		coverName: str(raw.coverName),
		queued: Array.isArray(raw.queued) ? [...new Set(raw.queued.filter(isSlot))] : [],
		repick: raw.repick === true
	};
}

/** What the worker renames a sent project's file to — worker/projects.mjs, without a clash. */
export function uploadedName(name: string): string {
	return `${(name || 'flock.json').replace(/\.json$/i, '')}_uploaded.json`;
}

export type ProjectState = 'new' | 'started' | 'done';

export function projectState(row: Pick<ProjectRow, 'status'>): ProjectState {
	if (row.status === 'uploaded' || row.status === 'dismissed') return 'done';
	return row.status === 'started' ? 'started' : 'new';
}

/**
 * The projects the sidebar lists: not sent or removed, still on disk, and
 * under a project folder Settings still names — taking a folder out of the
 * list takes its projects out of the sidebar, without touching their rows.
 * Started ones first, then the newest project files.
 */
export function listedProjects(rows: ProjectRow[], roots: WatchFolder[]): ProjectRow[] {
	const configured = roots.map((r) => r.path).filter((p) => p.trim());
	return rows
		.filter((row) => projectState(row) !== 'done' && !row.missing)
		.filter((row) => configured.some((root) => sameFolder(root, row.root)))
		.sort((a, b) => {
			const started = Number(projectState(b) === 'started') - Number(projectState(a) === 'started');
			if (started) return started;
			return (b.manifest_modified || b.created).localeCompare(a.manifest_modified || a.created);
		});
}
