import { kindOf } from './videokind';

/**
 * Jestr reminders: every video that has gone public on a connected YouTube
 * channel since the list began — through flock or not — stays in the
 * sidebar until it is marked as linked on Jestr. Jestr has no API (checked
 * 11 Oct 2026: no docs, keys or webhooks, and its terms forbid scraping), so
 * flock can neither see a link nor make one; the press of the button is the
 * whole record.
 *
 * Stored in `app_settings` under `jestr` as { since, done }: `since` is when
 * the list began, so a new install or a newly connected channel does not
 * flood it with every video it already had; `done` the video ids marked.
 */
export interface JestrState {
	since: string;
	done: string[];
}

/** A `video_stats` row with only the fields the list reads. */
export interface JestrRow {
	video_id: string;
	title?: string;
	published_at?: string;
	duration?: number;
	data?: {
		snippet?: { channelTitle?: string };
		liveStreamingDetails?: Record<string, unknown>;
	};
}

export interface JestrVideo {
	id: string;
	title: string;
	channel: string;
	publishedAt: string;
	url: string;
}

/** The `app_settings` key the state lives under. */
export const JESTR_KEY = 'jestr';

/** What the list asks PocketBase for — a few hundred bytes a video. */
export const JESTR_FIELDS =
	'video_id,title,published_at,duration,data.snippet.channelTitle,data.liveStreamingDetails';

/** Marked ids kept, newest last; at a few videos a day this is years. */
export const JESTR_DONE_MAX = 2000;

/** Local midnight of the given day, as an instant: where a fresh list begins. */
export function startOfDay(now: Date): string {
	const day = new Date(now);
	day.setHours(0, 0, 0, 0);
	return day.toISOString();
}

/** A stored row read field by field; anything unusable falls back. */
export function readJestrState(value: unknown, fallbackSince: string): JestrState {
	const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	const since =
		typeof v.since === 'string' && Number.isFinite(Date.parse(v.since)) ? v.since : fallbackSince;
	const done = Array.isArray(v.done) ? v.done.filter((id): id is string => typeof id === 'string') : [];
	return { since, done };
}

/** The state with one more video marked, each id once, the oldest dropped past the cap. */
export function markDone(state: JestrState, id: string): JestrState {
	const done = [...state.done.filter((d) => d !== id), id];
	return { since: state.since, done: done.slice(-JESTR_DONE_MAX) };
}

/** Both browsers' marks, for when two save near the same moment. */
export function mergeDone(a: JestrState, b: JestrState): JestrState {
	const done = [...a.done, ...b.done.filter((id) => !a.done.includes(id))];
	return { since: a.since, done: done.slice(-JESTR_DONE_MAX) };
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
 * The videos still to link, oldest first — the one waiting longest on top.
 * The rows are already public and after `since` by the query; the date is
 * checked again so a stale row cannot slip in.
 */
export function pendingVideos(rows: JestrRow[], state: JestrState): JestrVideo[] {
	const since = Date.parse(state.since);
	const done = new Set(state.done);
	return rows
		.filter((row) => row.video_id && !done.has(row.video_id) && instant(row.published_at) >= since)
		.sort((a, b) => instant(a.published_at) - instant(b.published_at))
		.map((row) => ({
			id: row.video_id,
			title: row.title || row.video_id,
			channel: row.data?.snippet?.channelTitle ?? '',
			publishedAt: (row.published_at ?? '').replace(' ', 'T'),
			url: videoUrl(
				row.video_id,
				row.duration,
				Boolean(row.data?.liveStreamingDetails && Object.keys(row.data.liveStreamingDetails).length)
			)
		}));
}
