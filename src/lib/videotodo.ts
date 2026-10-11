import { kindOf } from './videokind';
import { studioTasks, studioUrl, videoIdOf } from './studio';

/**
 * The sidebar's "To finish" list: a line per YouTube video with something
 * left to do by hand, each with a YouTube icon that opens the video's edit
 * page in Studio.
 *
 * - Studio: a flock upload whose paid promotion or Short's cover YouTube's
 *   API cannot set (studio.ts). Opening it through the icon counts as done.
 * - Jestr, only with `general.jestrIntegration` on: every video gone public
 *   on a connected channel — through flock or not — until its Jestr button
 *   says it is linked on jestr.gg. Jestr has no API (checked 11 Oct 2026: no
 *   docs, keys or webhooks, and its terms forbid scraping), so the press is
 *   the whole record. A scheduled video is listed with the button greyed
 *   until it goes public; a link cannot be submitted before.
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
		snippet?: { channelTitle?: string };
		status?: { publishAt?: string };
		liveStreamingDetails?: Record<string, unknown>;
	};
}

export const STATS_FIELDS =
	'video_id,title,published_at,duration,privacy,data.snippet.channelTitle,data.status.publishAt,data.liveStreamingDetails';

/** A flock YouTube upload (`upload_targets` row) with only what the list reads. */
export interface UploadRow {
	id: string;
	title?: string;
	remote_url?: string;
	created?: string;
	options?: { paidPromotion?: boolean };
	expand?: { job?: { thumbnail?: string } };
}

export const UPLOAD_FIELDS = 'id,title,remote_url,created,options.paidPromotion,expand.job.thumbnail';

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
			at
		};
		lines.set(id, line);
		return line;
	};

	for (const upload of uploads) {
		const id = videoIdOf(upload.remote_url);
		const created = instant(upload.created);
		if (!id || !(created >= since) || state.studio.includes(id)) continue;
		const tasks = studioTasks(
			Boolean(upload.options?.paidPromotion),
			Boolean(upload.expand?.job?.thumbnail),
			statsById.get(id)?.duration
		);
		if (tasks.length === 0) continue;
		const stat = statsById.get(id);
		lineFor(id, Number.isFinite(instant(stat?.published_at)) ? instant(stat?.published_at) : created, upload.title).studio =
			tasks;
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
		.filter((line) => line.studio.length > 0 || line.jestr !== null)
		.sort((a, b) => a.at - b.at)
		.map((line): TodoLine => ({
			id: line.id,
			title: line.title,
			channel: line.channel,
			watchUrl: line.watchUrl,
			studioUrl: line.studioUrl,
			studio: line.studio,
			jestr: line.jestr,
			publicAt: line.publicAt
		}));
}
