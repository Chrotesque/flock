import { brandReleases, CELEBRATING, celebrationsOf, type Celebration } from '../celebrate';
import { PLATFORMS } from '../platforms';
import { follows } from '../todobrands';
import { accounts } from './accounts.svelte';
import { attention } from './attention.svelte';
import { brands } from './brands.svelte';
import { dashData } from './dashdata.svelte';
import { general } from './general.svelte';
import { hiddenVideos } from './hiddenvideos.svelte';

const POLL_MS = 120_000;

/**
 * The gold rows of To finish (celebrate.ts): the followed brands' posts doing
 * at least half as much again as usual. Read from the Dashboard's numbers
 * (dashdata.svelte.ts), and only while the panel is open — they are many
 * rows with their histories, too much to read every minute for the sidebar
 * box, which they do not count in. Taken off with the dismissed keys To
 * finish keeps (attention.svelte.ts).
 */
class Celebrations {
	#now = $state(Date.now());
	/** The hidden marks are in, so no hidden test is celebrated while they load. */
	#hiddenRead = $state(false);

	items = $derived.by((): Celebration[] => {
		if (!CELEBRATING) return [];
		if (!dashData.loaded || !accounts.loaded || !this.#hiddenRead || brands.list.length === 0) return [];
		// Which brands are followed is in the settings: until they are read, or
		// when they cannot be, nobody is celebrated rather than every brand.
		if (general.loading || general.error) return [];
		const gone = new Set(attention.dismissed);
		const chosen = general.value.todoBrands;
		const all = brands.ordered;
		return all
			.filter((brand) => follows(chosen, brand.id))
			.flatMap((brand) =>
				celebrationsOf(brandReleases(brand, all, accounts.list, dashData, hiddenVideos.marks), brand.id, this.#now)
			)
			.filter((c) => !gone.has(c.key))
			.sort((a, b) => b.percent - a.percent);
	});

	/** While the panel is open: read now, then every two minutes and on focus. Returns the stop. */
	start(): () => void {
		if (!CELEBRATING) return () => {};
		void accounts.load();
		void hiddenVideos
			.load()
			.catch(() => {})
			.finally(() => (this.#hiddenRead = true));
		const read = () => {
			this.#now = Date.now();
			void dashData.refresh();
		};
		read();
		const timer = setInterval(read, POLL_MS);
		const clock = setInterval(() => (this.#now = Date.now()), 30_000);
		window.addEventListener('focus', read);
		return () => {
			clearInterval(timer);
			clearInterval(clock);
			window.removeEventListener('focus', read);
		};
	}

	dismiss(c: Celebration): Promise<void> {
		const text = `${PLATFORMS[c.platform].label}: "${c.title}" ${c.percent}% better performance than usual`;
		return attention.dismissKey(c.key, text, `${c.views} views against a usual ${Math.round(c.usual)}`, c.job);
	}
}

export const celebrations = new Celebrations();
