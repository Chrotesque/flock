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
 * - Instagram: the same upload's reel, for its Paid partnership label,
 *   which only the Instagram app sets — Meta's API took the label and
 *   never showed it (tested 20 Oct 2026), so since v0.16.62 flock does
 *   not offer it and lists the reel here instead: every reel going out
 *   from `instagramSince` on, whenever it was confirmed. Opening the reel
 *   through its icon counts as done; a reel not out yet waits, greyed. A
 *   reel is joined to its line by the upload job.
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
 * `video_todo` as { since, jestr, studio, instagram, instagramSince }:
 * `since` is where the list began, so a new install or a newly connected
 * channel does not list everything it already had, and `instagramSince` the
 * same for the reels, by when each goes out; `jestr` and `studio` are the YouTube video ids done
 * for each, `instagram` the reels' `upload_targets` ids.
 */
export interface TodoState {
	since: string;
	jestr: string[];
	studio: string[];
	instagram: string[];
	instagramSince: string;
}

export type TodoKind = 'jestr' | 'studio' | 'instagram';

export const TODO_KEY = 'video_todo';
/** Where v0.9.12's Jestr-only list kept { since, done }; adopted once. */
export const LEGACY_JESTR_KEY = 'jestr';

/**
 * Where the reels begin for a list started before they were listed: local
 * midnight, Berlin, of 20 Oct 2026, the day the label went to To finish
 * (v0.16.62). A list started later begins its reels where it begins.
 */
export const REELS_LISTED_FROM = '2026-10-19T22:00:00.000Z';

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
		snippet?: {
			channelId?: string;
			channelTitle?: string;
			thumbnails?: { medium?: { url?: string }; maxres?: { url?: string } };
		};
		status?: { publishAt?: string };
		liveStreamingDetails?: Record<string, unknown>;
		paidProductPlacementDetails?: { hasPaidProductPlacement?: boolean };
	};
}

export const STATS_FIELDS =
	'video_id,title,published_at,duration,privacy,data.snippet.channelId,data.snippet.channelTitle,data.status.publishAt,data.liveStreamingDetails,data.paidProductPlacementDetails.hasPaidProductPlacement,data.snippet.thumbnails.medium.url,data.snippet.thumbnails.maxres.url';

/** A flock YouTube upload (`upload_targets` row) with only what the list reads. */
export interface UploadRow {
	id: string;
	/** The upload job, which its Instagram reel shares. */
	job?: string;
	/** The channel it goes out on; '' for the only one. */
	account?: string;
	title?: string;
	remote_url?: string;
	/** `pending` (queued) and `publishing` (uploading) are the waiting ones. */
	status?: string;
	created?: string;
}

export const UPLOAD_FIELDS = 'id,job,account,title,remote_url,status,created';

/** A flock Instagram reel (`upload_targets` row) with only what the list reads. */
export interface TodoReelRow {
	id: string;
	job?: string;
	/** The reel's permalink once it is out. */
	remote_url?: string;
	status?: string;
	scheduled_at?: string;
	/** When it went out; '' until then. */
	published_at?: string;
	created?: string;
}

export const REEL_FIELDS = 'id,job,remote_url,status,scheduled_at,published_at,created';

/** What a line's reel is left for. */
export const INSTAGRAM_STEP = 'Paid partnership label';

/** A line's Instagram reel and its label. */
export interface InstagramStep {
	/** `open` to add the label now, `waiting` until the reel is out, `done` once opened through here. */
	state: 'open' | 'waiting' | 'done';
	/** Its `upload_targets` id, which marking it done records. */
	target: string;
	/** The reel on Instagram; '' while it waits. */
	url: string;
	/** When it goes out, while it waits; null when not known. */
	at: string | null;
}

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
	/** The YouTube channel's id, which says whose brand the line is (todobrands.ts); '' while not known. */
	channelId: string;
	/** Where the title leads: a Short's own address, the watch page otherwise. */
	watchUrl: string;
	studioUrl: string;
	/** What is left to set in Studio; empty when the icon is only a way there. */
	studio: string[];
	/** `open` to link now, `waiting` until it goes public, null when not asked or done. */
	jestr: 'open' | 'waiting' | null;
	/** The same upload's Instagram reel and its label; null when it has none listed. */
	instagram: InstagramStep | null;
	/** When a scheduled video goes public; null once it is (or when not known). */
	publicAt: string | null;
	/** When it went public; null while it is scheduled, private or not read yet. */
	releasedAt: string | null;
	/** YouTube's visibility (public, private, unlisted); '' until the stats pass has read it. */
	privacy: string;
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
 * (`{ since, done }`) is adopted, so its start and its marks carry over. A
 * row from before the reels were listed starts them at REELS_LISTED_FROM,
 * which is then written down (`isComplete`); a new list at its own start.
 */
export function readTodoState(value: unknown, legacy: unknown, fallbackSince: string): TodoState {
	const v = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null;
	if (v) {
		return {
			since: validDate(v.since) ? v.since : fallbackSince,
			jestr: ids(v.jestr),
			studio: ids(v.studio),
			instagram: ids(v.instagram),
			instagramSince: validDate(v.instagramSince) ? v.instagramSince : REELS_LISTED_FROM
		};
	}
	const old = (legacy && typeof legacy === 'object' ? legacy : {}) as Record<string, unknown>;
	const since = validDate(old.since) ? old.since : fallbackSince;
	return {
		since,
		jestr: ids(old.done),
		studio: [],
		instagram: [],
		instagramSince: validDate(old.since) ? REELS_LISTED_FROM : since
	};
}

/** Whether a stored row has both starts written down, so neither moves with the date. */
export function isComplete(value: unknown): boolean {
	const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return validDate(v.since) && validDate(v.instagramSince);
}

/** The state with one more video done for a kind, each id once, the oldest dropped past the cap. */
export function markDone(state: TodoState, kind: TodoKind, id: string): TodoState {
	const done = [...state[kind].filter((d) => d !== id), id].slice(-TODO_DONE_MAX);
	return { ...state, [kind]: done };
}

/** Both browsers' marks, for when two save near the same moment; `a`'s starts win. */
export function mergeStates(a: TodoState, b: TodoState): TodoState {
	const union = (x: string[], y: string[]) => [...x, ...y.filter((id) => !x.includes(id))].slice(-TODO_DONE_MAX);
	return {
		since: a.since,
		jestr: union(a.jestr, b.jestr),
		studio: union(a.studio, b.studio),
		instagram: union(a.instagram, b.instagram),
		instagramSince: a.instagramSince
	};
}

/** PocketBase writes dates as "2026-10-11 07:00:14.000Z"; that space is not ISO. */
function instant(value: string | undefined): number {
	return value ? Date.parse(value.replace(' ', 'T')) : NaN;
}

/**
 * The reel's step: open once it is out, waiting until then, done once
 * opened; none when it failed, or went out before the reels were listed.
 */
function instagramStep(reel: TodoReelRow, state: TodoState): InstagramStep | null {
	const published = instant(reel.published_at);
	const out = Number.isFinite(published) ? published : instant(reel.scheduled_at);
	if (!(out >= Date.parse(state.instagramSince))) return null;
	if (reel.remote_url) {
		return { state: state.instagram.includes(reel.id) ? 'done' : 'open', target: reel.id, url: reel.remote_url, at: null };
	}
	if (reel.status === 'pending' || reel.status === 'publishing') {
		return { state: 'waiting', target: reel.id, url: '', at: reel.scheduled_at || null };
	}
	return null;
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
 * A reel joins the YouTube upload of the same job.
 */
export function todoLines(
	stats: StatsRow[],
	uploads: UploadRow[],
	state: TodoState,
	options: { jestr: boolean },
	reels: TodoReelRow[] = []
): TodoLine[] {
	const since = Date.parse(state.since);
	const statsById = new Map(stats.filter((row) => row.video_id).map((row) => [row.video_id, row]));
	const reelByJob = new Map<string, TodoReelRow>();
	for (const reel of reels) if (reel.job && !reelByJob.has(reel.job)) reelByJob.set(reel.job, reel);
	const lines = new Map<string, TodoLine & { at: number }>();

	const lineFor = (id: string, at: number, fallbackTitle?: string, fallbackChannel?: string) => {
		const known = lines.get(id);
		if (known) return known;
		const stat = statsById.get(id);
		const live = Boolean(stat?.data?.liveStreamingDetails && Object.keys(stat.data.liveStreamingDetails).length);
		const publishAt = stat?.privacy === 'private' ? (stat.data?.status?.publishAt ?? '') : '';
		const line = {
			id,
			title: stat?.title || fallbackTitle || id,
			channel: stat?.data?.snippet?.channelTitle ?? '',
			channelId: stat?.data?.snippet?.channelId || fallbackChannel || '',
			watchUrl: videoUrl(id, stat?.duration, live),
			studioUrl: studioUrl(id),
			studio: [] as string[],
			jestr: null as TodoLine['jestr'],
			instagram: null as InstagramStep | null,
			publicAt: publishAt || null,
			releasedAt: stat?.privacy === 'public' && stat.published_at ? stat.published_at : null,
			privacy: stat?.privacy ?? '',
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
				channelId: upload.account ?? '',
				watchUrl: '',
				studioUrl: '',
				studio: [],
				jestr: null,
				instagram: null,
				publicAt: null,
				releasedAt: null,
				privacy: '',
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
			lineFor(id, created, upload.title, upload.account).waiting = WAITING.listing;
		}
		const stat = statsById.get(id);
		const at = Number.isFinite(instant(stat?.published_at)) ? instant(stat?.published_at) : created;
		const reel = upload.job ? reelByJob.get(upload.job) : undefined;
		const step = reel ? instagramStep(reel, state) : null;
		if (step) lineFor(id, at, upload.title, upload.account).instagram = step;
		if (state.studio.includes(id)) continue;
		lineFor(id, at, upload.title, upload.account).studio = studioTasks(stat?.duration);
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
		.filter(
			(line) =>
				line.studio.length > 0 ||
				line.jestr !== null ||
				(line.instagram !== null && line.instagram.state !== 'done') ||
				line.waiting !== null
		)
		.sort((a, b) => a.at - b.at)
		.map((line): TodoLine => ({
			id: line.id,
			title: line.title,
			channel: line.channel,
			channelId: line.channelId,
			watchUrl: line.watchUrl,
			studioUrl: line.studioUrl,
			studio: line.studio,
			jestr: line.jestr,
			instagram: line.instagram,
			publicAt: line.publicAt,
			releasedAt: line.releasedAt,
			privacy: line.privacy,
			paid: line.paid,
			thumb: line.thumb,
			thumbLarge: line.thumbLarge,
			short: line.short,
			waiting: line.waiting
		}));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 40 min", "in 5 h", "in 2 days", or "40 min ago" … "3 days ago": from `now` to `at`. */
export function relativeWords(at: number, now: number): string {
	const ms = at - now;
	const abs = Math.abs(ms);
	const amount =
		abs < HOUR
			? `${Math.max(1, Math.round(abs / MINUTE))} min`
			: abs < DAY
				? `${Math.round(abs / HOUR)} h`
				: (() => {
						const days = Math.round(abs / DAY);
						return `${days} ${days === 1 ? 'day' : 'days'}`;
					})();
	return ms >= 0 ? `in ${amount}` : `${amount} ago`;
}

export interface ReleaseWhen {
	/** "Goes public", "Released", or the visibility of one never scheduled. */
	label: string;
	/** "in 2 days", "3 days ago"; '' for one never scheduled. */
	when: string;
	/** The instant it goes or went public, for the exact date on hover; '' for none. */
	at: string;
}

/**
 * The To finish list's release column: a scheduled video's "Goes public in
 * 2 days", a public one's "Released 3 days ago", a private or unlisted one
 * with no release time by its visibility alone. Null until the stats pass
 * has read the video.
 */
export function releaseWhen(line: Pick<TodoLine, 'publicAt' | 'releasedAt' | 'privacy'>, now: number): ReleaseWhen | null {
	for (const [label, iso] of [
		['Goes public', line.publicAt],
		['Released', line.releasedAt]
	] as const) {
		const at = Date.parse(String(iso ?? '').replace(' ', 'T'));
		if (Number.isFinite(at)) return { label, when: relativeWords(at, now), at: new Date(at).toISOString() };
	}
	if (line.privacy === 'private') return { label: 'Private', when: '', at: '' };
	if (line.privacy === 'unlisted') return { label: 'Unlisted', when: '', at: '' };
	return null;
}
