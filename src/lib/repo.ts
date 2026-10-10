import { pb, PB_URL } from './pb';
import { PLATFORMS, PLATFORM_IDS, isPlatformId } from './platforms';
import { DEFAULT_SCHEDULING } from './types';
import { logAction, assertDeviceNamed } from './log';
import { newId } from './id';
import {
	FIRST_BRAND_NAME,
	brandKey,
	brandSettingKey,
	orderBrands,
	rowsToAdopt,
	type SettingsRowRef
} from './brands';
import type { WorkerBeat, WorkerBeats, WorkerRole } from './workerstatus';
import type {
	Brand,
	OptionValues,
	PlatformId,
	WatchIndex,
	LocalIndex,
	PreviewServer,
	UsedSource,
	PlaylistIndex,
	PlatformScheduling,
	PlatformSettings,
	UploadJob,
	UploadTarget,
	VideoStats,
	StatsStatus,
	TikTokCreator,
	InstagramAccount
} from './types';

/* ------------------------------------------------------------------ */
/* brands                                                               */
/* ------------------------------------------------------------------ */

/** The per-brand `app_settings` areas, by their key before brands existed. */
const BRAND_SETTINGS = ['templates', 'recent_tags'] as const;

function toBrand(row: Record<string, unknown>): Brand {
	return {
		id: String(row.id),
		name: String(row.name ?? ''),
		sort_order: Number(row.sort_order ?? 0)
	};
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
 * are a memory of what this brand used, and it has used nothing yet.
 */
export async function createBrand(name: string, sortOrder: number, copyFrom: Brand | null): Promise<Brand> {
	assertDeviceNamed();
	const created = toBrand(
		await pb
			.collection('brands')
			.create({ name: name.trim(), key: brandKey(name), sort_order: sortOrder })
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
	/** Optional custom cover for the reel. Only Instagram does anything with it. */
	cover: File | null;
	duration: number;
	/** Where on the NAS this video should end up, snapshotted at confirm time. */
	destination: { label: string; path: string } | null;
	/** The brand the upload is made for; its name is snapshotted with it. */
	brand: Brand | null;
	targets: TargetPlan[];
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
			title: target.title,
			description: target.description,
			options: target.options,
			scheduled_at: toInstant(target.date, target.time),
			status: 'pending'
		});
	}

	const sourceName = input.file ? input.file.name : (input.source?.name ?? 'unknown');
	logAction(
		'upload',
		`Uploaded "${input.title || 'untitled'}"`,
		`${sourceName}${input.source ? (input.source.local ? ' (from a local folder)' : ' (from the watch folder)') : ''} → ${input.targets.length} ` +
			`platform(s): ${input.targets.map((t) => t.platform).join(', ')}` +
			(input.brand ? ` · ${input.brand.name}` : '')
	);

	return job;
}

/**
 * The worker's listing of the watch folder.
 *
 * A browser cannot read a filesystem, so this is the only way the compose
 * screen knows what is sitting there. It is written by the worker on each poll
 * pass, which means it is stale by up to that interval — `scannedAt` is shown
 * so an empty list reads as "nothing scanned recently" rather than "no files".
 */
export async function loadWatchIndex(): Promise<WatchIndex | null> {
	const empty: WatchIndex | null = null;
	const index = await getSetting<WatchIndex | null>('watch_index', empty);
	if (!index || !Array.isArray(index.files)) return null;
	return index;
}

/** The worker's pooled listing of the local folders; same arrangement as the watch index. */
export async function loadLocalIndex(): Promise<LocalIndex | null> {
	const empty: LocalIndex | null = null;
	const index = await getSetting<LocalIndex | null>('local_index', empty);
	if (!index || !Array.isArray(index.files)) return null;
	return { ...index, folders: Array.isArray(index.folders) ? index.folders : [] };
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
	opts: { signal?: AbortSignal; onWaiting?: () => void; giveUpMs?: number } = {}
): Promise<string | null> {
	const id = newId();
	await setSetting('folder_pick', { id, status: 'pending', requestedAt: new Date().toISOString() });

	const started = Date.now();
	let warned = false;
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

/** The channel's playlists, as the worker last listed them. */
export async function loadPlaylists(): Promise<PlaylistIndex | null> {
	const empty: PlaylistIndex | null = null;
	const index = await getSetting<PlaylistIndex | null>('youtube_playlists', empty);
	if (!index || !Array.isArray(index.items)) return null;
	return index;
}

/**
 * The TikTok account the worker posts as, as it last read it. Null until the
 * worker has run with TikTok set up; the same arrangement as the playlists.
 */
export async function loadTikTokCreator(): Promise<TikTokCreator | null> {
	const empty: TikTokCreator | null = null;
	const creator = await getSetting<TikTokCreator | null>('tiktok_creator', empty);
	if (!creator || typeof creator.username !== 'string') return null;
	return { ...creator, privacyOptions: Array.isArray(creator.privacyOptions) ? creator.privacyOptions : [] };
}

/** The Instagram account the worker posts as, as it last read it. */
export async function loadInstagramAccount(): Promise<InstagramAccount | null> {
	const empty: InstagramAccount | null = null;
	const account = await getSetting<InstagramAccount | null>('instagram_account', empty);
	if (!account || typeof account.username !== 'string') return null;
	return account;
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

export async function deleteJob(id: string): Promise<void> {
	assertDeviceNamed();
	// upload_targets cascade-delete with the job.
	await pb.collection('upload_jobs').delete(id);
	logAction('upload', 'Deleted a stored upload', id);
}

/**
 * Moves one already-committed release to a new instant. Used by the Calendar's
 * edit mode; the wizard never calls this, since nothing is written there until
 * the upload is confirmed.
 */
export async function rescheduleTarget(id: string, scheduledAt: string): Promise<void> {
	assertDeviceNamed();
	const before = await pb.collection('upload_targets').getOne(id);
	await pb.collection('upload_targets').update(id, { scheduled_at: scheduledAt });
	logAction(
		'calendar',
		`Rescheduled ${before.platform}`,
		`${new Date(before.scheduled_at).toLocaleString()} → ${new Date(scheduledAt).toLocaleString()}`
	);
}
