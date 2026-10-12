import {
	getStatsStatus,
	isUsed,
	loadDashTargets,
	loadDashVideos,
	loadLocalIndex,
	loadUsedSources,
	loadWatchIndex,
	type DashVideo
} from '../repo';
import type { DashTarget } from '../dashboard';
import type { StatsStatus } from '../types';

/**
 * What the dashboard reads, kept between openings: it opens on the last
 * numbers at once and reads fresh ones straight away (and every 30 s while
 * open — Dashboard.svelte), so it never opens empty and never stale for
 * long. Nothing is read while it is closed.
 */
class DashData {
	videos = $state<DashVideo[]>([]);
	targets = $state<(DashTarget & { brand: string })[]>([]);
	status = $state<StatsStatus | null>(null);
	/** Watch-folder files no upload has used; null until counted. */
	unused = $state<number | null>(null);
	loadedAt = $state<Date | null>(null);
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
			const [videos, targets, status] = await Promise.all([
				loadDashVideos(),
				loadDashTargets(),
				getStatsStatus().catch(() => null)
			]);
			this.videos = videos;
			this.targets = targets;
			this.status = status;
			this.error = '';
			this.loadedAt = new Date();
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
		void this.#countUnused();
	}

	/** The same test the Upload page hides used files by. */
	async #countUnused() {
		const [nas, local, used] = await Promise.all([
			loadWatchIndex().catch(() => null),
			loadLocalIndex().catch(() => null),
			loadUsedSources().catch(() => null)
		]);
		if (!used) return;
		this.unused = [...(nas?.files ?? []), ...(local?.files ?? [])].filter((file) => !isUsed(used, file)).length;
	}
}

export const dashData = new DashData();
