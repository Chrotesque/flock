import { getSetting, getStatsStatus, loadDashTargets, setSetting, subscribeTargets } from '../repo';
import { logAction } from '../log';
import { PLATFORMS } from '../platforms';
import { addDismissed, attentionItems, DISMISSED_KEY, hasFailure, readDismissed, type Attention } from '../attention';
import type { DashTarget } from '../dashboard';
import type { StatsStatus } from '../types';
import { accounts } from './accounts.svelte';
import { general } from './general.svelte';
import { workers } from './workers.svelte';
import { followedItems } from '../todobrands';

/** Failures are listed for a week; a day's margin covers the clock and the window's edge. */
const WINDOW_MS = 8 * 24 * 3_600_000;
const POLL_MS = 60_000;

/**
 * What needs attention, for the To finish panel and the sidebar box that
 * opens it (rules in attention.ts). Read while the panel is closed too —
 * the box has to turn red when a post fails — but only the posts that could
 * still need attention: every one not out yet, and the last week's. Re-read
 * every minute, on window focus and whenever a post changes (realtime).
 */
class AttentionStore {
	#targets = $state<DashTarget[]>([]);
	#status = $state<StatsStatus | null>(null);
	#dismissed = $state<string[]>([]);
	/** Keys being saved: shown as gone at once, back if the save fails. */
	#dismissing = $state<string[]>([]);
	#now = $state(new Date());

	// The brands To finish does not follow show only posts that did not go out (todobrands.ts).
	items = $derived.by((): Attention[] =>
		followedItems(
			attentionItems({
				targets: this.#targets,
				dots: workers.view.dots,
				accounts: accounts.list,
				status: this.#status,
				now: this.#now,
				label: (p) => PLATFORMS[p].label,
				dismissed: [...this.#dismissed, ...this.#dismissing]
			}),
			general.value.todoBrands
		)
	);

	/** A post did not go out. */
	failed = $derived(hasFailure(this.items));

	#busy = false;
	#again = false;
	#soon: ReturnType<typeof setTimeout> | null = null;

	start(): () => void {
		void accounts.load();
		void this.refresh();
		const stopLive = subscribeTargets(() => {
			// A confirm writes several rows at once; one read covers them.
			if (this.#soon) clearTimeout(this.#soon);
			this.#soon = setTimeout(() => {
				this.#soon = null;
				void this.refresh();
			}, 400);
		});
		const timer = setInterval(() => void this.refresh(), POLL_MS);
		// "Its slot passed 12 min ago" and the 10-minute grace move with the clock.
		const clock = setInterval(() => (this.#now = new Date()), 15_000);
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			clearInterval(clock);
			stopLive();
			if (this.#soon) clearTimeout(this.#soon);
			window.removeEventListener('focus', onFocus);
		};
	}

	async refresh(): Promise<void> {
		// Asked again mid-read (a live update): one more read once this one ends.
		if (this.#busy) {
			this.#again = true;
			return;
		}
		this.#busy = true;
		try {
			const [targets, status, dismissed] = await Promise.all([
				loadDashTargets(new Date(Date.now() - WINDOW_MS)),
				getStatsStatus().catch(() => null),
				getSetting<unknown>(DISMISSED_KEY, null),
				// TikTok's trouble and Instagram's allowance are on the account rows.
				accounts.refresh()
			]);
			this.#targets = targets;
			this.#status = status;
			this.#dismissed = readDismissed(dismissed);
			this.#now = new Date();
		} catch {
			// Unreachable PocketBase: the list stays as it was until the next read.
		} finally {
			this.#busy = false;
			if (this.#again) {
				this.#again = false;
				void this.refresh();
			}
		}
	}

	/**
	 * Takes a post's item off the list for good — dealt with by hand, or not
	 * worth a retry. Merged with the stored list just before writing, so one
	 * dismissed in another browser meanwhile stays dismissed; logged against
	 * the upload. A failed write (no device name, PocketBase unreachable)
	 * brings it back.
	 */
	async dismiss(item: Attention): Promise<void> {
		if (!item.key) return;
		await this.dismissKey(item.key, item.text, item.detail, item.job);
	}

	/** The keys taken off the list, saved or being saved (a celebration's too — celebrate.ts). */
	get dismissed(): string[] {
		return [...this.#dismissed, ...this.#dismissing];
	}

	/** `dismiss` for anything To finish lists under a key of its own. */
	async dismissKey(key: string, text: string, detail = '', job = ''): Promise<void> {
		if (this.#dismissing.includes(key)) return;
		this.#dismissing = [...this.#dismissing, key];
		try {
			const stored = readDismissed(await getSetting<unknown>(DISMISSED_KEY, null));
			const next = addDismissed(stored, key);
			await setSetting(DISMISSED_KEY, { dismissed: next });
			this.#dismissed = next;
			logAction('upload', `Dismissed: ${text}`, detail, job ? { job } : {});
		} catch {
			// Not saved: the item stays on the list.
		} finally {
			this.#dismissing = this.#dismissing.filter((k) => k !== key);
		}
	}
}

export const attention = new AttentionStore();
