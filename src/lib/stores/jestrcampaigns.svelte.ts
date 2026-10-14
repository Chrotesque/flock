import { pb } from '../pb';
import { getSetting, setSetting } from '../repo';
import { logAction } from '../log';
import { NO_MARKS, mark, readMarks, type CampaignMarks, type CampaignPosts } from '../jestrcampaign';

/**
 * The Jestr campaign marks made on the dashboard (jestrcampaign.ts), in
 * `app_settings` / `jestr_campaigns` so every browser sees the same, and
 * arriving live. Each change is merged with the stored row just before it is
 * written, so two browsers marking at once keep both marks.
 */
const KEY = 'jestr_campaigns';

class JestrCampaigns {
	marks = $state<CampaignMarks>(NO_MARKS);
	error = $state('');
	#loaded = false;

	async load() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.marks = readMarks(await getSetting<unknown>(KEY, null));
	}

	/** Marks or unmarks one video; logged against its title. */
	async set(posts: CampaignPosts, on: boolean, title: string) {
		const before = this.marks;
		this.marks = mark(this.marks, posts, on);
		try {
			const stored = readMarks(await getSetting<unknown>(KEY, null));
			const next = mark(stored, posts, on);
			await setSetting(KEY, next);
			this.marks = next;
			this.error = '';
			logAction('upload', on ? 'Marked as a Jestr campaign' : 'No longer a Jestr campaign', title);
		} catch (err) {
			this.marks = before;
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	/** Marks made in another browser, live. Returns the unsubscribe. */
	subscribe(): () => void {
		const sub = pb.collection('app_settings').subscribe('*', (e) => {
			if (e.record.key === KEY) this.marks = readMarks(e.action === 'delete' ? null : e.record.value);
		});
		sub.catch(() => {});
		return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
	}
}

export const jestrCampaigns = new JestrCampaigns();
