import { pb, PB_URL } from './pb';
import { PLATFORMS, PLATFORM_IDS, isPlatformId } from './platforms';
import { MoveRefused, landReason, lockReason } from './reschedule';
import { actionPlan, groupRefusal, type PostAction } from './postactions';
import { DEFAULT_SCHEDULING } from './types';
import { logAction, assertDeviceNamed, deviceName } from './log';
import { MOVING, canMove, planMove, readMove, type MoveRequest, type MoveStep } from './brandmove';
import { newId } from './id';
import { firstLine, formatSchedule } from './format';
import { STATS_FIELDS, UPLOAD_FIELDS, type StatsRow, type UploadRow } from './videotodo';
import { canRetry, retryWhen } from './attention';
import {
	FIRST_BRAND_NAME,
	brandKey,
	brandSettingKey,
	orderBrands,
	rowsToAdopt,
	type SettingsRowRef
} from './brands';
import type { WorkerBeat, WorkerBeats, WorkerRole } from './workerstatus';
import type { UploadRecord } from './uploadrecord';
import type { DashTarget, StatsVideo } from './dashboard';
import type { ReelPlatform, ReelRow, Sample, YouTubeRow } from './releases';
import { cleanName, readTitleRequest, type TitleRequest } from './retitle';
import type {
	Account,
	Brand,
	OptionValues,
	PlatformId,
	WatchIndex,
	LocalIndex,
	ProjectRow,
	PreviewServer,
	UsedSource,
	PlaylistIndex,
	PlatformScheduling,
	PlatformSettings,
	UploadJob,
	UploadTarget,
	VideoStats,
	StatsStatus
} from './types';

/* ------------------------------------------------------------------ */
/* brands                                                               */
/* ------------------------------------------------------------------ */

/** The per-brand `app_settings` areas, by their key before brands existed. */
const BRAND_SETTINGS = ['templates', 'recent_tags'] as const;

/** A brand's account choices, keeping only platforms the registry knows. */
function brandAccounts(stored: unknown): Brand['accounts'] {
	const out: Brand['accounts'] = {};
	if (!stored || typeof stored !== 'object') return out;
	for (const [platform, id] of Object.entries(stored as Record<string, unknown>)) {
		if (isPlatformId(platform) && typeof id === 'string' && id) out[platform] = id;
	}
	return out;
}

function toBrand(row: Record<string, unknown>): Brand {
	return {
		id: String(row.id),
		name: String(row.name ?? ''),
		sort_order: Number(row.sort_order ?? 0),
		accounts: brandAccounts(row.accounts)
	};
}

/** The accounts the worker posts as, as it last read them — every platform. */
export async function loadAccounts(): Promise<Account[]> {
	const rows = await pb.collection('accounts').getFullList({ sort: 'platform,handle' });
	return rows
		.filter((row) => isPlatformId(row.platform))
		.map((row) => ({
			id: row.id,
			platform: row.platform as PlatformId,
			account_id: String(row.account_id ?? ''),
			handle: String(row.handle ?? ''),
			name: String(row.name ?? ''),
			details: row.details && typeof row.details === 'object' ? (row.details as Record<string, unknown>) : null,
			error: String(row.error ?? ''),
			fetched_at: String(row.fetched_at ?? '')
		}));
}

/**
 * Sets which account a brand posts as on each platform. `label` names the
 * change for the log, since an account id means nothing to a reader.
 */
export async function setBrandAccounts(
	brand: Brand,
	accounts: Brand['accounts'],
	label: string
): Promise<void> {
	assertDeviceNamed();
	await pb.collection('brands').update(brand.id, { accounts });
	logAction('settings', `${brand.name}: ${label}`);
}

export async function listBrands(): Promise<Brand[]> {
	const rows = await pb.collection('brands').getFullList({ sort: 'sort_order,name' });
	return orderBrands(rows.map(toBrand));
}

/**
 * The brands, made sure of. With none yet — the first load after brands
 * arrived — the settings that already existed become the first brand.
 * Initialisation, like seeding platform rows, so not device-guarded; and
 * idempotent, so every load runs it and also takes in anything an older
 * build of the app wrote without a brand.
 */
export async function ensureBrands(): Promise<Brand[]> {
	let brands = await listBrands();
	if (brands.length === 0) {
		try {
			await pb
				.collection('brands')
				.create({ name: FIRST_BRAND_NAME, key: brandKey(FIRST_BRAND_NAME), sort_order: 0 });
		} catch {
			// Another browser created it first; the unique key refused this one.
		}
		brands = await listBrands();
		if (brands.length === 0) throw new Error('Could not create the first brand.');
	}
	await adoptBrandless(brands[0]);
	return brands;
}

/**
 * Hands the first brand everything that has no brand: settings rows and the
 * per-brand `app_settings` areas from before brands existed, and jobs that
 * never had one. A job whose brand was deleted keeps its name snapshot, which
 * is what tells it apart from one that never had a brand.
 */
async function adoptBrandless(first: Brand) {
	const rows = await pb
		.collection('platform_settings')
		.getFullList({ fields: 'id,brand,platform' });
	for (const row of rowsToAdopt(rows as unknown as SettingsRowRef[], first.id, PLATFORM_IDS)) {
		await pb.collection('platform_settings').update(row.id, { brand: first.id });
	}

	for (const base of BRAND_SETTINGS) {
		const old = await findSetting(base);
		if (!old) continue;
		// Renamed rather than copied: one write, and nothing left behind to be
		// adopted a second time by some later first brand.
		if (!(await findSetting(brandSettingKey(base, first.id)))) {
			await pb.collection('app_settings').update(old.id, { key: brandSettingKey(base, first.id) });
		}
	}

	const jobs = await pb
		.collection('upload_jobs')
		.getFullList({ filter: 'brand = "" && brand_name = ""', fields: 'id' });
	for (const job of jobs) {
		await pb.collection('upload_jobs').update(job.id, { brand: first.id, brand_name: first.name });
	}
}

/**
 * A new brand, optionally starting as a copy of another: its platform
 * settings row for row and its templates. Recent tags are not copied — they
 * are a memory of what this brand used, and it has used nothing yet — and
 * neither are its accounts: a new brand is usually a new set of accounts, and
 * starting from another brand's would post to them until somebody noticed.
 */
export async function createBrand(name: string, sortOrder: number, copyFrom: Brand | null): Promise<Brand> {
	assertDeviceNamed();
	const created = toBrand(
		await pb
			.collection('brands')
			.create({ name: name.trim(), key: brandKey(name), sort_order: sortOrder, accounts: {} })
	);

	if (copyFrom) {
		const rows = await pb
			.collection('platform_settings')
			.getFullList({ filter: `brand="${copyFrom.id}"` });
		for (const row of rows) {
			await pb.collection('platform_settings').create({
				brand: created.id,
				platform: row.platform,
				enabled: row.enabled,
				sort_order: row.sort_order,
				defaults: row.defaults,
				filters: row.filters,
				scheduling: row.scheduling
			});
		}
		const templates = await findSetting(brandSettingKey('templates', copyFrom.id));
		if (templates) {
			await pb
				.collection('app_settings')
				.create({ key: brandSettingKey('templates', created.id), value: templates.value });
		}
	}

	logAction('settings', `Added brand ${created.name}`, copyFrom ? `copied from ${copyFrom.name}` : '');
	return created;
}

export async function renameBrand(brand: Brand, name: string): Promise<void> {
	assertDeviceNamed();
	await pb.collection('brands').update(brand.id, { name: name.trim(), key: brandKey(name) });
	logAction('settings', `Renamed brand ${brand.name} to ${name.trim()}`);
}

/** Writes the order given, renumbered from 0; only rows that moved are sent. */
export async function reorderBrands(ordered: Brand[]): Promise<void> {
	assertDeviceNamed();
	for (const [index, brand] of ordered.entries()) {
		if (brand.sort_order !== index) {
			await pb.collection('brands').update(brand.id, { sort_order: index });
		}
	}
	logAction('settings', 'Reordered brands', ordered.map((b) => b.name).join(', '));
}

/**
 * Deletes a brand with its settings (the relation cascades) and its
 * per-brand `app_settings` areas. Its uploads stay: the relation on each job
 * empties and the name snapshot remains, and anything still queued goes out
 * as composed — the targets carry everything they need.
 */
export async function deleteBrand(brand: Brand): Promise<void> {
	assertDeviceNamed();
	for (const base of BRAND_SETTINGS) {
		const row = await findSetting(brandSettingKey(base, brand.id));
		if (row) await pb.collection('app_settings').delete(row.id);
	}
	await pb.collection('brands').delete(brand.id);
	logAction('settings', `Deleted brand ${brand.name}`);
}

/* ------------------------------------------------------------------ */
/* platform settings                                                    */
/* ------------------------------------------------------------------ */

/**
 * Scheduling config is merged over the defaults rather than replaced, so a row
 * written before this feature existed comes back with a usable mode and time
 * instead of undefined.
 */
function mergeScheduling(stored: unknown): PlatformScheduling {
	const value = (stored ?? {}) as Partial<PlatformScheduling>;
	return {
		mode: value.mode === 'profiles' ? 'profiles' : 'time',
		defaultTime: value.defaultTime || DEFAULT_SCHEDULING.defaultTime,
		profiles: Array.isArray(value.profiles) ? value.profiles : []
	};
}

/**
 * Stored defaults over the registry's, field by field: a default added to the
 * registry after the row was written would otherwise be missing entirely, and
 * one removed from it (the per-upload playlist, once a saved default) would
 * otherwise ride along in every plan with no control left to see it by.
 */
function mergeDefaults(id: PlatformId, stored: unknown): OptionValues {
	const known = PLATFORMS[id].defaults;
	const value = (stored && typeof stored === 'object' ? stored : {}) as OptionValues;
	const merged: OptionValues = { ...known };
	for (const key of Object.keys(known)) {
		if (key in value) merged[key] = value[key];
	}
	return merged;
}

/**
 * Loads every brand's platform settings, creating any row that does not exist
 * yet from the registry defaults. Seeding lives here rather than in
 * setup-pb.mjs so the shipped defaults have exactly one source of truth
 * (platforms.ts). Rows with no brand are left alone: `ensureBrands`, which
 * runs first, has already given the first brand the ones it can take.
 */
export async function loadPlatformSettings(brands: Brand[]): Promise<PlatformSettings[]> {
	const rows = await pb.collection('platform_settings').getFullList({ sort: 'sort_order' });

	const byKey = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		// Defensive: a unique index protects this, but a stray row for an
		// unknown platform must not crash the whole app.
		if (row.brand && isPlatformId(row.platform)) byKey.set(`${row.brand}:${row.platform}`, row);
	}

	const result: PlatformSettings[] = [];

	const seed = async (brand: Brand, id: PlatformId, index: number) => {
		try {
			return await pb.collection('platform_settings').create({
				brand: brand.id,
				platform: id,
				enabled: true,
				sort_order: index,
				defaults: PLATFORMS[id].defaults,
				filters: [],
				scheduling: DEFAULT_SCHEDULING
			});
		} catch {
			// Another browser seeded it a moment ago; the index refused this one.
			return await pb
				.collection('platform_settings')
				.getFirstListItem(`brand="${brand.id}" && platform="${id}"`);
		}
	};

	for (const brand of brands) {
		for (const [index, id] of PLATFORM_IDS.entries()) {
			const existing = byKey.get(`${brand.id}:${id}`) ?? (await seed(brand, id, index));
			result.push({
				id: existing.id,
				brand: brand.id,
				platform: id,
				enabled: existing.enabled ?? true,
				sort_order: existing.sort_order ?? index,
				defaults: mergeDefaults(id, existing.defaults),
				filters: Array.isArray(existing.filters) ? existing.filters : [],
				scheduling: mergeScheduling(existing.scheduling)
			});
		}
	}

	return result.sort((a, b) => a.sort_order - b.sort_order);
}

export async function savePlatformSettings(settings: PlatformSettings): Promise<void> {
	assertDeviceNamed();
	if (!settings.id) throw new Error(`platform_settings row for ${settings.platform} has no id`);
	await pb.collection('platform_settings').update(settings.id, {
		enabled: settings.enabled,
		sort_order: settings.sort_order,
		defaults: settings.defaults,
		filters: settings.filters,
		scheduling: settings.scheduling
	});
}

/* ------------------------------------------------------------------ */
/* app settings (key/value)                                             */
/* ------------------------------------------------------------------ */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
	try {
		const row = await pb.collection('app_settings').getFirstListItem(`key="${key}"`);
		return (row.value ?? fallback) as T;
	} catch {
		return fallback;
	}
}

export async function setSetting(key: string, value: unknown): Promise<void> {
	assertDeviceNamed();
	try {
		const row = await pb.collection('app_settings').getFirstListItem(`key="${key}"`);
		await pb.collection('app_settings').update(row.id, { value });
	} catch {
		await pb.collection('app_settings').create({ key, value });
	}
}

/** The row under a key, or null — where `getSetting` only has the value. */
async function findSetting(key: string): Promise<{ id: string; value: unknown } | null> {
	try {
		const row = await pb.collection('app_settings').getFirstListItem(`key="${key}"`);
		return { id: row.id, value: row.value };
	} catch {
		return null;
	}
}

/**
 * Every brand's value of a per-brand area (`templates`, `recent_tags`), by
 * brand id. One request for all of them, so switching brand needs no load.
 */
export async function getBrandSettings<T>(base: string): Promise<Record<string, T>> {
	const prefix = `${base}:`;
	const rows = await pb.collection('app_settings').getFullList({ filter: `key ~ "${prefix}%"` });
	const out: Record<string, T> = {};
	for (const row of rows) {
		// LIKE treats `_` as a wildcard, so the prefix is checked again here.
		const key = String(row.key);
		if (key.startsWith(prefix)) out[key.slice(prefix.length)] = row.value as T;
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* upload jobs                                                          */
/* ------------------------------------------------------------------ */

export interface TargetPlan {
	platform: PlatformId;
	/** The `accounts` id it goes out as; '' for the platform's only one. */
	account: string;
	title: string;
	description: string;
	options: OptionValues;
	/** Local wall-clock date + time, converted to a real instant on write. */
	date: string;
	time: string;
}

/**
 * Pushes the video to the NAS.
 *
 * Deliberately raw XHR rather than the PocketBase SDK: the SDK gives no upload
 * progress, and on a slow uplink a multi-GB transfer with no progress bar is
 * indistinguishable from a hang.
 */
function uploadWithProgress(
	form: FormData,
	onProgress: (fraction: number) => void
): Promise<UploadJob> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${PB_URL}/api/collections/upload_jobs/records`);

		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total);
		});

		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				onProgress(1);
				resolve(JSON.parse(xhr.responseText) as UploadJob);
			} else {
				reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
			}
		});
		xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')));
		xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

		xhr.send(form);
	});
}

/** Combines a local date + time into an instant PocketBase can compare on. */
export function toInstant(date: string, time: string): string {
	return new Date(`${date}T${time || '00:00'}`).toISOString();
}

export interface CreateJobInput {
	title: string;
	description: string;
	/**
	 * Exactly one of these. `file` uploads the bytes through the browser;
	 * `source` references a video already sitting in the watch folder, which is
	 * how a video larger than the file field's 5 GiB cap gets published.
	 */
	file: File | null;
	source: { path: string; name: string; size: number; local?: boolean } | null;
	/** Optional custom thumbnail. Only YouTube does anything with it. */
	thumbnail: File | null;
	/** Optional custom cover for Instagram's reel. */
	cover: File | null;
	/** Optional custom cover for Facebook's reel; the same picture as `cover` while linked. */
	facebookCover?: File | null;
	duration: number;
	/** Where on the NAS this video should end up, snapshotted at confirm time. */
	destination: { label: string; path: string } | null;
	/** The brand the upload is made for; its name is snapshotted with it. */
	brand: Brand | null;
	targets: TargetPlan[];
	/** What was confirmed, kept on the Log row (uploadrecord.ts). */
	record?: UploadRecord;
}

/**
 * Stores the video plus one row per platform. The per-platform rows are
 * written with the *adapted* title/description already resolved, so the
 * publishing worker never re-runs the filter rules — what was confirmed on
 * screen is exactly what gets published.
 */
export async function createJob(
	input: CreateJobInput,
	onProgress: (fraction: number) => void
): Promise<UploadJob> {
	assertDeviceNamed();
	if (!input.file && !input.source) throw new Error('No video chosen.');

	const form = new FormData();
	form.set('title', input.title);
	form.set('description', input.description);
	form.set('video_duration', String(Math.round(input.duration)));
	form.set('destination_label', input.destination?.label ?? '');
	form.set('destination_path', input.destination?.path ?? '');
	form.set('status', 'stored');
	if (input.brand) {
		form.set('brand', input.brand.id);
		form.set('brand_name', input.brand.name);
	}
	if (input.thumbnail) form.set('thumbnail', input.thumbnail);
	if (input.cover) form.set('cover', input.cover);
	if (input.facebookCover) form.set('facebook_cover', input.facebookCover);

	if (input.file) {
		form.set('video', input.file);
		form.set('video_name', input.file.name);
		form.set('video_size', String(input.file.size));
		form.set('source_path', '');
	} else if (input.source) {
		// Nothing to transfer — the video is already on the NAS. The progress
		// callback still has to reach 1, or the confirm screen sits at 0%.
		form.set('source_path', input.source.path);
		// A local-folder pick is not on the NAS yet: the worker copies it into
		// the watch folder and repoints source_path before anything uses it.
		form.set('source_local', input.source.local ? 'true' : 'false');
		form.set('video_name', input.source.name);
		form.set('video_size', String(input.source.size));
	}

	const job = await uploadWithProgress(form, onProgress);

	for (const target of input.targets) {
		await pb.collection('upload_targets').create({
			job: job.id,
			platform: target.platform,
			account: target.account,
			title: target.title,
			description: target.description,
			options: target.options,
			scheduled_at: toInstant(target.date, target.time),
			status: 'pending'
		});
	}

	const sourceName = input.file ? input.file.name : (input.source?.name ?? 'unknown');
	// Each post with how it was sent — immediately, or for which slot — so the
	// Log line answers that on its own, and a search for "immediately" works.
	const immediate = new Set(input.record?.timing.filter((t) => t.immediate).map((t) => t.platform));
	logAction(
		'upload',
		`Uploaded "${input.title || 'untitled'}"`,
		`${sourceName}${input.source ? (input.source.local ? ' (from a local folder)' : ' (from the watch folder)') : ''} → ${input.targets.length} ` +
			`platform(s): ${input.targets
				.map((t) => `${t.platform} ${immediate.has(t.platform) ? 'immediately' : `scheduled for ${formatSchedule(t.date, t.time)}`}`)
				.join('; ')}` +
			(input.brand ? ` · ${input.brand.name}` : ''),
		{ job: job.id, data: input.record }
	);

	return job;
}

/**
 * An upload as it stands now, for its page in the Log: the job (null once
 * deleted) and its targets.
 */
export async function loadUploadState(jobId: string): Promise<{ job: UploadJob | null; targets: UploadTarget[] }> {
	const [job, targets] = await Promise.all([
		pb
			.collection('upload_jobs')
			.getOne<UploadJob>(jobId)
			.catch(() => null),
		pb
			.collection('upload_targets')
			.getFullList<UploadTarget>({ filter: pb.filter('job = {:job}', { job: jobId }) })
			.catch(() => [] as UploadTarget[])
	]);
	return { job, targets };
}

/**
 * The job an "Uploaded" row from before 0.12.0 was written for, which names
 * no job: the one with that file name created in the minutes before it.
 * Null when none is left (deleted) or none matches.
 */
export async function findLoggedJob(fileName: string, loggedAt: string): Promise<UploadJob | null> {
	const at = new Date(loggedAt);
	if (!fileName || Number.isNaN(at.getTime())) return null;
	const rows = await pb
		.collection('upload_jobs')
		.getList<UploadJob>(1, 1, {
			filter: pb.filter('video_name = {:name} && created >= {:from} && created <= {:to}', {
				name: fileName,
				from: new Date(at.getTime() - 15 * 60_000),
				to: new Date(at.getTime() + 60_000)
			}),
			sort: '-created'
		})
		.catch(() => null);
	return rows?.items[0] ?? null;
}

/**
 * Every job's file name and stored time and every post's slot, for the Log
 * to work out how uploads from before 0.12.0 were sent (uploadRowTimings).
 */
export async function loadUploadTimes(): Promise<{
	jobs: { id: string; video_name: string; created: string }[];
	targets: { job: string; platform: PlatformId; scheduled_at: string }[];
}> {
	const [jobs, targets] = await Promise.all([
		pb.collection('upload_jobs').getFullList<{ id: string; video_name: string; created: string }>({
			fields: 'id,video_name,created'
		}),
		pb.collection('upload_targets').getFullList<{ job: string; platform: PlatformId; scheduled_at: string }>({
			fields: 'job,platform,scheduled_at'
		})
	]);
	return { jobs, targets };
}

/** A stored file's address, for the upload's page to play or show. */
export function jobFileUrl(job: UploadJob, name: string): string {
	return pb.files.getURL(job, name);
}

/**
 * The worker's listings of the watch folders: `watch_index` for the network
 * ones, `local_index` for the PC's.
 *
 * A browser cannot read a filesystem, so this is the only way the compose
 * screen knows what is sitting there. It is written by the worker on each poll
 * pass, which means it is stale by up to that interval — `scannedAt` is shown
 * so an empty list reads as "nothing scanned recently" rather than "no files".
 * A `watch_index` from a worker older than the merged list names one
 * `folder`, read here as a list of one.
 */
function readIndex(raw: unknown): WatchIndex | null {
	if (!raw || typeof raw !== 'object') return null;
	const index = raw as Partial<WatchIndex> & { folder?: unknown; error?: unknown };
	if (!Array.isArray(index.files)) return null;
	const folders = Array.isArray(index.folders)
		? index.folders.filter((f) => f && typeof f.folder === 'string')
		: typeof index.folder === 'string'
			? [{ folder: index.folder, ...(typeof index.error === 'string' ? { error: index.error } : {}) }]
			: [];
	return {
		scannedAt: typeof index.scannedAt === 'string' ? index.scannedAt : '',
		folders,
		files: index.files.filter((f) => f && typeof f.path === 'string' && typeof f.name === 'string'),
		projectRoots: Array.isArray(index.projectRoots) ? index.projectRoots.filter((r) => r && typeof r.folder === 'string') : []
	};
}

export async function loadWatchIndex(): Promise<WatchIndex | null> {
	return readIndex(await getSetting<unknown>('watch_index', null));
}

export async function loadLocalIndex(): Promise<LocalIndex | null> {
	return readIndex(await getSetting<unknown>('local_index', null));
}

/** Where the worker last said it streams listed videos from, if it ever has. */
export async function loadPreviewServer(): Promise<PreviewServer | null> {
	const none: PreviewServer | null = null;
	const server = await getSetting<PreviewServer | null>('preview_server', none);
	return server && typeof server.url === 'string' && server.url ? server : null;
}

/**
 * What the file lists should stop offering: every source that has gone out.
 *
 * Two sources, unioned. `used_sources` is written at each confirmation and
 * survives a job being deleted to free the NAS; the jobs themselves cover
 * everything uploaded before that list existed, and the NAS copy of a local
 * pick, whose path is only known once the worker has imported it.
 *
 * A file matches by path, or — for one that went through the browser and so
 * has no path — by name and size together.
 */
export interface UsedIndex {
	paths: Set<string>;
	keys: Set<string>;
}

export function usedKey(name: string, size: number): string {
	return `${name.toLowerCase()}|${size}`;
}

export function isUsed(used: UsedIndex, file: { path: string; name: string; size: number }): boolean {
	return used.paths.has(file.path) || used.keys.has(usedKey(file.name, file.size));
}

export async function loadUsedSources(): Promise<UsedIndex> {
	const used: UsedIndex = { paths: new Set(), keys: new Set() };
	const remembered = await getSetting<UsedSource[]>('used_sources', []);
	for (const entry of Array.isArray(remembered) ? remembered : []) {
		if (entry?.path) used.paths.add(entry.path);
		if (entry?.name && entry.size) used.keys.add(usedKey(entry.name, entry.size));
	}
	try {
		const jobs = await pb.collection('upload_jobs').getFullList({
			fields: 'source_path,source_origin,video_name,video_size'
		});
		for (const job of jobs) {
			if (job.source_path) used.paths.add(job.source_path);
			if (job.source_origin) used.paths.add(job.source_origin);
			if (job.video_name && job.video_size) used.keys.add(usedKey(job.video_name, job.video_size));
		}
	} catch {
		// The remembered list alone still hides most of what went out.
	}
	return used;
}

/** Most recent first; old entries fall off so the row stays a sensible size. */
const USED_CAP = 2000;

/**
 * Records sources as gone out. Fire-and-forget like `rememberTags`: the
 * upload has already succeeded, and a failed write only means the file is
 * offered again.
 */
export function rememberUsedSources(entries: Omit<UsedSource, 'at'>[]): void {
	if (entries.length === 0) return;
	void (async () => {
		try {
			const current = await getSetting<UsedSource[]>('used_sources', []);
			const at = new Date().toISOString();
			const next = [
				...entries.map((entry) => ({ ...entry, at })),
				...(Array.isArray(current) ? current : [])
			].slice(0, USED_CAP);
			await setSetting('used_sources', next);
		} catch {
			// Nothing to do — the upload has already succeeded.
		}
	})();
}

/**
 * Asks the worker to open the Windows folder dialog on its machine and waits
 * for the answer. A browser cannot produce a real path itself, and the local
 * folders are the worker's to read anyway. Resolves to the chosen path, or
 * null if the dialog was cancelled; throws if the worker failed, or never
 * answered within `giveUpMs` — `onWaiting` fires once the ask has sat
 * unanswered long enough to suggest the worker is not running.
 */
export async function requestFolderPick(
	opts: { signal?: AbortSignal; onWaiting?: () => void; onOpen?: () => void; giveUpMs?: number } = {}
): Promise<string | null> {
	const id = newId();
	await setSetting('folder_pick', { id, status: 'pending', requestedAt: new Date().toISOString() });

	const started = Date.now();
	let warned = false;
	let opened = false;
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 700));
		if (opts.signal?.aborted) {
			await setSetting('folder_pick', { id, status: 'cancelled' }).catch(() => {});
			return null;
		}
		const answer = await getSetting<{
			id?: string;
			status?: string;
			path?: string;
			error?: string;
		} | null>('folder_pick', null);
		if (answer?.id !== id) throw new Error('Another folder request replaced this one.');
		if (answer.status === 'open' && !opened) {
			opened = true;
			opts.onOpen?.();
		}
		if (answer.status === 'done') return answer.path || null;
		if (answer.status === 'cancelled') return null;
		if (answer.status === 'failed') throw new Error(answer.error || 'The folder dialog failed.');
		if (answer.status === 'expired') throw new Error('The worker picked the request up too late.');
		// Pending means nobody has taken it; open means the dialog is up, and
		// may stay up as long as it takes.
		if (answer.status === 'pending') {
			const waited = Date.now() - started;
			if (!warned && waited > 8000) {
				warned = true;
				opts.onWaiting?.();
			}
			if (waited > (opts.giveUpMs ?? 90_000)) {
				await setSetting('folder_pick', { id, status: 'cancelled' }).catch(() => {});
				throw new Error('The worker did not answer — it has to be running on the PC with the folders.');
			}
		}
	}
}

/**
 * Asks the worker holding the TikTok tokens to read the accounts' creator
 * info now (worker/index.mjs, `creatorCheckPass`) and waits for it: TikTok's
 * guidelines want the latest each time the Post to TikTok box is shown.
 * 'done' once the rows are fresh — a newer ask answered counts, since it
 * read the same accounts — 'failed' when the worker could not, 'timeout'
 * when nobody answered (the NAS worker down, say).
 */
export async function requestTikTokCheck(giveUpMs = 20_000): Promise<'done' | 'failed' | 'timeout'> {
	assertDeviceNamed();
	const id = newId();
	await setSetting('tiktok_check', { id, status: 'pending', requestedAt: new Date().toISOString() });
	const started = Date.now();
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 800));
		const answer = await getSetting<{ id?: string; status?: string } | null>('tiktok_check', null);
		if (answer?.status === 'done') return 'done';
		if (answer?.id === id && (answer.status === 'failed' || answer.status === 'expired')) return 'failed';
		if (Date.now() - started > giveUpMs) return 'timeout';
	}
}

/** By extension, for a download PocketBase did not type. */
const IMAGE_TYPE_BY_EXT: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp'
};

/**
 * Asks the worker for an image on its machine — the thumbnail a pasted flock
 * block names by path — and waits for it. A browser cannot open a path, so
 * the worker reads the file and attaches it to a `file_requests` row
 * (worker/localfile.mjs: images only, up to 8 MB); the row is deleted here
 * once the image is in hand, or given up on. Throws with the worker's reason,
 * or when nobody answers within `giveUpMs`; `onWaiting` fires once the ask
 * has sat long enough to suggest the worker is not running.
 */
export async function requestLocalImage(
	path: string,
	opts: { onWaiting?: () => void; giveUpMs?: number } = {}
): Promise<File> {
	assertDeviceNamed();

	let id: string;
	try {
		id = (await pb.collection('file_requests').create({ path: path.slice(0, 1000), status: 'pending' })).id;
	} catch (err) {
		if ((err as { status?: number }).status === 404) {
			throw new Error('This PocketBase has no file_requests collection yet — run pnpm setup-pb.');
		}
		throw err;
	}

	const started = Date.now();
	let warned = false;
	try {
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 700));
			const row = await pb.collection('file_requests').getOne(id);
			if (row.status === 'done' && row.file) {
				const res = await fetch(pb.files.getURL(row, row.file));
				if (!res.ok) throw new Error(`The image could not be downloaded (${res.status}).`);
				const blob = await res.blob();
				const name = String(row.name || row.file);
				const ext = name.split('.').pop()?.toLowerCase() ?? '';
				return new File([blob], name, { type: blob.type || IMAGE_TYPE_BY_EXT[ext] || '' });
			}
			if (row.status === 'failed') throw new Error(String(row.error || 'The worker could not read the image.'));

			const waited = Date.now() - started;
			if (!warned && waited > 8000) {
				warned = true;
				opts.onWaiting?.();
			}
			if (waited > (opts.giveUpMs ?? 60_000)) {
				throw new Error('The worker did not answer — it has to be running on the PC that holds the image.');
			}
		}
	} finally {
		void pb.collection('file_requests').delete(id).catch(() => {});
	}
}

/**
 * A channel's playlists, as the worker last listed them — one row per
 * channel. The plain `youtube_playlists` row a worker from before channels
 * wrote is not read: it does not say whose channel it lists, and showing one
 * brand another channel's playlists is worse than a minute without any.
 */
export async function loadPlaylists(channelId: string): Promise<PlaylistIndex | null> {
	if (!channelId) return null;
	const empty: PlaylistIndex | null = null;
	const index = await getSetting<PlaylistIndex | null>(`youtube_playlists:${channelId}`, empty);
	if (!index || !Array.isArray(index.items)) return null;
	return index;
}

/**
 * The channels' videos since the "To finish" list began — the stats pass's
 * rows, so uploads made outside flock are there too. Public and private
 * (a scheduled one is private until its slot); only the fields a line shows
 * come back, not the stored item or its history.
 */
export async function loadTodoStats(since: string): Promise<StatsRow[]> {
	return pb.collection('video_stats').getFullList<StatsRow>({
		filter: pb.filter("published_at >= {:since} && (privacy = 'public' || privacy = 'private')", {
			since: new Date(since)
		}),
		fields: STATS_FIELDS,
		sort: 'published_at'
	});
}

/**
 * Calls back whenever a YouTube `upload_targets` row is created or changes —
 * a confirm, the worker claiming it, the link arriving — so To finish follows
 * it live rather than on its next poll.
 */
export function subscribeYouTubeTargets(onChange: () => void): () => void {
	const sub = pb.collection('upload_targets').subscribe('*', (e) => {
		if (e.record?.platform === 'youtube') onChange();
	});
	sub.catch(() => {});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}

/** Every change to any post, on every platform: what needs attention follows them live. */
export function subscribeTargets(onChange: () => void): () => void {
	const sub = pb.collection('upload_targets').subscribe('*', () => onChange());
	sub.catch(() => {});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}

/**
 * flock's YouTube uploads since the list began: those YouTube has, each with
 * its thumbnail and paid promotion to set in Studio, and those still on their
 * way (no link yet).
 */
export async function loadTodoUploads(since: string): Promise<UploadRow[]> {
	return pb.collection('upload_targets').getFullList<UploadRow>({
		filter: pb.filter(
			"platform = 'youtube' && created >= {:since} && (remote_url != '' || status = 'pending' || status = 'publishing')",
			{ since: new Date(since) }
		),
		fields: UPLOAD_FIELDS,
		sort: 'created'
	});
}

/**
 * The tag list last published for each platform, per brand.
 *
 * Kept apart from `platform_settings.defaults` on purpose: writing it there
 * would mean every upload silently edited the user's saved defaults and logged a
 * settings change. This is a memory of what was used, not a preference.
 */
export type RecentTags = Partial<Record<PlatformId, Record<string, string[]>>>;

export async function loadRecentTags(brandId: string): Promise<RecentTags> {
	const stored = await getSetting<RecentTags>(brandSettingKey('recent_tags', brandId), {});
	const clean: RecentTags = {};

	for (const [platform, byField] of Object.entries(stored ?? {})) {
		if (!isPlatformId(platform)) continue;
		// A row written before tags were split into boxes holds a bare array.
		// Nothing useful maps onto the new shape, so it is dropped rather than
		// guessed at.
		if (!byField || typeof byField !== 'object' || Array.isArray(byField)) continue;

		const fields: Record<string, string[]> = {};
		for (const [key, tags] of Object.entries(byField)) {
			if (Array.isArray(tags)) {
				fields[key] = tags.filter((tag): tag is string => typeof tag === 'string');
			}
		}
		clean[platform] = fields;
	}
	return clean;
}

/**
 * Records the tag lists an upload actually went out with. Fire-and-forget, like
 * the log: failing to remember tags must never fail a finished upload.
 */
export function rememberTags(brandId: string, used: RecentTags): void {
	void (async () => {
		try {
			const current = await loadRecentTags(brandId);
			const next: RecentTags = { ...current };
			for (const [platform, byField] of Object.entries(used)) {
				if (isPlatformId(platform) && byField && Object.keys(byField).length > 0) {
					next[platform] = byField;
				}
			}
			await setSetting(brandSettingKey('recent_tags', brandId), next);
		} catch {
			// Nothing to do — the upload has already succeeded.
		}
	})();
}

/* ------------------------------------------------------------------ */
/* title scoring                                                        */
/* ------------------------------------------------------------------ */

export interface ScoreResult {
	status: 'pending' | 'done' | 'failed';
	score: number | null;
	error: string;
}

/**
 * Asks the worker to score a title, and waits for the answer.
 *
 * The browser cannot call vidIQ itself: they have no REST API, only an MCP
 * server, and its key is a credential that must not ship inside a static build.
 * So the ask is written to PocketBase and the worker — which holds the key —
 * answers it. The worker checks this queue every few seconds rather than on its
 * ordinary poll, because somebody is watching the button.
 *
 * Resolves `pending` if the worker never answers, which is what it looks like
 * when the worker is not running at all.
 */
export async function scoreTitle(
	text: string,
	options: { platform?: string; channel?: string; format?: 'long' | 'short' } = {},
	timeoutMs = 25000
): Promise<ScoreResult> {
	assertDeviceNamed();

	const created = await pb.collection('score_requests').create({
		kind: 'title',
		text: text.slice(0, 500),
		platform: options.platform ?? '',
		channel: options.channel ?? '',
		format: options.format ?? 'long',
		status: 'pending'
	});

	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		await new Promise((resolve) => setTimeout(resolve, 900));
		const row = await pb.collection('score_requests').getOne(created.id);
		if (row.status === 'done') {
			return { status: 'done', score: typeof row.score === 'number' ? row.score : null, error: '' };
		}
		if (row.status === 'failed') {
			return { status: 'failed', score: null, error: String(row.error ?? 'Scoring failed.') };
		}
	}

	return {
		status: 'pending',
		score: null,
		error: 'The worker did not answer. Is it running?'
	};
}

export interface TitleSuggestion {
	title: string;
	score: number | null;
}

/**
 * Titles this platform has already had for this brand, newest first.
 *
 * Passed to vidIQ so suggestions do not come back as variations of last week's.
 * The browser extension, sitting on one video page, has no way to know these —
 * it is the one thing flock can bring that vidIQ cannot see for itself. Per
 * brand, because another brand's titles are another channel's history.
 */
export async function recentTitles(platform: PlatformId, brandId: string, limit = 12): Promise<string[]> {
	try {
		const res = await pb.collection('upload_targets').getList(1, limit, {
			filter: `platform="${platform}" && title != "" && job.brand="${brandId}"`,
			sort: '-created'
		});
		const seen = new Set<string>();
		const titles: string[] = [];
		for (const row of res.items as unknown as UploadTarget[]) {
			const title = (row.title ?? '').trim();
			if (!title || seen.has(title.toLowerCase())) continue;
			seen.add(title.toLowerCase());
			titles.push(title);
		}
		return titles;
	} catch {
		// Suggestions are better with history and fine without it.
		return [];
	}
}

/**
 * Asks vidIQ for scored titles built on what has been typed so far.
 *
 * Same worker round trip as `scoreTitle`, and the same reason for it. One call
 * returns several suggestions where scoring a single title costs the same, so
 * this is the cheaper way to compare options.
 */
export async function suggestTitles(
	text: string,
	options: { platform?: string; description?: string; previous?: string[]; format?: 'long' | 'short' } = {},
	timeoutMs = 60000
): Promise<{ status: 'done' | 'failed'; titles: TitleSuggestion[]; error: string }> {
	assertDeviceNamed();

	const created = await pb.collection('score_requests').create({
		kind: 'titles',
		text: text.slice(0, 500),
		platform: options.platform ?? '',
		context: (options.description ?? '').slice(0, 5000),
		format: options.format ?? 'long',
		// Carried in `result` on the way out and replaced by the answer on the way
		// back, so the request needs no extra column of its own.
		result: options.previous ?? [],
		status: 'pending'
	});

	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		await new Promise((resolve) => setTimeout(resolve, 1200));
		const row = await pb.collection('score_requests').getOne(created.id);
		if (row.status === 'done') {
			const titles = Array.isArray(row.result) ? (row.result as TitleSuggestion[]) : [];
			return { status: 'done', titles, error: '' };
		}
		if (row.status === 'failed') {
			return { status: 'failed', titles: [], error: String(row.error ?? 'Suggestion failed.') };
		}
	}

	return { status: 'failed', titles: [], error: 'The worker did not answer. Is it running?' };
}

export async function listJobs(limit = 25): Promise<UploadJob[]> {
	const res = await pb.collection('upload_jobs').getList(1, limit, { sort: '-created' });
	return res.items as unknown as UploadJob[];
}

/**
 * Targets with the brand of the job each belongs to, as `brand` and
 * `brand_name` — the only parts of the job the screens listing targets need.
 */
export async function listTargets(jobId?: string): Promise<UploadTarget[]> {
	const rows = await pb.collection('upload_targets').getFullList({
		sort: 'scheduled_at',
		expand: 'job',
		fields: '*,expand.job.brand,expand.job.brand_name',
		...(jobId ? { filter: `job="${jobId}"` } : {})
	});
	return rows.map((row) => {
		const job = (row.expand?.job ?? {}) as { brand?: string; brand_name?: string };
		const { expand: _expand, ...rest } = row;
		return { ...rest, brand: job.brand ?? '', brand_name: job.brand_name ?? '' };
	}) as unknown as UploadTarget[];
}

/* ------------------------------------------------------------------ */
/* youtube stats                                                        */
/* ------------------------------------------------------------------ */

export async function listVideoStats(): Promise<VideoStats[]> {
	const rows = await pb.collection('video_stats').getFullList({ sort: '-published_at' });
	return rows as unknown as VideoStats[];
}

/** A video for the dashboard: the counters, the samples, its channel and a thumbnail — not the whole item. */
export interface DashVideo extends StatsVideo {
	id: string;
	channelId: string;
	thumb: string;
}

/** Every watched video, slim (the caller filters by channel itself). */
export async function loadDashVideos(): Promise<DashVideo[]> {
	const rows = await pb.collection('video_stats').getFullList<
		Omit<DashVideo, 'channelId' | 'thumb'> & {
			data?: { snippet?: { channelId?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } } };
		}
	>({
		sort: '-published_at',
		fields:
			'id,video_id,title,published_at,privacy,views,duration,history,data.snippet.channelId,data.snippet.thumbnails.medium.url,data.snippet.thumbnails.default.url'
	});
	return rows.map(({ data, ...row }) => ({
		...row,
		history: Array.isArray(row.history) ? row.history : [],
		channelId: data?.snippet?.channelId ?? '',
		thumb: data?.snippet?.thumbnails?.medium?.url ?? data?.snippet?.thumbnails?.default?.url ?? ''
	}));
}

/** Every post, with the brand and what the dashboard reads of its job (dashboard.ts). */
export async function loadDashTargets(since?: Date): Promise<(DashTarget & { brand: string })[]> {
	type Row = {
		id: string;
		job: string;
		platform: PlatformId;
		status: string;
		scheduled_at: string;
		published_at?: string;
		error?: string;
		remote_url?: string;
		title: string;
		account?: string;
		updated?: string;
		options?: { visibility?: string; privacy?: string; jestrCampaign?: boolean };
		expand?: { job?: { brand?: string; title?: string; created?: string; source_local?: boolean; error?: string } };
	};
	const rows = await pb.collection('upload_targets').getFullList<Row>({
		expand: 'job',
		// With `since`, only what could still need attention: anything not
		// out yet, and the rest with a slot from then on.
		...(since
			? { filter: pb.filter("status = 'pending' || status = 'publishing' || scheduled_at >= {:since}", { since }) }
			: {}),
		fields:
			'id,job,platform,status,scheduled_at,published_at,error,remote_url,title,account,updated,' +
			'options.visibility,options.privacy,options.jestrCampaign,' +
			'expand.job.brand,expand.job.title,expand.job.created,expand.job.source_local,expand.job.error'
	});
	return rows.map((row) => {
		const job = row.expand?.job;
		return {
			id: row.id,
			job: row.job,
			platform: row.platform,
			status: row.status,
			scheduled_at: row.scheduled_at,
			published_at: row.published_at ?? '',
			error: row.error ?? '',
			remote_url: row.remote_url ?? '',
			title: row.title,
			visibility: String(row.options?.visibility ?? row.options?.privacy ?? ''),
			jestr: row.options?.jestrCampaign === true,
			jobTitle: job?.title ?? '',
			jobCreated: job?.created ?? '',
			importing: Boolean(job?.source_local),
			jobError: job?.error ?? '',
			brand: job?.brand ?? '',
			account: row.account ?? '',
			updated: row.updated ?? ''
		};
	});
}

/* ------------------------------------------------------------------ */
/* the dashboard: every video and reel, slim (releases.ts)              */
/* ------------------------------------------------------------------ */

/** A YouTube video for the dashboard, with the channel it is on. */
export type DashboardVideo = YouTubeRow & { channelId: string };
/** A reel for the dashboard: Instagram's or Facebook's, with the account (Page) it is on. */
export type DashboardReel = ReelRow & { platform: ReelPlatform; account: string; data?: Record<string, unknown> };

type VideoRecord = Partial<Omit<VideoStats, 'data'>> & {
	data?: {
		snippet?: { channelId?: string; thumbnails?: Record<string, { url?: string }> };
		liveStreamingDetails?: Record<string, string>;
	};
};

/** A `video_stats` record (slim or whole, as realtime sends it) as the dashboard reads it. */
export function toDashboardVideo(row: VideoRecord): DashboardVideo {
	const thumbs = row.data?.snippet?.thumbnails ?? {};
	const live = row.data?.liveStreamingDetails;
	return {
		id: row.id ?? '',
		video_id: row.video_id ?? '',
		title: row.title ?? '',
		published_at: row.published_at ?? '',
		privacy: row.privacy ?? '',
		views: row.views ?? null,
		likes: row.likes ?? null,
		comments: row.comments ?? null,
		duration: Number(row.duration ?? 0),
		history: (Array.isArray(row.history) ? row.history : []) as Sample[],
		live: Boolean(live && Object.keys(live).length > 0),
		thumb: thumbs.medium?.url ?? thumbs.default?.url ?? '',
		channelId: row.data?.snippet?.channelId ?? ''
	};
}

/** A `post_stats` record as the dashboard reads it. */
export function toDashboardReel(row: Record<string, unknown>): DashboardReel {
	const n = (v: unknown) => (typeof v === 'number' ? v : null);
	const facebook = row.platform === 'facebook';
	const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : undefined;
	// PocketBase reads an empty number back as 0, so a Facebook reel whose
	// views were never read (no read_insights) would say 0: its insights say.
	const insights = (data?.insights ?? {}) as Record<string, unknown>;
	const unread = facebook && typeof insights.fb_reels_total_plays !== 'number';
	return {
		id: String(row.id ?? ''),
		platform: facebook ? 'facebook' : 'instagram',
		post_id: String(row.post_id ?? ''),
		account: String(row.account ?? ''),
		published_at: String(row.published_at ?? ''),
		views: unread ? null : n(row.views),
		likes: n(row.likes),
		comments: n(row.comments),
		// Facebook reports no reach for a reel; the column is only Instagram's.
		reach: facebook ? null : n(row.reach),
		permalink: String(row.permalink ?? ''),
		caption: String(row.caption ?? ''),
		history: (Array.isArray(row.history) ? row.history : []) as Sample[],
		data
	};
}

/** Every watched video, slim — the counters, samples and what the list shows, not the whole item. */
export async function loadDashboardVideos(): Promise<DashboardVideo[]> {
	const rows = await pb.collection('video_stats').getFullList<VideoRecord>({
		sort: '-published_at',
		fields:
			'id,video_id,title,published_at,privacy,views,likes,comments,duration,history,' +
			'data.snippet.channelId,data.snippet.thumbnails.medium.url,data.snippet.thumbnails.default.url,' +
			'data.liveStreamingDetails'
	});
	return rows.map(toDashboardVideo);
}

/** One video's whole item, for an opened row. */
export async function loadVideoStat(id: string): Promise<VideoStats> {
	return (await pb.collection('video_stats').getOne(id)) as unknown as VideoStats;
}

// Instagram's reels among its posts, and every Facebook post read (all reels).
const REELS = "(platform = 'instagram' && product_type = 'REELS') || platform = 'facebook'";

function isReel(record: Record<string, unknown>): boolean {
	return (record.platform === 'instagram' && record.product_type === 'REELS') || record.platform === 'facebook';
}

/* ---- renames from the Dashboard (retitle.ts) ---- */

/** One platform's rename, as the dialog asks it. */
export interface RenameAsk {
	platform: PlatformId;
	videoId: string;
	account: string;
	title: string;
	/** What the Dashboard showed as its name there. */
	before: string;
	/** The flock upload it came from; '' when it went out some other way. */
	job: string;
}

/**
 * Asks the worker to rename a video on each platform given, one row per
 * platform (worker/retitle.mjs). Logged per platform, against the upload
 * when there is one.
 */
export async function requestRenames(asks: RenameAsk[]): Promise<TitleRequest[]> {
	assertDeviceNamed();
	const device = deviceName();
	const made: TitleRequest[] = [];
	for (const ask of asks) {
		const title = cleanName(ask.title);
		let row: Record<string, unknown>;
		try {
			row = await pb.collection('title_requests').create({
				platform: ask.platform,
				video_id: ask.videoId,
				account: ask.account,
				title: title.slice(0, 255),
				before: ask.before.slice(0, 2200),
				status: 'pending',
				device,
				job: ask.job
			});
		} catch (err) {
			if ((err as { status?: number }).status === 404) {
				throw new Error('This PocketBase has no title_requests collection yet — run pnpm setup-pb.');
			}
			throw err;
		}
		made.push(readTitleRequest(row));
		logAction(
			'upload',
			`Asked to rename on ${PLATFORMS[ask.platform]?.label ?? ask.platform}`,
			`"${ask.before || '(no name)'}" → "${title}"`,
			{ job: ask.job }
		);
	}
	return made;
}

/** Renames asked for since `since`, oldest first; none on a PocketBase without the collection. */
export async function listTitleRequests(since: Date): Promise<TitleRequest[]> {
	try {
		const rows = await pb.collection('title_requests').getFullList<Record<string, unknown>>({
			filter: pb.filter('created >= {:since}', { since }),
			sort: 'created'
		});
		return rows.map(readTitleRequest);
	} catch {
		return [];
	}
}

/** Each rename as it is asked and as the worker answers it. Returns the unsubscribe. */
export function subscribeTitleRequests(onRow: (row: TitleRequest, action: string) => void): () => void {
	const sub = pb.collection('title_requests').subscribe('*', (e) => onRow(readTitleRequest(e.record), e.action));
	sub.catch(() => {});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}

/** The reels as the worker stores them (worker/igstats.mjs, fbstats.mjs); none when it never has. */
export async function loadDashboardReels(): Promise<DashboardReel[]> {
	try {
		const rows = await pb.collection('post_stats').getFullList<Record<string, unknown>>({
			filter: REELS,
			fields: 'id,platform,post_id,account,published_at,views,likes,comments,reach,permalink,caption,history,data.length,data.insights'
		});
		return rows.map(toDashboardReel);
	} catch {
		return [];
	}
}

/** Each reel as the worker writes it (or deletes it). Returns the unsubscribe. */
export function subscribeReels(onReel: (reel: DashboardReel, action: string) => void): () => void {
	const sub = pb.collection('post_stats').subscribe('*', (e) => {
		if (isReel(e.record)) onReel(toDashboardReel(e.record), e.action);
	});
	sub.catch(() => {});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}

export async function getStatsStatus(): Promise<StatsStatus | null> {
	const res = await pb
		.collection('app_settings')
		.getList(1, 1, { filter: 'key="stats_status"' });
	const row = res.items[0];
	return row ? (row.value as StatsStatus) : null;
}

/**
 * Pushes the worker's writes into the page as they land: a row whenever a
 * video changes, the heartbeat every poll. Realtime is what makes a 30-second
 * poll on the worker feel live in the browser without the browser polling
 * anything. Returns the unsubscribe.
 */
export function subscribeStats(handlers: {
	onVideo: (row: VideoStats, action: string) => void;
	onStatus: (status: StatsStatus) => void;
}): () => void {
	const videos = pb
		.collection('video_stats')
		.subscribe('*', (e) => handlers.onVideo(e.record as unknown as VideoStats, e.action));
	const settings = pb.collection('app_settings').subscribe('*', (e) => {
		if (e.record.key === 'stats_status') handlers.onStatus(e.record.value as StatsStatus);
	});
	// A failed subscription (PocketBase down, collection missing) is not an
	// error the page can act on; the list load reports that already.
	videos.catch(() => {});
	settings.catch(() => {});
	return () => {
		for (const sub of [videos, settings]) void sub.then((unsubscribe) => unsubscribe());
	};
}

const WORKER_KEYS: Record<string, WorkerRole> = { worker_all: 'all', worker_nas: 'nas', worker_local: 'local' };

/** The workers' heartbeats, by role — see workerstatus.ts. */
export async function loadWorkerBeats(): Promise<WorkerBeats> {
	const res = await pb.collection('app_settings').getList(1, 3, {
		filter: Object.keys(WORKER_KEYS)
			.map((key) => `key="${key}"`)
			.join(' || ')
	});
	const beats: WorkerBeats = {};
	for (const row of res.items) beats[WORKER_KEYS[row.key]] = row.value as WorkerBeat;
	return beats;
}

/** Each heartbeat as it is written. Returns the unsubscribe. */
export function subscribeWorkerBeats(onBeat: (role: WorkerRole, beat: WorkerBeat | null) => void): () => void {
	const sub = pb.collection('app_settings').subscribe('*', (e) => {
		const role = WORKER_KEYS[e.record.key];
		if (role) onBeat(role, e.action === 'delete' ? null : (e.record.value as WorkerBeat));
	});
	sub.catch(() => {});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* projects                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every project the workers have found, as they last wrote them plus what
 * this page saved on them. A PocketBase without the collection yet (setup-pb
 * not run since it arrived) reads as none.
 */
export async function loadProjects(): Promise<ProjectRow[]> {
	try {
		return await pb.collection('projects').getFullList<ProjectRow>({ sort: 'created' });
	} catch {
		return [];
	}
}

export async function getProject(id: string): Promise<ProjectRow> {
	return pb.collection('projects').getOne<ProjectRow>(id);
}

export function subscribeProjects(onChange: (action: string, row: ProjectRow) => void): () => void {
	const sub = pb.collection('projects').subscribe<ProjectRow>('*', (e) => onChange(e.action, e.record));
	sub.catch(() => {});
	return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
}

/** The page's own fields on a project row: never the worker's. */
export async function markProject(
	id: string,
	patch: { status?: ProjectRow['status']; done_at?: string; jobs?: string[]; draft?: unknown }
): Promise<void> {
	assertDeviceNamed();
	await pb.collection('projects').update(id, patch);
}

/**
 * Keeps an upload in progress on its project row. `images` carries only the
 * images that changed since the last save: a File replaces the stored one,
 * null removes it.
 */
export async function saveProjectDraft(
	id: string,
	draft: unknown,
	images: { thumbnail?: File | null; cover?: File | null }
): Promise<void> {
	assertDeviceNamed();
	const removed = Object.entries(images).filter(([, file]) => file === null);
	const added = Object.entries(images).filter((entry): entry is [string, File] => entry[1] instanceof File);
	await pb.collection('projects').update(id, { draft, ...Object.fromEntries(removed) });
	if (added.length === 0) return;
	const form = new FormData();
	for (const [field, file] of added) form.set(field, file);
	await pb.collection('projects').update(id, form);
}

/** A stored project image, under the name it was picked with. */
export async function loadProjectImage(row: ProjectRow, field: 'thumbnail' | 'cover', name: string): Promise<File | null> {
	const stored = row[field];
	if (!stored) return null;
	const res = await fetch(pb.files.getURL(row, stored));
	if (!res.ok) return null;
	const blob = await res.blob();
	const own = name || stored;
	const ext = own.split('.').pop()?.toLowerCase() ?? '';
	return new File([blob], own, { type: blob.type || IMAGE_TYPE_BY_EXT[ext] || '' });
}

export async function deleteJob(id: string): Promise<void> {
	assertDeviceNamed();
	// upload_targets cascade-delete with the job.
	await pb.collection('upload_jobs').delete(id);
	logAction('upload', 'Deleted a stored upload', id, { job: id });
}

/**
 * Moves one already-committed release to a new instant. Used by the Calendar's
 * edit mode; the wizard never calls this, since nothing is written there until
 * the upload is confirmed.
 */
export async function rescheduleTarget(id: string, scheduledAt: string): Promise<void> {
	await rescheduleTargets([{ id, scheduledAt }]);
}

/**
 * Several posts at once — a whole upload dragged by its grip. Every one is
 * read afresh and checked before any is written, so a refusal leaves them
 * all where they were.
 */
export async function rescheduleTargets(moves: { id: string; scheduledAt: string }[]): Promise<void> {
	assertDeviceNamed();
	// Read afresh and checked again (reschedule.ts): the page may be minutes
	// old, and a post the worker took up since must not change under it.
	const rows = await Promise.all(moves.map((move) => pb.collection('upload_targets').getOne<UploadTarget>(move.id)));
	moves.forEach((move, i) => {
		const refused = lockReason(rows[i]) || landReason(rows[i], new Date(move.scheduledAt));
		if (refused) throw new MoveRefused(moves.length > 1 ? `${PLATFORMS[rows[i].platform]?.label ?? rows[i].platform}: ${refused}` : refused);
	});
	for (const [i, move] of moves.entries()) {
		const before = rows[i];
		await pb.collection('upload_targets').update(move.id, { scheduled_at: move.scheduledAt });
		const told = before.status === 'scheduled' ? ` (the worker tells ${PLATFORMS[before.platform]?.label ?? before.platform})` : '';
		logAction(
			'calendar',
			`Rescheduled ${before.platform}`,
			`${new Date(before.scheduled_at).toLocaleString()} → ${new Date(move.scheduledAt).toLocaleString()}${told}`,
			{ job: before.job }
		);
	}
}

/**
 * Releases posts at once, or deletes them (postactions.ts) — one post or a
 * whole upload's box, from the Calendar. Every one is read afresh and checked
 * before any is touched, so a refusal leaves them all as they were. A post a
 * platform holds is the worker's to do, asked through `request`; the rest
 * change here. Logged per post with its text, since a deleted one is gone.
 */
export async function actOnPosts(action: PostAction, ids: string[]): Promise<void> {
	assertDeviceNamed();
	const rows = await Promise.all(ids.map((id) => pb.collection('upload_targets').getOne<UploadTarget>(id)));
	const refused = groupRefusal(action, rows);
	if (refused) throw new MoveRefused(refused);
	const now = new Date().toISOString();
	for (const row of rows) {
		const plan = actionPlan(action, row);
		const byWorker = 'by' in plan && plan.by === 'worker';
		const name = PLATFORMS[row.platform]?.label ?? row.platform;
		if (byWorker) {
			await pb.collection('upload_targets').update(row.id, { request: { kind: action, requestedAt: now, by: deviceName() } });
		} else if (action === 'delete') {
			await pb.collection('upload_targets').delete(row.id);
		} else if (row.status === 'failed') {
			await pb.collection('upload_targets').update(row.id, { status: 'pending', scheduled_at: now, error: '', handle: null });
		} else {
			await pb.collection('upload_targets').update(row.id, { scheduled_at: now });
		}
		const text = (row.title || row.description || '(no text)').replace(/\s+/g, ' ').slice(0, 120);
		const worker = byWorker ? ` (the worker ${action === 'release' ? 'puts it out' : 'deletes it'} on ${name})` : '';
		logAction(
			'calendar',
			action === 'release' ? `Released ${row.platform} now` : `Deleted ${row.platform}`,
			`${text} — was due ${new Date(row.scheduled_at).toLocaleString()}${worker}`,
			{ job: row.job }
		);
	}
}

/**
 * Sends a failed post again: back to `pending`, its error and the old
 * attempt's handle cleared, so the worker takes it up like a new one — at
 * its slot while that is still ahead, at once after (retryWhen). Read afresh
 * first and refused unless it still failed and the platform has no link for
 * it (canRetry): a post the platform has is never sent twice. Logged against
 * the upload, with what it failed with.
 */
export async function retryTarget(id: string): Promise<void> {
	assertDeviceNamed();
	const before = await pb.collection('upload_targets').getOne<UploadTarget>(id);
	if (!canRetry(before)) {
		throw new Error(
			before.remote_url ? 'The platform has this post already; not sending it again.' : 'This post has not failed, or not any more.'
		);
	}
	await pb.collection('upload_targets').update(id, { status: 'pending', error: '', handle: null });
	const when = retryWhen(before.scheduled_at, new Date());
	logAction(
		'upload',
		`Retried ${PLATFORMS[before.platform as PlatformId]?.label ?? before.platform}`,
		`${before.title || 'Untitled'}: goes out ${when ? `at ${when.toLocaleString()}` : 'now'}. ` +
			`It had failed with: ${firstLine(before.error || '') || 'no error given'}`,
		{ job: before.job }
	);
}

/**
 * Moves a confirmed upload to another brand (brandmove.ts): the job takes
 * the brand at once, and each post that should go out as another account
 * gets a `move` the worker carries out — deleting what the old account has
 * first, where there is something. Everything is read afresh, so the plan
 * is the rows as they are now, and logged against the upload, post by post.
 * A post already going out as the brand's account has any older request on
 * it cleared, so moving back cancels a move the worker has not got to.
 */
export async function requestBrandMove(jobId: string, brandId: string): Promise<MoveStep[]> {
	assertDeviceNamed();
	const [job, targets, brands, accounts] = await Promise.all([
		pb.collection('upload_jobs').getOne<UploadJob>(jobId),
		pb.collection('upload_targets').getFullList<UploadTarget>({ filter: pb.filter('job = {:job}', { job: jobId }) }),
		listBrands(),
		loadAccounts()
	]);
	const brand = brands.find((b) => b.id === brandId);
	if (!brand) throw new Error('That brand is gone.');
	const steps = planMove(targets, brand, accounts, brands.length, new Date());
	// Worth doing when a post moves, a waiting move is cancelled, or every
	// post is that brand's already and only the job's label is wrong.
	const relabel = job.brand !== brand.id && steps.every((step) => step.kind === 'none');
	if (!canMove(steps) && !targets.some((t) => readMove(t.move)) && !relabel) {
		throw new Error(`Nothing here can be moved to ${brand.name}.`);
	}

	const asked = { brand: brand.id, brandName: brand.name, requestedAt: new Date().toISOString(), by: deviceName() };
	for (const step of steps) {
		const target = targets.find((t) => t.id === step.target);
		if (MOVING.includes(step.kind)) {
			const move: MoveRequest = { ...asked, to: step.to, toName: step.toName, from: step.from };
			await pb.collection('upload_targets').update(step.target, { move });
		} else if (target?.move) {
			await pb.collection('upload_targets').update(step.target, { move: null });
		}
	}
	await pb.collection('upload_jobs').update(jobId, { brand: brand.id, brand_name: brand.name });

	logAction(
		'upload',
		`Moved to ${brand.name}`,
		`${job.title || job.video_name || 'Untitled'} (was ${job.brand_name || 'no brand'}): ` +
			steps.map((step) => `${PLATFORMS[step.platform]?.label ?? step.platform} — ${step.words}`).join(' '),
		{ job: jobId }
	);
	return steps;
}
