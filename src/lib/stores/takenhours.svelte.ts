import { loadTakenPosts, subscribeTargets } from '../repo';
import { takenHours as holdOf, type SlotPost } from '../takenhours';

/**
 * Every post with a slot from the current hour on, for the schedule step's
 * taken hours (takenhours.ts). Read while the step is open and followed live
 * there, and read once more just before a confirm writes anything.
 */
class TakenHours {
	posts = $state<SlotPost[]>([]);
	error = $state('');
	#following = 0;
	#stop: (() => void) | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;

	async refresh() {
		const since = new Date();
		since.setMinutes(0, 0, 0);
		try {
			this.posts = await loadTakenPosts(since);
			this.error = '';
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	/** Reads now and follows every change to a post until the returned function lets go. */
	follow(): () => void {
		this.#following += 1;
		if (this.#following === 1) {
			void this.refresh();
			this.#stop = subscribeTargets(() => {
				if (this.#timer) clearTimeout(this.#timer);
				this.#timer = setTimeout(() => void this.refresh(), 400);
			});
		}
		return () => {
			this.#following -= 1;
			if (this.#following > 0) return;
			if (this.#timer) clearTimeout(this.#timer);
			this.#timer = null;
			this.#stop?.();
			this.#stop = null;
		};
	}

	/** The hours the brand's other videos hold, leaving out the jobs named. */
	for(brand: string, exclude: string[] = []): Map<string, SlotPost[]> {
		return holdOf(this.posts, brand, { exclude });
	}
}

export const takenHours = new TakenHours();
