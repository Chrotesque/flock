import { pb, PB_URL } from './pb';
import { PLATFORMS, PLATFORM_IDS, isPlatformId } from './platforms';
import { DEFAULT_SCHEDULING } from './types';
import { logAction, assertDeviceNamed } from './log';
import type {
	OptionValues,
	PlatformId,
	WatchIndex,
	PlatformScheduling,
	PlatformSettings,
	UploadJob,
	UploadTarget
} from './types';

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
 * Loads every platform's settings, creating any row that does not exist yet
 * from the registry defaults. Seeding lives here rather than in setup-pb.mjs
 * so the shipped defaults have exactly one source of truth (platforms.ts).
 */
export async function loadPlatformSettings(): Promise<PlatformSettings[]> {
	const rows = await pb.collection('platform_settings').getFullList({ sort: 'sort_order' });

	const byPlatform = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		// Defensive: a unique index protects this, but a stray row for an
		// unknown platform must not crash the whole app.
		if (isPlatformId(row.platform)) byPlatform.set(row.platform, row);
	}

	const result: PlatformSettings[] = [];

	for (const [index, id] of PLATFORM_IDS.entries()) {
		const existing = byPlatform.get(id);
		if (existing) {
			result.push({
				id: existing.id,
				platform: id,
				enabled: existing.enabled ?? true,
				sort_order: existing.sort_order ?? index,
				// A default added to the registry after the row was written would
				// otherwise be missing entirely.
				defaults: { ...PLATFORMS[id].defaults, ...(existing.defaults ?? {}) },
				filters: Array.isArray(existing.filters) ? existing.filters : [],
				scheduling: mergeScheduling(existing.scheduling)
			});
			continue;
		}

		const created = await pb.collection('platform_settings').create({
			platform: id,
			enabled: true,
			sort_order: index,
			defaults: PLATFORMS[id].defaults,
			filters: [],
			scheduling: DEFAULT_SCHEDULING
		});
		result.push({
			id: created.id,
			platform: id,
			enabled: true,
			sort_order: index,
			defaults: { ...PLATFORMS[id].defaults },
			filters: [],
			scheduling: { ...DEFAULT_SCHEDULING, profiles: [] }
		});
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
	source: { path: string; name: string; size: number } | null;
	duration: number;
	/** Where on the NAS this video should end up, snapshotted at confirm time. */
	destination: { label: string; path: string } | null;
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

	if (input.file) {
		form.set('video', input.file);
		form.set('video_name', input.file.name);
		form.set('video_size', String(input.file.size));
		form.set('source_path', '');
	} else if (input.source) {
		// Nothing to transfer — the video is already on the NAS. The progress
		// callback still has to reach 1, or the confirm screen sits at 0%.
		form.set('source_path', input.source.path);
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
		`${sourceName}${input.source ? ' (from the watch folder)' : ''} → ${input.targets.length} ` +
			`platform(s): ${input.targets.map((t) => t.platform).join(', ')}`
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

/**
 * The tag list last published for each platform.
 *
 * Kept apart from `platform_settings.defaults` on purpose: writing it there
 * would mean every upload silently edited the user's saved defaults and logged a
 * settings change. This is a memory of what was used, not a preference.
 */
export type RecentTags = Partial<Record<PlatformId, Record<string, string[]>>>;

export async function loadRecentTags(): Promise<RecentTags> {
	const stored = await getSetting<RecentTags>('recent_tags', {});
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
export function rememberTags(used: RecentTags): void {
	void (async () => {
		try {
			const current = await loadRecentTags();
			const next: RecentTags = { ...current };
			for (const [platform, byField] of Object.entries(used)) {
				if (isPlatformId(platform) && byField && Object.keys(byField).length > 0) {
					next[platform] = byField;
				}
			}
			await setSetting('recent_tags', next);
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

export async function listJobs(limit = 25): Promise<UploadJob[]> {
	const res = await pb.collection('upload_jobs').getList(1, limit, { sort: '-created' });
	return res.items as unknown as UploadJob[];
}

export async function listTargets(jobId?: string): Promise<UploadTarget[]> {
	const rows = await pb.collection('upload_targets').getFullList({
		sort: 'scheduled_at',
		...(jobId ? { filter: `job="${jobId}"` } : {})
	});
	return rows as unknown as UploadTarget[];
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
