import type { PlatformId } from './types';

/**
 * Posts as the dashboard and the To finish panel read them. The
 * dashboard's own arithmetic is releases.ts.
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
	/** The job's product name as stored (the game); '' for none. */
	product?: string;
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
