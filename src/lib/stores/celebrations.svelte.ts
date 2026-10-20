import { brandReleases, CELEBRATING, celebrationsOf, type Celebration, type PostRows } from '../celebrate';
import { loadDashboardReels, loadDashboardVideos, loadDashTargets } from '../repo';
import { follows } from '../todobrands';
import { accounts } from './accounts.svelte';
import { attention } from './attention.svelte';
import { brands } from './brands.svelte';
import { general } from './general.svelte';
import { hiddenVideos } from './hiddenvideos.svelte';

/** Every five minutes: a submission crosses its bar over hours, not seconds. */
const POLL_MS = 5 * 60_000;
/** The posts pairing needs: the bar's 30 days and a day's margin. */
const WINDOW_MS = 31 * 24 * 3_600_000;

/**
 * The submissions To finish celebrates (celebrate.ts): a gold row in the
 * panel and the gold box in the sidebar. Read while the panel is closed too,
 * for the box — but only the counters, not their histories, every five
 * minutes, on focus and when the panel opens. Only the brands To finish
 * follows; taken off with the dismissed keys To finish keeps
 * (attention.svelte.ts).
 */
class Celebrations {
	#rows = $state<PostRows | null>(null);
	#now = $state(Date.now());
	/** The hidden marks are in, so no hidden test is counted while they load. */
	#hiddenRead = $state(false);

	items = $derived.by((): Celebration[] => {
		if (!CELEBRATING || !this.#rows || !accounts.loaded || !this.#hiddenRead) return [];
		if (brands.loading || brands.list.length === 0) return [];
		// Which brands are followed is in the settings: until they are read, or
		// when they cannot be, nobody is celebrated rather than every brand.
		if (general.loading || general.error) return [];
		const rows = this.#rows;
		const gone = new Set(attention.dismissed);
		const chosen = general.value.todoBrands;
		const all = brands.ordered;
		return all
			.filter((brand) => follows(chosen, brand.id))
			.flatMap((brand) => celebrationsOf(brandReleases(brand, all, accounts.list, rows, hiddenVideos.marks), brand.id, this.#now))
			.filter((c) => !gone.has(c.key))
			.sort((a, b) => b.percent - a.percent);
	});

	#busy = false;

	/** From the layout, for as long as the app is open. Returns the stop. */
	start(): () => void {
		if (!CELEBRATING) return () => {};
		void brands.load();
		void accounts.load();
		void hiddenVideos
			.load()
			.catch(() => {})
			.finally(() => (this.#hiddenRead = true));
		void this.refresh();
		const timer = setInterval(() => void this.refresh(), POLL_MS);
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onFocus);
		};
	}

	async refresh(): Promise<void> {
		if (!CELEBRATING || this.#busy) return;
		this.#busy = true;
		try {
			const [videos, reels, targets] = await Promise.all([
				loadDashboardVideos({ history: false }),
				loadDashboardReels({ history: false }),
				loadDashTargets(new Date(Date.now() - WINDOW_MS))
			]);
			this.#rows = { videos, reels, targets };
			this.#now = Date.now();
		} catch {
			// Unreachable PocketBase: what was read last stays until the next read.
		} finally {
			this.#busy = false;
		}
	}

	dismiss(c: Celebration): Promise<void> {
		const text = `"${c.title}" ${c.percent}% better performance than usual`;
		return attention.dismissKey(c.key, text, `${c.combined} views on YouTube, Instagram and TikTok against a bar of ${Math.round(c.bar)}`, c.job);
	}
}

export const celebrations = new Celebrations();
