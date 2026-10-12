import { PLATFORMS, isPlatformId } from './platforms';
import type { OptionValues, PlatformId, TargetStatus, UploadJob, UploadTarget } from './types';

/**
 * What an upload confirmed, kept on its Log row (`activity_log.data`).
 *
 * Written once, at the confirm, and never changed: the job and its targets
 * can be deleted (Analytics frees the NAS) or moved (the Calendar), but this
 * stays what the person saw and sent. Beside what the worker did with it —
 * the targets' state and the lines it logged for the job — it answers
 * whether something that went wrong was chosen that way or went wrong in
 * flock. One record per video: a confirm whose platforms had files of their
 * own writes one job, and one record, per file.
 */
export interface UploadRecord {
	v: number;
	/** flock's version on the confirming browser. */
	version: string;
	confirmedAt: string;
	/** The confirming browser's time zone, which `date` + `time` are in. */
	timeZone: string;
	brand: string;
	/** The project folder it was opened from, '' when none. */
	project: string;
	video: RecordVideo;
	/** The confirm's other videos, when platforms were given files of their own. */
	others: { name: string; platforms: PlatformId[] }[];
	destination: { label: string; path: string } | null;
	/** Instagram's cover image, as sent with this job. */
	cover: { name: string; size: number } | null;
	/** local-devtest modules changing anything at the time (devtest.ts). */
	devtest: string[];
	targets: RecordTarget[];
	/**
	 * Built from the stored upload, because it was logged before records were
	 * kept: what the job holds now, without what only the confirm knew.
	 */
	reconstructed?: boolean;
}

export type VideoSource = 'browser' | 'nas' | 'local';

export interface RecordVideo {
	name: string;
	size: number;
	/** Seconds, as the browser read it; 0 when it could not. */
	duration: number;
	/** Sent from the browser, picked from a watch folder on the LAN, or from one on the PC. */
	source: VideoSource;
	/** The path picked; '' for a file sent from the browser. */
	path: string;
	/** Whether the Review step played it before the confirm. */
	previewed: boolean;
}

export interface RecordTarget {
	platform: PlatformId;
	/** Who it went out as, in the Review step's words; '' when the worker had not said. */
	account: string;
	/** The `accounts.account_id` written on the target. */
	accountId: string;
	/** What was typed, before the platform's rules ran. */
	typed: { title: string; description: string };
	/** What was sent, after them. */
	title: string;
	description: string;
	/** The rules that changed something, and how often. */
	rules: { find: string; replace: string; count: number; error?: string }[];
	options: OptionValues;
	immediate: boolean;
	/** The slot as picked, in `timeZone`. */
	date: string;
	time: string;
	/** The instant written to the target. */
	scheduledAt: string;
	/** The release-timing profile picked, '' for none. */
	profile: string;
	/** What the Review step warned about for this post. */
	warnings: string[];
}

export const RECORD_VERSION = 1;

/* ---- reading it back ---- */

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const obj = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function readOptions(value: unknown): OptionValues {
	const out: OptionValues = {};
	for (const [key, v] of Object.entries(obj(value))) {
		if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v;
		else if (Array.isArray(v)) out[key] = strings(v);
	}
	return out;
}

function readTarget(raw: unknown): RecordTarget | null {
	const t = obj(raw);
	if (!isPlatformId(str(t.platform))) return null;
	const typed = obj(t.typed);
	return {
		platform: t.platform as PlatformId,
		account: str(t.account),
		accountId: str(t.accountId),
		typed: { title: str(typed.title), description: str(typed.description) },
		title: str(t.title),
		description: str(t.description),
		rules: (Array.isArray(t.rules) ? t.rules : []).map((r) => {
			const rule = obj(r);
			return {
				find: str(rule.find),
				replace: str(rule.replace),
				count: num(rule.count),
				...(rule.error ? { error: str(rule.error) } : {})
			};
		}),
		options: readOptions(t.options),
		immediate: t.immediate === true,
		date: str(t.date),
		time: str(t.time),
		scheduledAt: str(t.scheduledAt),
		profile: str(t.profile),
		warnings: strings(t.warnings)
	};
}

/**
 * A stored record, rebuilt field by field so a row written by another
 * version (or by hand) never breaks the page. Null when it is not one.
 */
export function readUploadRecord(raw: unknown): UploadRecord | null {
	const r = obj(raw);
	if (typeof r.v !== 'number' || !Array.isArray(r.targets)) return null;
	const video = obj(r.video);
	const source = str(video.source);
	const destination = obj(r.destination);
	const cover = obj(r.cover);
	return {
		v: r.v,
		version: str(r.version),
		confirmedAt: str(r.confirmedAt),
		timeZone: str(r.timeZone),
		brand: str(r.brand),
		project: str(r.project),
		video: {
			name: str(video.name),
			size: num(video.size),
			duration: num(video.duration),
			source: source === 'nas' || source === 'local' ? source : 'browser',
			path: str(video.path),
			previewed: video.previewed === true
		},
		others: (Array.isArray(r.others) ? r.others : []).map((o) => {
			const other = obj(o);
			return { name: str(other.name), platforms: strings(other.platforms).filter(isPlatformId) };
		}),
		destination: r.destination ? { label: str(destination.label), path: str(destination.path) } : null,
		cover: r.cover ? { name: str(cover.name), size: num(cover.size) } : null,
		devtest: strings(r.devtest),
		targets: r.targets.map(readTarget).filter((t): t is RecordTarget => t !== null),
		...(r.reconstructed === true ? { reconstructed: true } : {})
	};
}

/* ---- uploads from before records were kept ---- */

/**
 * The record an upload logged before 0.12.0 would have had, as far as its
 * job and targets still say: what was sent, not what was typed, and the
 * slot as it stands now (the Calendar may have moved it).
 */
export function recordFromJob(job: UploadJob, targets: UploadTarget[]): UploadRecord {
	const local = Boolean(job.source_local || job.source_origin);
	return {
		v: RECORD_VERSION,
		version: '',
		confirmedAt: job.created,
		timeZone: '',
		brand: job.brand_name ?? '',
		project: '',
		video: {
			name: job.video_name,
			size: job.video_size,
			duration: job.video_duration,
			source: job.video ? 'browser' : local ? 'local' : 'nas',
			path: job.source_origin || job.source_path || '',
			previewed: false
		},
		others: [],
		destination: job.destination_path ? { label: job.destination_label, path: job.destination_path } : null,
		cover: job.cover ? { name: job.cover, size: 0 } : null,
		devtest: [],
		targets: [...targets]
			.sort((a, b) => platformOrder(a.platform) - platformOrder(b.platform))
			.map((t) => ({
				platform: t.platform,
				account: '',
				accountId: t.account ?? '',
				typed: { title: t.title, description: t.description },
				title: t.title,
				description: t.description,
				rules: [],
				options: t.options ?? {},
				immediate: false,
				date: '',
				time: '',
				scheduledAt: t.scheduled_at,
				profile: '',
				warnings: []
			})),
		reconstructed: true
	};
}

function platformOrder(id: PlatformId): number {
	const index = Object.keys(PLATFORMS).indexOf(id);
	return index < 0 ? 99 : index;
}

/**
 * The file name an old "Uploaded …" row starts its detail with: what
 * createJob wrote before records were kept, "<name> (from …) → n platform(s)".
 */
export function loggedFileName(detail: string): string {
	const cut = detail.search(/ \(from (?:a local folder|the watch folder)\) → | → \d+ platform/);
	return (cut < 0 ? detail : detail.slice(0, cut)).trim();
}

/* ---- showing it ---- */

/** Choices made in the per-upload boxes rather than the registry, by their on-screen names. */
const BOX_LABELS: Record<string, string> = {
	privacy: 'Who can view this video',
	allowComments: 'Allow comments',
	allowDuet: 'Allow Duet',
	allowStitch: 'Allow Stitch',
	discloseContent: 'Content Disclosure Setting',
	brandOrganic: 'Your brand',
	brandContent: 'Branded content',
	disclosure: 'Disclosure',
	playlist: 'Playlist',
	paidPromotion: 'Paid promotion',
	tags: 'Tags as sent'
};

const TIKTOK_UNMADE: OptionValues = {
	privacy: '',
	allowComments: false,
	allowDuet: false,
	allowStitch: false,
	discloseContent: false
};

export interface OptionLine {
	key: string;
	label: string;
	value: string;
	/** Unset: nothing was chosen. */
	empty: boolean;
}

function show(value: unknown, unit = ''): { value: string; empty: boolean } {
	if (value === undefined || value === null || value === '') return { value: 'not set', empty: true };
	if (typeof value === 'boolean') return { value: value ? 'Yes' : 'No', empty: false };
	if (Array.isArray(value)) {
		return value.length === 0 ? { value: 'none', empty: true } : { value: value.join(', '), empty: false };
	}
	return { value: `${value}${unit ? ` ${unit}` : ''}`, empty: false };
}

/**
 * A post's options as lines to read: the registry's fields in the registry's
 * order and words, then the per-upload boxes' choices (TikTok's audience
 * and interactions, the playlist), then anything else under its own key —
 * a key no screen knows any more is shown rather than hidden.
 */
export function optionLines(platform: PlatformId, given: OptionValues): OptionLine[] {
	const def = PLATFORMS[platform];
	// TikTok's box starts with nothing chosen and every box unticked, so a
	// choice missing from the options is "not set" or "No", and is said.
	const options = platform === 'tiktok' ? { ...TIKTOK_UNMADE, ...given } : given;
	const lines: OptionLine[] = [];
	const done = new Set<string>();
	for (const field of def.fields) {
		done.add(field.key);
		lines.push({ key: field.key, label: field.label, ...show(options[field.key], field.type === 'number' ? (field.unit ?? '') : '') });
	}
	for (const [key, label] of Object.entries(BOX_LABELS)) {
		if (done.has(key) || !(key in options)) continue;
		done.add(key);
		lines.push({ key, label, ...show(options[key]) });
	}
	for (const key of Object.keys(options).sort()) {
		if (done.has(key)) continue;
		lines.push({ key, label: key, ...show(options[key]) });
	}
	return lines;
}

/** A target's state on the platform, in words. */
export function statusWords(status: TargetStatus | string): string {
	switch (status) {
		case 'pending':
			return 'Waiting for the worker';
		case 'publishing':
			return 'Being published';
		case 'scheduled':
			return 'Held by the platform until its slot';
		case 'published':
			return 'Published';
		case 'failed':
			return 'Failed';
		case 'cancelled':
			return 'Cancelled';
		default:
			return status || 'Unknown';
	}
}

/** Whether the slot now differs from the one confirmed — moved in the Calendar since. */
export function slotMoved(confirmed: string, now: string): boolean {
	const a = Date.parse(confirmed);
	const b = Date.parse(now);
	return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) >= 60_000;
}

/* ---- what happened ---- */

export interface TimelineEntry {
	id: string;
	at: string;
	/** A Log row (by a browser or the worker), or a line of the worker's console. */
	kind: 'log' | 'console';
	/** Who wrote it: a device name, 'worker'. */
	by: string;
	text: string;
	detail: string;
}

/**
 * The upload's Log rows and the worker's console lines for it, as one list
 * in the order they happened — rows before lines written in the same
 * millisecond, since a row says what a line goes on to show.
 */
export function mergeTimeline(
	rows: { id: string; created: string; action: string; detail: string; device: string }[],
	lines: { id: string; created: string; message: string }[]
): TimelineEntry[] {
	const entries: TimelineEntry[] = [
		...rows.map((row) => ({
			id: row.id,
			at: row.created,
			kind: 'log' as const,
			by: row.device,
			text: row.action,
			detail: row.detail
		})),
		...lines.map((line) => ({
			id: line.id,
			at: line.created,
			kind: 'console' as const,
			by: 'worker',
			text: line.message,
			detail: ''
		}))
	];
	const time = (iso: string) => {
		const t = Date.parse(iso.replace(' ', 'T'));
		return Number.isFinite(t) ? t : 0;
	};
	return entries
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => {
			const diff = time(a.entry.at) - time(b.entry.at);
			if (diff !== 0) return diff;
			if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'log' ? -1 : 1;
			return a.index - b.index;
		})
		.map(({ entry }) => entry);
}
