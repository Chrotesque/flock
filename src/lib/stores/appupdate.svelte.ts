import { base } from '$app/paths';
import { dev, version } from '$app/environment';
import { newChanges, updateFrom, type Update } from '../appupdate';
import { CHANGES, VERSION, type Change } from '../version';

/** How often an open page asks whether a newer flock is deployed, besides whenever it comes back into view. */
const EVERY_MS = 5 * 60_000;

/**
 * Whether a newer flock is deployed than this page runs (appupdate.ts): the
 * sidebar's "Update available!" box, which reloads the page and says what
 * changed (`changes`, read from the deployed `whatsnew.json`). `uploading` is
 * set by the Upload page while a video is going up, since a reload would cut
 * it off.
 */
class AppUpdate {
	available = $state<Update | null>(null);
	changes = $state<Change[]>([]);
	uploading = $state(false);
	#checking = false;

	async check(): Promise<void> {
		// The dev server serves no version.json: nothing to compare with.
		if (dev || this.#checking) return;
		this.#checking = true;
		try {
			const res = await fetch(`${base}/_app/version.json`, { cache: 'no-store' });
			if (!res.ok) return;
			const update = updateFrom(version, await res.json());
			// Only a build from 0.18.10 on has the file; an older one says nothing.
			const news = update ? await fetch(`${base}/whatsnew.json`, { cache: 'no-store' }) : null;
			this.changes = news?.ok ? newChanges(VERSION, CHANGES, await news.json().catch(() => null)) : [];
			this.available = update;
		} catch {
			// Offline, or PocketBase away: asked again at the next turn.
		} finally {
			this.#checking = false;
		}
	}

	start(): () => void {
		void this.check();
		const timer = setInterval(() => void this.check(), EVERY_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void this.check();
		};
		window.addEventListener('focus', onVisible);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onVisible);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}
}

export const appUpdate = new AppUpdate();
