import { pb } from '../pb';
import { getSetting, setSetting } from '../repo';
import { logAction } from '../log';
import { PLATFORMS } from '../platforms';
import { NONE_HIDDEN, readHidden, setHidden, type HiddenPost, type HiddenPosts } from '../hiddenvideos';

/**
 * The videos hidden from the Dashboard (hiddenvideos.ts), in `app_settings`
 * / `dashboard_hidden` so every browser hides the same, and arriving live.
 * Each change is merged with the stored row just before it is written, so
 * two browsers hiding at once keep both.
 */
const KEY = 'dashboard_hidden';

class HiddenVideos {
	marks = $state<HiddenPosts>(NONE_HIDDEN);
	error = $state('');
	#loaded = false;

	async load() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.marks = readHidden(await getSetting<unknown>(KEY, null));
	}

	/** Hides these posts of a video, or shows them again; logged against its title and the platforms. Says whether it was saved. */
	async set(posts: HiddenPost[], on: boolean, title: string): Promise<boolean> {
		if (posts.length === 0) return false;
		const before = this.marks;
		this.marks = setHidden(this.marks, posts, on);
		try {
			const stored = readHidden(await getSetting<unknown>(KEY, null));
			const next = setHidden(stored, posts, on);
			await setSetting(KEY, next);
			this.marks = next;
			this.error = '';
			const where = posts.map((p) => PLATFORMS[p.platform].label).join(', ');
			logAction('upload', on ? 'Hid on the Dashboard' : 'Shown on the Dashboard again', `${title} (${where})`);
			return true;
		} catch (err) {
			this.marks = before;
			this.error = err instanceof Error ? err.message : String(err);
			return false;
		}
	}

	/** Changes made in another browser, live. Returns the unsubscribe. */
	subscribe(): () => void {
		const sub = pb.collection('app_settings').subscribe('*', (e) => {
			if (e.record.key === KEY) this.marks = readHidden(e.action === 'delete' ? null : e.record.value);
		});
		sub.catch(() => {});
		return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
	}
}

export const hiddenVideos = new HiddenVideos();
