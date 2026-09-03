export type PlatformId = 'youtube' | 'instagram' | 'tiktok' | 'facebook';

/** How a platform's option is rendered in its modal + settings panel. */
export type OptionField =
	| { key: string; label: string; type: 'bool'; hint?: string }
	| { key: string; label: string; type: 'text'; placeholder?: string; hint?: string }
	| { key: string; label: string; type: 'tags'; placeholder?: string; hint?: string }
	| { key: string; label: string; type: 'number'; min?: number; max?: number; step?: number; unit?: string; hint?: string }
	| { key: string; label: string; type: 'select'; choices: string[]; hint?: string };

export type OptionValue = string | number | boolean | string[];
export type OptionValues = Record<string, OptionValue>;

/** A rudimentary "replace X with Y" adaptation rule, scoped to one platform. */
export interface FilterRule {
	id: string;
	enabled: boolean;
	find: string;
	replace: string;
	target: 'title' | 'description' | 'both';
	mode: 'literal' | 'regex';
	caseSensitive: boolean;
}

/** One rule's effect on one field, for the "what changed" overview. */
export interface FilterHit {
	ruleId: string;
	find: string;
	replace: string;
	count: number;
	error?: string;
}

export interface FilterResult {
	output: string;
	hits: FilterHit[];
}

/** One platform's composed text. Platforms without a title leave it empty. */
export interface PlatformText {
	title: string;
	description: string;
}

export interface PlatformDefinition {
	id: PlatformId;
	label: string;
	/** Muted brand colour. Pink/purple stays reserved for selection state. */
	color: string;
	/**
	 * Whether this platform has a title distinct from its description. False for
	 * the caption-only platforms, whose compose panel renders no title field at
	 * all — nothing is stored for it and nothing is required to continue.
	 */
	hasTitle: boolean;
	/**
	 * Key of an option field promoted onto the compose screen, alongside the
	 * templates box. Tags are authoring work rather than configuration, so
	 * YouTube's sit next to the text instead of inside the options modal.
	 * Undefined — the default — leaves every option in the modal.
	 */
	composeField?: string;
	titleLimit: number;
	descriptionLimit: number;
	/** How this platform uses the text composed for it. */
	fieldNote: string;
	fields: OptionField[];
	defaults: OptionValues;
}

export interface PlatformSettings {
	/** PocketBase record id, absent until first saved. */
	id?: string;
	platform: PlatformId;
	enabled: boolean;
	sort_order: number;
	defaults: OptionValues;
	filters: FilterRule[];
	scheduling: PlatformScheduling;
}

export type JobStatus = 'draft' | 'uploading' | 'stored' | 'publishing' | 'done' | 'failed';
/**
 * `scheduled` means the platform has the video *and* the release time, and is
 * holding it until then — YouTube keeps it private until `publishAt`. Moving
 * the card in flock after that changes nothing on the platform, so the Calendar
 * locks it like history rather than leaving it draggable.
 */
export type TargetStatus =
	| 'pending'
	| 'publishing'
	| 'scheduled'
	| 'published'
	| 'failed'
	| 'cancelled';

export interface UploadJob {
	id: string;
	/**
	 * A label for the job, not the published text. Since every platform is
	 * composed separately there is no single authored pair any more; this is
	 * taken from the first active platform so Analytics and the log have
	 * something readable. What actually gets published lives on upload_targets.
	 */
	title: string;
	description: string;
	video: string;
	/**
	 * Set instead of `video` when the file was picked out of the watch folder
	 * rather than uploaded. The bytes stay where they are — PocketBase holds
	 * only the reference, which is what lifts the 5 GiB file-field cap.
	 */
	source_path: string;
	video_name: string;
	video_size: number;
	video_duration: number;
	destination_label: string;
	destination_path: string;
	status: JobStatus;
	error?: string;
	created: string;
	updated: string;
}

export interface UploadTarget {
	id: string;
	job: string;
	platform: PlatformId;
	title: string;
	description: string;
	options: OptionValues;
	scheduled_at: string;
	status: TargetStatus;
	remote_url?: string;
	error?: string;
	published_at?: string;
	created: string;
	updated: string;
}

/** The in-progress wizard state. Lives in memory only until confirmed. */
export interface Draft {
	/** Composed per platform — there is no shared title/description pair. */
	texts: Partial<Record<PlatformId, PlatformText>>;
	file: File | null;
	selected: Record<PlatformId, boolean>;
	/** Per-platform option overrides on top of that platform's saved defaults. */
	overrides: Partial<Record<PlatformId, OptionValues>>;
	/** Per-platform "YYYY-MM-DD" + "HH:mm", local time. */
	schedule: Partial<Record<PlatformId, { date: string; time: string }>>;
}

/** A folder on the NAS a finished video is copied into. The original stays put. */
export interface NasDestination {
	id: string;
	label: string;
	path: string;
}

export interface GeneralSettings {
	destinations: NasDestination[];
	defaultDestinationId: string | null;
	/**
	 * Folder on the NAS that videos can be dropped into instead of uploaded
	 * through the browser. The worker scans it and publishes the listing; the
	 * SPA cannot read a filesystem itself.
	 */
	watchFolder: string;
	/**
	 * Renders YouTube's brand features the way its API branding guidelines
	 * require: the official mark in official colours, and a clickable logo
	 * linking back to YouTube wherever the API has a presence.
	 *
	 * Off by default because the official red fights the muted palette the rest
	 * of the interface is built on — pink/purple is reserved for selection state,
	 * and a full-strength brand colour beside it muddies that. On is the
	 * compliant state; off is the comfortable one.
	 */
	complianceBranding: boolean;
}

/** One video sitting in the watch folder, as the worker last saw it. */
export interface WatchFile {
	name: string;
	size: number;
	modified: string;
	/**
	 * Absolute path as the *worker* sees it, which is not necessarily how the
	 * folder was typed into Settings — a UNC path from a Windows machine is a
	 * Linux path once the worker runs on the NAS. Emitting it here keeps the
	 * browser out of the business of joining paths it cannot verify.
	 */
	path: string;
}

/**
 * The worker's listing of the watch folder, written to `app_settings` under
 * `watch_index`.
 *
 * A cache rather than a setting, which is a small abuse of that collection —
 * but it means the SPA needs no second service to talk to, no CORS and no extra
 * URL to configure. The worker already polls; it writes this on the way past.
 */
export interface WatchIndex {
	folder: string;
	scannedAt: string;
	files: WatchFile[];
	error?: string;
}

/**
 * A named release pattern for one platform — "Horror goes out Friday at 21:00".
 * Both halves are independently switchable: a profile may set only a time, only
 * a set of days, or both.
 */
export interface SchedulingProfile {
	id: string;
	name: string;
	useTime: boolean;
	/** "HH:mm". */
	time: string;
	useDays: boolean;
	/** Day numbers as returned by Date.getDay() — 0 is Sunday. */
	days: number[];
}

export interface PlatformScheduling {
	/**
	 * 'time' — one fixed release time for the platform.
	 * 'profiles' — named patterns, picked per upload.
	 */
	mode: 'time' | 'profiles';
	/** Used in 'time' mode, as "HH:mm". */
	defaultTime: string;
	profiles: SchedulingProfile[];
}

export const DEFAULT_SCHEDULING: PlatformScheduling = {
	mode: 'time',
	defaultTime: '09:00',
	profiles: []
};

/** A named snippet of text, insertable into a title or description. */
export interface TextTemplate {
	id: string;
	name: string;
	content: string;
}

export type LogCategory = 'upload' | 'calendar' | 'settings';

export interface LogEntry {
	id: string;
	category: LogCategory;
	action: string;
	detail: string;
	device: string;
	created: string;
}
