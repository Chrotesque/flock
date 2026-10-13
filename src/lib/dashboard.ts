import { addDays, dayStart, startOfWeek } from './format';
import type { PlatformId } from './types';

/**
 * The dashboard's arithmetic, apart from the screen so it can be tested.
 * Everything is for one YouTube channel — the brand in view's — because
 * YouTube's policies forbid adding numbers up across channels.
 */

/** A `video_stats` row as the dashboard reads it. `history` holds `[iso, views, likes, comments]`. */
export interface StatsVideo {
	video_id: string;
	title: string;
	published_at: string;
	privacy: string;
	views: number | null;
	duration: number;
	history: [string, number | null, number | null, number | null][];
}

const time = (iso: string) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/* ---- the big numbers ---- */

export type PeriodKey = 'today' | 'week' | 'month';

export interface Period {
	key: PeriodKey;
	label: string;
	from: Date;
}

/** Today from midnight, this week from Monday, this month from the 1st — local time. */
export function periods(now: Date): Period[] {
	return [
		{ key: 'today', label: 'Today', from: dayStart(now) },
		{ key: 'week', label: 'This week', from: startOfWeek(now) },
		{ key: 'month', label: 'This month', from: new Date(now.getFullYear(), now.getMonth(), 1) }
	];
}

/**
 * A video's view count at a moment, from its samples: the last one taken at
 * or before it (a sample is written only when a counter moves, so the
 * count held from there). 0 before the video was out; null when flock was
 * not watching yet — the first sample is later than the moment.
 */
export function viewsAt(video: StatsVideo, at: number): number | null {
	if (time(video.published_at) > at) return 0;
	let found: number | null = null;
	for (const [iso, views] of video.history ?? []) {
		if (time(iso) > at) break;
		if (views !== null) found = views;
	}
	return found;
}

export interface PeriodTotals {
	/** Public videos that went out in the period. */
	released: number;
	/** The views those videos have now. */
	viewsOnReleased: number;
	/** Views every watched video gained in the period. */
	gained: number;
	/** Some video's count at the start was not known, so `gained` counts from its first sample. */
	gainedPartly: boolean;
}

export function periodTotals(videos: StatsVideo[], from: Date, now: Date): PeriodTotals {
	const start = from.getTime();
	const end = now.getTime();
	let released = 0;
	let viewsOnReleased = 0;
	let gained = 0;
	let gainedPartly = false;
	for (const video of videos) {
		const out = time(video.published_at);
		const views = video.views ?? 0;
		if (video.privacy === 'public' && out >= start && out <= end) {
			released++;
			viewsOnReleased += views;
		}
		let before = viewsAt(video, start);
		if (before === null) {
			gainedPartly = true;
			before = video.history?.find((sample) => sample[1] !== null)?.[1] ?? views;
		}
		gained += Math.max(0, views - before);
	}
	return { released, viewsOnReleased, gained, gainedPartly };
}

/** Posts flock published in the period, per platform: Instagram and TikTok, whose views flock cannot read. */
export function postsPerPlatform(
	targets: DashTarget[],
	from: Date,
	now: Date,
	platforms: PlatformId[]
): Partial<Record<PlatformId, number>> {
	const out: Partial<Record<PlatformId, number>> = {};
	for (const target of targets) {
		if (!platforms.includes(target.platform) || target.status !== 'published') continue;
		const at = time(target.published_at || target.scheduled_at);
		if (at >= from.getTime() && at <= now.getTime()) out[target.platform] = (out[target.platform] ?? 0) + 1;
	}
	return out;
}

/* ---- posts ---- */

/**
 * An `upload_targets` row with what the dashboard reads of its job. What
 * needs attention about them is attention.ts, shown in the To finish panel.
 */
export interface DashTarget {
	id: string;
	job: string;
	platform: PlatformId;
	status: string;
	scheduled_at: string;
	published_at?: string;
	error?: string;
	remote_url?: string;
	title: string;
	/** YouTube's visibility, TikTok's audience; '' when not set. */
	visibility: string;
	jobTitle: string;
	jobCreated: string;
	/** The job's local pick is not on the NAS yet. */
	importing: boolean;
	jobError: string;
	/** The job's brand id. */
	brand?: string;
	/** The `accounts.account_id` it goes out as; '' for the platform's only account. */
	account?: string;
	/** When the row last changed. */
	updated?: string;
}

const MIN = 60_000;

/** "12 min", "3 h", "2 days" — how long something has been the case. */
export function ago(ms: number): string {
	const minutes = Math.max(1, Math.round(ms / MIN));
	if (minutes < 90) return `${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h`;
	return `${Math.round(hours / 24)} days`;
}

/* ---- coming up ---- */

export interface UpcomingDay {
	date: Date;
	posts: DashTarget[];
}

/** The next `days` days from today, each with its posts still to go out, in slot order; empty days kept. */
export function upcoming(targets: DashTarget[], now: Date, days = 7): UpcomingDay[] {
	const first = dayStart(now);
	const out: UpcomingDay[] = Array.from({ length: days }, (_, i) => ({ date: addDays(first, i), posts: [] }));
	const end = addDays(first, days).getTime();
	for (const t of targets) {
		if (!['pending', 'publishing', 'scheduled'].includes(t.status)) continue;
		const slot = time(t.scheduled_at);
		if (!(slot >= now.getTime() && slot < end)) continue;
		const index = Math.floor((dayStart(new Date(slot)).getTime() - first.getTime()) / (24 * 60 * MIN) + 0.5);
		out[Math.min(Math.max(index, 0), days - 1)].posts.push(t);
	}
	for (const day of out) day.posts.sort((a, b) => time(a.scheduled_at) - time(b.scheduled_at));
	return out;
}

/* ---- latest releases ---- */

export interface Release<V extends StatsVideo = StatsVideo> {
	video: V;
	/** How long it has been out, ms. */
	age: number;
	/** The channel's typical views at that same age, over the videos flock watched from release; null without enough of them. */
	usual: number | null;
	verdict: 'ahead' | 'behind' | 'usual' | null;
	/** Views over its first 48 hours (or its age, if younger), for a sparkline: [ms since release, views]. */
	points: [number, number][];
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The newest public videos, each set against how the channel's videos
 * usually stood at the same age — only videos flock watched from their
 * release count towards "usual", and at least three of them, or there is
 * no verdict. Ahead or behind means more than a fifth off.
 */
export function latestReleases<V extends StatsVideo>(videos: V[], now: Date, count = 5): Release<V>[] {
	const at = now.getTime();
	const shown = videos
		.filter((v) => v.privacy === 'public' && time(v.published_at) <= at)
		.sort((a, b) => time(b.published_at) - time(a.published_at));
	return shown.slice(0, count).map((video) => {
		const out = time(video.published_at);
		const age = at - out;
		const peers = shown
			.filter((other) => other !== video && at - time(other.published_at) >= age)
			.map((other) => {
				const first = other.history?.[0];
				// Watched from release: the first sample is from before it, or within the hour.
				if (!first || time(first[0]) > time(other.published_at) + 60 * MIN) return null;
				return viewsAt(other, time(other.published_at) + age);
			})
			.filter((v): v is number => v !== null);
		const usual = peers.length >= 3 ? median(peers) : null;
		const views = video.views ?? 0;
		const verdict =
			usual === null || usual === 0 ? null : views > usual * 1.2 ? 'ahead' : views < usual * 0.8 ? 'behind' : 'usual';
		const span = Math.min(age, 48 * 60 * MIN);
		const points: [number, number][] = [[0, 0]];
		for (const [iso, count] of video.history ?? []) {
			const t = time(iso) - out;
			if (t > 0 && t <= span && count !== null) points.push([t, count]);
		}
		points.push([span, viewsAt(video, out + span) ?? views]);
		return { video, age, usual, verdict, points };
	});
}
