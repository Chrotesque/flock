import { pb, PB_URL } from './pb';
import { PLATFORMS, PLATFORM_IDS, isPlatformId } from './platforms';
import { DEFAULT_SCHEDULING } from './types';
import { logAction } from './log';
import type {
	OptionValues,
	PlatformId,
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
	file: File;
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
	const form = new FormData();
	form.set('title', input.title);
	form.set('description', input.description);
	form.set('video', input.file);
	form.set('video_name', input.file.name);
	form.set('video_size', String(input.file.size));
	form.set('video_duration', String(Math.round(input.duration)));
	form.set('destination_label', input.destination?.label ?? '');
	form.set('destination_path', input.destination?.path ?? '');
	form.set('status', 'stored');

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

	logAction(
		'upload',
		`Uploaded "${input.title || 'untitled'}"`,
		`${input.file.name} → ${input.targets.length} platform(s): ${input.targets
			.map((t) => t.platform)
			.join(', ')}`
	);

	return job;
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
	const before = await pb.collection('upload_targets').getOne(id);
	await pb.collection('upload_targets').update(id, { scheduled_at: scheduledAt });
	logAction(
		'calendar',
		`Rescheduled ${before.platform}`,
		`${new Date(before.scheduled_at).toLocaleString()} → ${new Date(scheduledAt).toLocaleString()}`
	);
}
