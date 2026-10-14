import { addDays, dayStart } from './format';
import type { PlatformId } from './types';

/**
 * Posts as the dashboard and the To finish panel read them, and what is
 * coming up. The dashboard's own arithmetic is releases.ts.
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
	/** Ticked as a Jestr campaign at upload (jestrcampaign.ts). */
	jestr?: boolean;
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
