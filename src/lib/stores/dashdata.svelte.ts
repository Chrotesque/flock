import {
	getSetting,
	getStatsStatus,
	loadDashboardReels,
	loadDashboardVideos,
	loadDashTargets,
	type DashboardReel,
	type DashboardVideo
} from '../repo';
import type { DashTarget } from '../dashboard';
import type { StatsStatus } from '../types';

/** The Instagram stats pass's heartbeat (worker/igstats.mjs). */
export interface IgStatsStatus {
	polledAt?: string;
	accounts?: Record<string, { polledAt?: string; posts?: number; error?: string }>;
}

/** The Facebook stats pass's heartbeat (worker/fbstats.mjs); `views` says why a Page's views are not read. */
export interface FbStatsStatus {
	polledAt?: string;
	pages?: Record<string, { name?: string; polledAt?: string; posts?: number; error?: string; views?: string }>;
}

/**
 * What the dashboard reads, kept between openings: it opens on the last
 * numbers at once and reads fresh ones straight away (Dashboard.svelte, which
 * also keeps them current through realtime while open), so it never opens
 * empty and never stale for long. Nothing is read while it is closed.
 */
class DashData {
	videos = $state<DashboardVideo[]>([]);
	reels = $state<DashboardReel[]>([]);
	targets = $state<(DashTarget & { brand: string })[]>([]);
	status = $state<StatsStatus | null>(null);
	igStatus = $state<IgStatsStatus | null>(null);
	fbStatus = $state<FbStatsStatus | null>(null);
	loaded = $state(false);
	loading = $state(false);
	error = $state('');

	#running: Promise<void> | null = null;

	/** One read at a time; asking again meanwhile waits for the one running. */
	refresh(): Promise<void> {
		this.#running ??= this.#read().finally(() => (this.#running = null));
		return this.#running;
	}

	async #read() {
		this.loading = true;
		try {
			const [videos, reels, targets, status, igStatus, fbStatus] = await Promise.all([
				loadDashboardVideos(),
				loadDashboardReels(),
				loadDashTargets(),
				getStatsStatus().catch(() => null),
				getSetting<IgStatsStatus | null>('instagram_stats_status', null).catch(() => null),
				getSetting<FbStatsStatus | null>('facebook_stats_status', null).catch(() => null)
			]);
			this.videos = videos;
			this.reels = reels;
			this.targets = targets;
			this.status = status;
			this.igStatus = igStatus;
			this.fbStatus = fbStatus;
			this.error = '';
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loaded = true;
			this.loading = false;
		}
	}

	/** A row realtime sent: replaced in place, added when new, dropped when deleted. */
	putVideo(video: DashboardVideo, action: string) {
		this.videos = upsert(this.videos, video, action);
	}

	putReel(reel: DashboardReel, action: string) {
		this.reels = upsert(this.reels, reel, action);
	}

	async refreshTargets() {
		this.targets = await loadDashTargets().catch(() => this.targets);
	}
}

function upsert<T extends { id: string }>(list: T[], row: T, action: string): T[] {
	if (action === 'delete') return list.filter((x) => x.id !== row.id);
	return list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];
}

export const dashData = new DashData();
