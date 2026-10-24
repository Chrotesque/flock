import type { TimeZoneChoice } from './timezones';
import type { DashColumn } from './dashcolumns';

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
	 * Keys of option fields promoted onto the compose screen. Tags are authoring
	 * work rather than configuration, so YouTube's sit beside the text instead of
	 * inside the options modal. Undefined — the default — leaves every option in
	 * the modal.
	 */
	composeFields?: string[];
	/**
	 * Fields that share one character budget, and its size.
	 *
	 * YouTube allows 500 characters across *all* tags, so splitting them into
	 * boxes for the sake of the interface must not split the counter — the four
	 * boxes are one list as far as the API is concerned. `buildPlan` flattens
	 * these keys into `options.tags`, which is what actually gets published.
	 */
	tagBudget?: { keys: string[]; limit: number };
	titleLimit: number;
	descriptionLimit: number;
	/**
	 * How much of a caption the platform shows on the video before "…more".
	 * Anything past it is marked while writing. A best guess until an API says
	 * otherwise; the whole caption is still stored and published.
	 */
	visibleCaption?: number;
	/** How this platform uses the text composed for it. */
	fieldNote: string;
	fields: OptionField[];
	defaults: OptionValues;
}

/**
 * A set of accounts, one per platform, with its own copy of every
 * per-platform setting and its own templates. An upload is made for one
 * brand; everything it starts from is that brand's.
 */
export interface Brand {
	id: string;
	name: string;
	sort_order: number;
	/** The account the brand posts as per platform, by `accounts.account_id`. */
	accounts: Partial<Record<PlatformId, string>>;
}

/**
 * An account the worker can post as, from the `accounts` collection: the
 * public half only — tokens stay in the worker config. `details` is the
 * platform's own description of it (a `TikTokCreator` for TikTok, an
 * `InstagramAccount` for Instagram).
 */
export interface Account {
	id: string;
	platform: PlatformId;
	account_id: string;
	handle: string;
	name: string;
	details: Record<string, unknown> | null;
	error: string;
	fetched_at: string;
}

export interface PlatformSettings {
	/** PocketBase record id, absent until first saved. */
	id?: string;
	/** The brand these settings belong to. */
	brand: string;
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
	 * taken from the first active platform so the Dashboard and the log have
	 * something readable. What actually gets published lives on upload_targets.
	 */
	title: string;
	description: string;
	video: string;
	/** Optional custom thumbnail for YouTube, capped at YouTube's own 2 MB. */
	thumbnail?: string;
	/** Optional custom cover for the Instagram reel, capped at Instagram's own 8 MB. */
	cover?: string;
	/** Optional custom cover for the Facebook reel, capped at Facebook's own 10 MB. */
	facebook_cover?: string;
	/** Optional cover image for TikTok, which the worker puts into the video (worker/tiktokcover.mjs). */
	tiktok_cover?: string;
	/**
	 * Set instead of `video` when the file was picked out of the watch folder
	 * rather than uploaded. The bytes stay where they are — PocketBase holds
	 * only the reference, which is what lifts the 5 GiB file-field cap.
	 */
	source_path: string;
	/** Picked from a local folder and not yet copied to the NAS by the worker. */
	source_local?: boolean;
	/** Where a local pick was copied from, once the worker has imported it. */
	source_origin?: string;
	video_name: string;
	video_size: number;
	video_duration: number;
	destination_label: string;
	destination_path: string;
	/**
	 * Where the worker's copy landed, spelled as `destination_path` is; empty
	 * until it is copied, and on jobs copied before 0.16.32 (see storedcopy.ts).
	 */
	stored_path?: string;
	status: JobStatus;
	error?: string;
	/** The brand the upload was made for; empty once that brand is deleted. */
	brand?: string;
	/** The brand's name when the upload was made, kept after a deletion. */
	brand_name?: string;
	/** What the video is about (the game); '' when none was given. */
	product?: string;
	created: string;
	updated: string;
}

export interface UploadTarget {
	id: string;
	job: string;
	platform: PlatformId;
	/** The `accounts.account_id` it goes out as; empty for the platform's only one. */
	account?: string;
	title: string;
	description: string;
	options: OptionValues;
	scheduled_at: string;
	status: TargetStatus;
	remote_url?: string;
	error?: string;
	published_at?: string;
	/**
	 * A move to another brand's account the worker has yet to carry out
	 * (brandmove.ts, worker/moves.mjs); null when none is waiting.
	 */
	move?: unknown;
	/**
	 * The worker's own record of the upload: the claiming run, the platform's
	 * handle on it and, once a platform holds the post, the time it was handed
	 * (`release`, reschedule.ts). Written only by the worker.
	 */
	handle?: unknown;
	/** A release now or a delete from the Calendar, waiting for the worker (postactions.ts). */
	request?: unknown;
	/** The job's brand and product, filled in by `listTargets` — not columns of their own. */
	brand?: string;
	brand_name?: string;
	product?: string;
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
	 * Folders the worker lists videos from, one list whatever machine they are
	 * on (see folders.ts): a network path is read where it lies, a path on the
	 * PC is copied into a network folder — `importFolderId`, else the first
	 * network one — before anything publishes.
	 */
	watchFolders: WatchFolder[];
	importFolderId: string | null;
	/**
	 * Parents of project folders: each subfolder holding a flock JSON file is
	 * a project, listed in the sidebar with its videos on the upload step.
	 */
	projectFolders: WatchFolder[];
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
	/**
	 * Lists every video that goes public on a connected YouTube channel in the
	 * sidebar, each with a button that marks it as linked on Jestr (see
	 * jestr.ts). Off by default: it is one creator's workflow, not flock's.
	 */
	jestrIntegration: boolean;
	/**
	 * Whether the sidebar shows the To finish indicator, the box that opens
	 * the list. On by default; off hides it everywhere (for a clean screen
	 * recording, say) without losing a mark.
	 */
	showTodo: boolean;
	/**
	 * The brands To finish follows for finishing steps and Jestr; null for
	 * every brand. The others show only posts that did not go out (todobrands.ts).
	 */
	todoBrands: string[] | null;
	/**
	 * Extra zones for the calendar's second time column, beside the built-in
	 * US West and US East. IANA names; one the runtime does not know is left
	 * out of the dropdown rather than shown as a wrong clock.
	 */
	timeZones: TimeZoneChoice[];
	/** The Dashboard list's columns, in order, each shown or not (dashcolumns.ts; Settings → Dashboard). */
	dashboardColumns: DashColumn[];
}

export interface WatchFolder {
	id: string;
	path: string;
	/**
	 * Picked in the worker's folder dialog rather than typed: shown as it
	 * came back, and changed only through the dialog again.
	 */
	chosen?: boolean;
}

/** One video sitting in the watch folder, as the worker last saw it. */
export interface WatchFile {
	/**
	 * Set on files from the local folders. They are not on the NAS yet, so the
	 * job is written for the worker to import first.
	 */
	local?: boolean;
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
 * The worker's listing of the watch folders of one kind, pooled: the network
 * ones in `app_settings` / `watch_index` (written by the worker that
 * publishes) and the PC's in `local_index` (by the `local` one).
 *
 * A cache rather than a setting, which is a small abuse of that collection —
 * but it means the SPA needs no second service to talk to, no CORS and no extra
 * URL to configure. The worker already polls; it writes this on the way past.
 */
export interface WatchIndex {
	scannedAt: string;
	/** One entry per configured folder, with the reason it could not be read. */
	folders: { folder: string; error?: string }[];
	files: WatchFile[];
	/** The project folders of the same kind, and how many projects each holds. */
	projectRoots?: { folder: string; error?: string; count?: number }[];
}

/** The same shape; kept as a name for the PC's half. */
export type LocalIndex = WatchIndex;

/**
 * One project folder, as the worker found it and the compose screen left it
 * (`projects`). The worker writes the first half on every change; the page
 * writes `status`, `draft`, the two images and `done_at`, and nothing else.
 */
export interface ProjectRow {
	id: string;
	key: string;
	path: string;
	name: string;
	root: string;
	/** On the PC: a picked video is copied to the NAS first. */
	local: boolean;
	/** The flock JSON file's text, read raw; flockpaste.ts reads it. */
	manifest: string;
	manifest_name: string;
	manifest_modified: string;
	videos: WatchFile[] | null;
	/** The JSON file or the folder has gone since; hidden from the sidebar. */
	missing: boolean;
	error: string;
	status: '' | 'started' | 'uploaded' | 'dismissed';
	draft: unknown;
	thumbnail: string;
	cover: string;
	done_at: string;
	/**
	 * Set by the worker once the project is sent: when it renamed the file
	 * (flock.json → flock_uploaded.json), and to what — '' if it was gone.
	 */
	archived_at: string;
	archived_as: string;
	created: string;
	updated: string;
}

/**
 * Where the worker streams listed videos from, written to `app_settings` under
 * `preview_server` when its preview server starts. Nothing removes it when the
 * worker stops, so the player asks the address before trusting it.
 */
export interface PreviewServer {
	url: string;
	startedAt: string;
}

/**
 * A video that has gone out in an upload, remembered so the file lists can
 * stop offering it. Kept apart from `upload_jobs` because a job can be
 * deleted to free the NAS, and that must not bring the file back.
 */
export interface UsedSource {
	/** Absolute path as the worker lists it; absent for a browser upload. */
	path?: string;
	name: string;
	size: number;
	at: string;
}

/** One of the channel's playlists, as the worker last listed them. */
export interface YouTubePlaylist {
	id: string;
	title: string;
	count: number;
}

/**
 * The worker's listing of the channel's playlists, in `app_settings` under
 * `youtube_playlists`. Same arrangement as the watch index, for the same
 * reason: the browser holds no Google credentials, so the worker reads the
 * list and leaves it where the compose screen can find it.
 */
export interface PlaylistIndex {
	fetchedAt: string;
	/** The channel the list belongs to; absent in a list from before channels. */
	channel?: string;
	items: YouTubePlaylist[];
	error?: string;
}

/**
 * A TikTok account the worker posts as: the `details` of its `accounts` row,
 * as the worker last read it. TikTok's rules
 * ask that the creator's name be shown wherever a post is confirmed, and its
 * creator_info call is the only source of which audiences the account
 * offers. `error` is set when the last read failed; the other fields then
 * hold the last good read.
 */
export interface TikTokCreator {
	fetchedAt: string;
	username: string;
	nickname: string;
	avatar: string;
	/** TikTok's own level names, e.g. PUBLIC_TO_EVERYONE. */
	privacyOptions: string[];
	commentDisabled: boolean;
	duetDisabled: boolean;
	stitchDisabled: boolean;
	maxDurationSeconds: number;
	error?: string;
}

/** An Instagram account the worker posts as: the `details` of its `accounts` row. */
export interface InstagramAccount {
	fetchedAt: string;
	userId: string;
	username: string;
	name: string;
	/** The Facebook Page the account is reached through (Facebook Login). */
	pageId?: string;
	pageName?: string;
	/** Posts made in the last day against the API's allowance, when known. */
	quotaUsed: number | null;
	quotaTotal: number | null;
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

/**
 * A named group of tags, insertable into any tag box.
 *
 * The same idea as a text template: build the collection once, then reuse it
 * rather than pasting the same forty tags into every video.
 */
export interface TagSet {
	id: string;
	name: string;
	tags: string[];
}

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
	/** The upload_jobs id the row is about, when it is about one. */
	job?: string;
	/** An upload's record (uploadrecord.ts), on the row written at its confirm. */
	data?: unknown;
	created: string;
}

/** One line of the worker's console, mirrored into `worker_log`. */
export interface WorkerLine {
	id: string;
	message: string;
	/** Random per worker start. */
	run: string;
	/** The upload_jobs id the line was printed for, when it was. */
	job?: string;
	created: string;
}

/**
 * One item from YouTube's videos.list, with every part the owner can ask for.
 * Loosely typed on purpose: the screen shows whatever arrived, and Google adds
 * fields without notice.
 */
export interface YouTubeVideo {
	id: string;
	snippet?: {
		title?: string;
		description?: string;
		publishedAt?: string;
		channelId?: string;
		channelTitle?: string;
		categoryId?: string;
		tags?: string[];
		defaultLanguage?: string;
		defaultAudioLanguage?: string;
		liveBroadcastContent?: string;
		thumbnails?: Record<string, { url: string; width?: number; height?: number }>;
	};
	statistics?: {
		viewCount?: string;
		likeCount?: string;
		commentCount?: string;
		favoriteCount?: string;
	};
	contentDetails?: {
		duration?: string;
		dimension?: string;
		definition?: string;
		caption?: string;
		licensedContent?: boolean;
		projection?: string;
	};
	status?: {
		uploadStatus?: string;
		privacyStatus?: string;
		license?: string;
		embeddable?: boolean;
		publicStatsViewable?: boolean;
		madeForKids?: boolean;
		selfDeclaredMadeForKids?: boolean;
		publishAt?: string;
		containsSyntheticMedia?: boolean;
	};
	topicDetails?: { topicCategories?: string[] };
	liveStreamingDetails?: Record<string, string>;
	paidProductPlacementDetails?: { hasPaidProductPlacement?: boolean };
	fileDetails?: {
		fileName?: string;
		fileSize?: string;
		fileType?: string;
		container?: string;
		durationMs?: string;
		bitrateBps?: string;
		videoStreams?: {
			widthPixels?: number;
			heightPixels?: number;
			frameRateFps?: number;
			bitrateBps?: string;
			codec?: string;
		}[];
		audioStreams?: { channelCount?: number; codec?: string; bitrateBps?: string }[];
	};
	processingDetails?: {
		processingStatus?: string;
		processingProgress?: { partsTotal?: string; partsProcessed?: string; timeLeftMs?: string };
		processingFailureReason?: string;
	};
	suggestions?: {
		processingErrors?: string[];
		processingWarnings?: string[];
		processingHints?: string[];
		tagSuggestions?: { tag: string }[];
		editorSuggestions?: string[];
	};
}

/** [iso, views, likes, comments] — one per poll on which a counter moved. */
export type StatsSample = [string, number | null, number | null, number | null];

/**
 * One video on the channel as the worker last read it. Keyed by YouTube's id
 * rather than by a job: most of the channel was never published through flock.
 */
export interface VideoStats {
	id: string;
	video_id: string;
	title: string;
	published_at: string;
	privacy: string;
	duration: number;
	views: number | null;
	likes: number | null;
	comments: number | null;
	data: YouTubeVideo;
	history: StatsSample[];
	fetched_at: string;
	created: string;
	updated: string;
}

/**
 * A stretch during which the worker polled without a break. It records these
 * itself, because a gap in a video's samples means "nothing moved" only if
 * flock was watching through it — samples are written on change, so an hour
 * with no sample and an hour with the worker switched off look the same in
 * the history.
 */
export interface PollRun {
	from: string;
	to: string;
}

/** One channel's part of the stats heartbeat. */
export interface ChannelStatus {
	title: string;
	polledAt: string;
	videos: number;
	error: string;
}

/**
 * What the worker spent of the YouTube Data API's units on one Pacific day
 * (worker/quota.mjs): the total, each kind of work's part, and the uploads,
 * which draw on a bucket of their own.
 */
export interface YouTubeQuota {
	day: string;
	units: number;
	kinds: Record<string, number>;
	uploads: number;
	/** The edits one by one — [when, kind, units] — absent from a heartbeat from before 0.16.79. */
	events?: [string, string, number][];
}

/**
 * The stats pass's heartbeat, in app_settings under `stats_status`. The
 * top level is the pass as a whole (the quota is the project's); `channels`
 * is per channel, by channel id, since the channels take turns.
 * `intervalSeconds` is how often each channel is read. `budget` is where
 * the automatic reads stop, `ceiling` where a Refresh does, and `stopped`
 * which of them holds (or Google's own `exhausted`); `quota` is absent from
 * a heartbeat written before the worker counted every kind of work.
 */
export interface StatsStatus {
	polledAt: string;
	unitsToday: number;
	budget: number;
	ceiling?: number;
	stopped?: '' | 'auto' | 'ceiling' | 'exhausted';
	quota?: YouTubeQuota;
	intervalSeconds: number;
	/** Seconds between two reads, and whether the page set them (`stats_pace`) or the worker's config did. */
	paceSeconds?: number;
	paceFrom?: 'setting' | 'config';
	videos: number;
	error: string;
	runs?: PollRun[];
	channels?: Record<string, ChannelStatus>;
}
