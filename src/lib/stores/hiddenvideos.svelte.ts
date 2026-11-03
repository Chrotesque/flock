import { pb } from '../pb';
import { findSetting, getSetting, setSetting } from '../repo';
import { currentUserId, logAction } from '../log';
import { PLATFORMS } from '../platforms';
import { userSettingKey } from '../users';
import { NONE_HIDDEN, readHidden, setHidden, type HiddenPost, type HiddenPosts } from '../hiddenvideos';

/**
 * The videos hidden from the Dashboard (hiddenvideos.ts), each user's own
 * (users.ts) in `app_settings` / `dashboard_hidden:<user id>`, so every
 * browser of theirs hides the same, and arriving live. A user with no row of
 * their own yet reads the row everyone shared before users existed
 * (`dashboard_hidden`). Each change is merged with the stored row just before
 * it is written, so two browsers hiding at once keep both.
 */
const SHARED_KEY = 'dashboard_hidden';

const ownKey = () => userSettingKey('dashboard_hidden', currentUserId());

/** The marks as this browser's user reads them: their own row, else the shared one. */
async function readMarks(): Promise<{ marks: HiddenPosts; own: boolean }> {
	const own = currentUserId() ? await findSetting(ownKey()) : null;
	if (own && own.value != null) return { marks: readHidden(own.value), own: true };
	return { marks: readHidden(await getSetting<unknown>(SHARED_KEY, null)), own: false };
}

class HiddenVideos {
	marks = $state<HiddenPosts>(NONE_HIDDEN);
	error = $state('');
	#loaded = false;
	/** Whether the marks came from the user's own row; the shared row's changes count only while not. */
	#own = false;

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.#loaded = true;
		const read = await readMarks();
		this.marks = read.marks;
		this.#own = read.own;
	}

	/** Hides these posts of a video, or shows them again; logged against its title and the platforms. Says whether it was saved. */
	async set(posts: HiddenPost[], on: boolean, title: string): Promise<boolean> {
		if (posts.length === 0) return false;
		const before = this.marks;
		this.marks = setHidden(this.marks, posts, on);
		try {
			const next = setHidden((await readMarks()).marks, posts, on);
			await setSetting(ownKey(), next);
			this.marks = next;
			this.#own = true;
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
			const gone = e.action === 'delete';
			if (e.record.key === ownKey()) {
				// Deleted (its user was): back to the shared row.
				if (gone) void this.load(true);
				else {
					this.marks = readHidden(e.record.value);
					this.#own = true;
				}
			} else if (e.record.key === SHARED_KEY && !this.#own) {
				this.marks = readHidden(gone ? null : e.record.value);
			}
		});
		sub.catch(() => {});
		return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
	}
}

export const hiddenVideos = new HiddenVideos();
