import { getSetting, loadJestrVideos, setSetting } from '../repo';
import { logAction } from '../log';
import { device } from './device.svelte';
import {
	JESTR_KEY,
	markDone,
	mergeDone,
	pendingVideos,
	readJestrState,
	startOfDay,
	type JestrRow,
	type JestrState,
	type JestrVideo
} from '../jestr';

/** The stats pass writes every 30 s; a minute behind is soon enough for a reminder. */
const POLL_MS = 60_000;

/**
 * The sidebar's Jestr list: videos gone public that have not been marked as
 * linked on Jestr yet (rules in jestr.ts). Runs only while the integration is
 * on — the layout starts and stops it — and polls a query of a few hundred
 * bytes rather than subscribing to `video_stats`, whose counters change on
 * every stats pass.
 */
class JestrStore {
	videos = $state<JestrVideo[]>([]);

	#state: JestrState | null = null;
	#rows: JestrRow[] = [];
	/** Being marked right now: a refresh landing mid-save must not bring them back. */
	#marking = new Set<string>();
	#busy = false;

	/** Starts polling; the returned function stops it and empties the list. */
	start(): () => void {
		void this.refresh();
		const timer = setInterval(() => void this.refresh(), POLL_MS);
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onFocus);
			this.videos = [];
		};
	}

	#show() {
		if (!this.#state) return;
		this.videos = pendingVideos(this.#rows, this.#state).filter((v) => !this.#marking.has(v.id));
	}

	/**
	 * Re-reads the state and the videos. The first read on an install writes
	 * the state down, starting the list at today's midnight — written, so the
	 * start stays put rather than moving with the date (and only by a named
	 * device, like every write).
	 */
	async refresh(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		try {
			const stored = await getSetting<unknown>(JESTR_KEY, null);
			let state = readJestrState(stored, this.#state?.since ?? startOfDay(new Date()));
			if (!stored && device.named) await setSetting(JESTR_KEY, state).catch(() => {});
			if (this.#state) state = mergeDone(state, this.#state);
			this.#state = state;
			this.#rows = await loadJestrVideos(state.since);
			this.#show();
		} catch {
			// Unreachable PocketBase: the list stays as it was until the next poll.
		} finally {
			this.#busy = false;
		}
	}

	/**
	 * Takes a video off the list for good. Merged with the stored state just
	 * before writing, so a mark made in another browser meanwhile survives.
	 * A failed write puts the line back.
	 */
	async markLinked(video: JestrVideo): Promise<void> {
		if (!this.#state) return;
		this.#marking.add(video.id);
		this.#show();
		try {
			const stored = await getSetting<unknown>(JESTR_KEY, null);
			const next = markDone(mergeDone(readJestrState(stored, this.#state.since), this.#state), video.id);
			await setSetting(JESTR_KEY, next);
			this.#state = next;
			logAction(
				'upload',
				`Linked on Jestr: "${video.title}"`,
				`${video.channel ? `${video.channel} · ` : ''}${video.url}`
			);
		} catch {
			// Not saved (no device name, or PocketBase unreachable): it stays listed.
		} finally {
			this.#marking.delete(video.id);
			this.#show();
		}
	}
}

export const jestr = new JestrStore();
