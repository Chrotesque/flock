import { kindOf } from './videokind';
import { studioTasks, studioUrl, videoIdOf } from './studio';

/**
 * The sidebar's "To finish" list: a line per YouTube video with something
 * left to do by hand, each with a YouTube icon that opens the video's edit
 * page in Studio.
 *
 * - Studio: every flock upload YouTube has, for its thumbnail (a Short's
 *   cover) and paid promotion, which flock does not set (studio.ts).
 *   Opening it through the icon counts as done.
 *
 * Beside that, each line says whether YouTube reports paid promotion on
 * the video (`paid`), from the stats row: tested on 12 Oct 2026 with an
 * untouched private upload, which read false until it was ticked in Studio
 * and true on the next read. It only informs — the click is still the
 * record — since "not ticked" is also right for a video without any.
 * - Jestr, only with `general.jestrIntegration` on: every video gone public
 *   on a connected channel — through flock or not — until its Jestr button
 *   says it is linked on jestr.gg. Jestr has no API (checked 11 Oct 2026: no
 *   docs, keys or webhooks, and its terms forbid scraping), so the press is
 *   the whole record. A scheduled video is listed with the button greyed
 *   until it goes public; a link cannot be submitted before.
 *
 * - Waiting: a flock upload to YouTube from the moment it is confirmed until
 *   YouTube has it (no link yet), and with Jestr on until the channel's next
 *   read lists it — a placeholder with a spinner, so a finished upload is
 *   never mistaken for a missing one (v0.11.7, the user's request).
 *
 * A line goes once nothing is left on it. Stored in `app_settings` under
 * `video_todo` as { since, jestr, studio }: `since` is where the list began,
 * so a new install or a newly connected channel does not list everything it
 * already had; the other two are the video ids done for each.
 */
export interface TodoState {
	since: string;
	jestr: string[];
	studio: string[];
}

export type TodoKind = 'jestr' | 'studio';

export const TODO_KEY = 'video_todo';
/** Where v0.9.12's Jestr-only list kept { since, done }; adopted once. */
export const LEGACY_JESTR_KEY = 'jestr';

/** Done ids kept per kind, newest last; at a few videos a day this is years. */
export const TODO_DONE_MAX = 2000;

/** A `video_stats` row with only the fields the list reads. */
export interface StatsRow {
	video_id: string;
	title?: string;
	published_at?: string;
	duration?: number;
	privacy?: string;
	data?: {
		snippet?: { channelTitle?: string; thumbnails?: { medium?: { url?: string }; maxres?: { url?: string } } };
		status?: { publishAt?: string };
		liveStreamingDetails?: Record<string, unknown>;
		paidProductPlacementDetails?: { hasPaidProductPlacement?: boolean };
	};
}

export const STATS_FIELDS =
	'video_id,title,published_at,duration,privacy,data.snippet.channelTitle,data.status.publishAt,data.liveStreamingDetails,data.paidProductPlacementDetails.hasPaidProductPlacement,data.snippet.thumbnails.medium.url,data.snippet.thumbnails.maxres.url';

/** A flock YouTube upload (`upload_targets` row) with only what the list reads. */
export interface UploadRow {
	id: string;
	title?: string;
	remote_url?: string;
	/** `pending` (queued) and `publishing` (uploading) are the waiting ones. */
	status?: string;
	created?: string;
}

export const UPLOAD_FIELDS = 'id,title,remote_url,status,created';

/** What a waiting line is waiting for, in the words its spinner's tooltip uses. */
export const WAITING = {
	queued: 'Queued — the worker picks it up in a moment',
	uploading: 'Uploading to YouTube — the link follows once YouTube has it',
	listing: "On YouTube — Jestr's button follows once the channel is read again"
} as const;

export interface TodoLine {
	/** YouTube's video id. */
	id: string;
	title: string;
	channel: string;
	/** Where the title leads: a Short's own address, the watch page otherwise. */
	watchUrl: string;
	studioUrl: string;
	/** What is left to set in Studio; empty when the icon is only a way there. */
	studio: string[];
	/** `open` to link now, `waiting` until it goes public, null when not asked or done. */
	jestr: 'open' | 'waiting' | null;
	/** When a scheduled video goes public; null once it is (or when not known). */
	publicAt: string | null;
	/** Whether YouTube reports paid promotion on it; null until the stats pass has read it. */
	paid: boolean | null;
	/**
	 * YouTube's 16:9 thumbnail (320×180) once the stats pass has read the
	 * video, '' before. A private video's is a signed address that changes
	 * with every read.
	 */
	thumb: string;
	/** The 1280×720 one for the enlarged preview, or `thumb` where YouTube has none. */
	thumbLarge: string;
	/** A Short, whose preview is the middle of that thumbnail, upright. */
	short: boolean;
	/**
	 * Why the line is a placeholder for now (WAITING), or null. Without a
	 * YouTube link yet, `id` is `upload:<target id>` and there is nothing to
	 * open.
	 */
	waiting: string | null;
}

/** Local midnight of the given day, as an instant: where a fresh list begins. */
export function startOfDay(now: Date): string {
	const day = new Date(now);
	day.setHours(0, 0, 0, 0);
	return day.toISOString();
}

const ids = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/**
 * A stored state read field by field. Without one, the Jestr-only list's row
 * (`{ since, done }`) is adopted, so its start and its marks carry over.
 */
export function readTodoState(value: unknown, legacy: unknown, fallbackSince: string): TodoState {
	const v = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null;
	if (v) {
		return { since: validDate(v.since) ? v.since : fallbackSince, jestr: ids(v.jestr), studio: ids(v.studio) };
	}
	const old = (legacy && typeof legacy === 'object' ? legacy : {}) as Record<string, unknown>;
	return { since: validDate(old.since) ? old.since : fallbackSince, jestr: ids(old.done), studio: [] };
}

/** The state with one more video done for a kind, each id once, the oldest dropped past the cap. */
export function markDone(state: TodoState, kind: TodoKind, id: string): TodoState {
	const done = [...state[kind].filter((d) => d !== id), id].slice(-TODO_DONE_MAX);
	return { ...state, [kind]: done };
}

/** Both browsers' marks, for when two save near the same moment; `a`'s start wins. */
export function mergeStates(a: TodoState, b: TodoState): TodoState {
	const union = (x: string[], y: string[]) => [...x, ...y.filter((id) => !x.includes(id))].slice(-TODO_DONE_MAX);
	return { since: a.since, jestr: union(a.jestr, b.jestr), studio: union(a.studio, b.studio) };
}

/** PocketBase writes dates as "2026-10-11 07:00:14.000Z"; that space is not ISO. */
function instant(value: string | undefined): number {
	return value ? Date.parse(value.replace(' ', 'T')) : NaN;
}

/** The link to paste into Jestr: a Short's own address for a Short, the watch page otherwise. */
export function videoUrl(id: string, duration: number | undefined, live: boolean): string {
	return kindOf({ duration: Number(duration), live }) === 'short'
		? `https://www.youtube.com/shorts/${id}`
		: `https://www.youtube.com/watch?v=${id}`;
}

/**
 * The lines to show, oldest first — the one waiting longest on top. Uploads
 * and channel videos are joined by YouTube's video id; the stats row, when
 * the worker has read the video, supplies its length, channel and state.
 */
export function todoLines(
	stats: StatsRow[],
	uploads: UploadRow[],
	state: TodoState,
	options: { jestr: boolean }
): TodoLine[] {
	const since = Date.parse(state.since);
	const statsById = new Map(stats.filter((row) => row.video_id).map((row) => [row.video_id, row]));
	const lines = new Map<string, TodoLine & { at: number }>();

	const lineFor = (id: string, at: number, fallbackTitle?: string) => {
		const known = lines.get(id);
		if (known) return known;
		const stat = statsById.get(id);
		const live = Boolean(stat?.data?.liveStreamingDetails && Object.keys(stat.data.liveStreamingDetails).length);
		const publishAt = stat?.privacy === 'private' ? (stat.data?.status?.publishAt ?? '') : '';
		const line = {
			id,
			title: stat?.title || fallbackTitle || id,
			channel: stat?.data?.snippet?.channelTitle ?? '',
			watchUrl: videoUrl(id, stat?.duration, live),
			studioUrl: studioUrl(id),
			studio: [] as string[],
			jestr: null as TodoLine['jestr'],
			publicAt: publishAt || null,
			paid: stat ? stat.data?.paidProductPlacementDetails?.hasPaidProductPlacement === true : null,
			thumb: stat?.data?.snippet?.thumbnails?.medium?.url ?? '',
			thumbLarge: stat?.data?.snippet?.thumbnails?.maxres?.url ?? stat?.data?.snippet?.thumbnails?.medium?.url ?? '',
			short: Boolean(stat) && kindOf({ duration: Number(stat?.duration), live }) === 'short',
			waiting: null as string | null,
			at
		};
		lines.set(id, line);
		return line;
	};

	for (const upload of uploads) {
		const id = videoIdOf(upload.remote_url);
		const created = instant(upload.created);
		if (!(created >= since)) continue;
		if (!id) {
			if (upload.status !== 'pending' && upload.status !== 'publishing') continue;
			const key = `upload:${upload.id}`;
			lines.set(key, {
				id: key,
				title: upload.title || 'YouTube upload',
				channel: '',
				watchUrl: '',
				studioUrl: '',
				studio: [],
				jestr: null,
				publicAt: null,
				paid: null,
				thumb: '',
				thumbLarge: '',
				short: false,
				waiting: upload.status === 'publishing' ? WAITING.uploading : WAITING.queued,
				at: created
			});
			continue;
		}
		// On YouTube, but not read by the stats pass yet: Jestr's part cannot be
		// known until it is, so the line waits rather than vanishing meanwhile.
		if (options.jestr && !statsById.has(id) && !state.jestr.includes(id)) {
			lineFor(id, created, upload.title).waiting = WAITING.listing;
		}
		if (state.studio.includes(id)) continue;
		const stat = statsById.get(id);
		lineFor(id, Number.isFinite(instant(stat?.published_at)) ? instant(stat?.published_at) : created, upload.title).studio =
			studioTasks(stat?.duration);
	}

	if (options.jestr) {
		for (const row of stats) {
			const at = instant(row.published_at);
			if (!row.video_id || !(at >= since) || state.jestr.includes(row.video_id)) continue;
			const scheduled = row.privacy === 'private' && Boolean(row.data?.status?.publishAt);
			if (row.privacy !== 'public' && !scheduled) continue;
			lineFor(row.video_id, at).jestr = scheduled ? 'waiting' : 'open';
		}
	}

	return [...lines.values()]
		.filter((line) => line.studio.length > 0 || line.jestr !== null || line.waiting !== null)
		.sort((a, b) => a.at - b.at)
		.map((line): TodoLine => ({
			id: line.id,
			title: line.title,
			channel: line.channel,
			watchUrl: line.watchUrl,
			studioUrl: line.studioUrl,
			studio: line.studio,
			jestr: line.jestr,
			publicAt: line.publicAt,
			paid: line.paid,
			thumb: line.thumb,
			thumbLarge: line.thumbLarge,
			short: line.short,
			waiting: line.waiting
		}));
}
