import {
	askTikTokHandles,
	dropTikTokAsks,
	loadTikTokHandles,
	markTikTokHandlesUsed,
	subscribeTikTokHandles
} from '../repo';
import { askable, needsAsking, suggestHandles, type TikTokHandle } from '../tiktokmentions';

/**
 * The TikTok handles flock has asked about (`tiktok_handles`), live: what
 * the compose screen shows beside each @mention and suggests after an @.
 * The worker answers the asks (worker/tiktokhandles.mjs), one at a time
 * because TikTok rate-limits the lookup, so an ask waits until the handle
 * has stood still for `SETTLE_MS` — "@w", "@wa"… are never asked about —
 * and an ask this browser made for a handle no caption names any more is
 * taken back before the worker gets to it.
 */
const SETTLE_MS = 900;

class TikTokHandles {
	/** By handle, lower case. */
	rows = $state<Record<string, TikTokHandle>>({});
	error = $state('');
	#loaded = false;
	#wanted: string[] = [];
	#timer: ReturnType<typeof setTimeout> | null = null;
	/** Asks this browser made that are still pending: handle → row id. */
	#mine = new Map<string, string>();

	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		void loadTikTokHandles().then((rows) => {
			const next: Record<string, TikTokHandle> = {};
			for (const row of rows) next[row.handle] = row;
			this.rows = { ...next, ...this.rows };
		});
		subscribeTikTokHandles((row, action) => {
			if (action === 'delete') {
				if (this.rows[row.handle]?.id === row.id) delete this.rows[row.handle];
				return;
			}
			this.rows[row.handle] = row;
			if (row.status !== 'pending') this.#mine.delete(row.handle);
		});
	}

	get list(): TikTokHandle[] {
		return Object.values(this.rows);
	}

	suggest(typed: string): TikTokHandle[] {
		return suggestHandles(typed, this.list);
	}

	/** The handles a caption names now (lower case), asked about once they stand still. */
	want(handles: string[]) {
		this.#wanted = [...new Set(handles.filter(askable))];
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#ask(), SETTLE_MS);
	}

	/** Asks about a handle again now, whatever the last answer was. */
	async recheck(handle: string) {
		await this.#send([handle]);
	}

	/** Marks the handles a confirmed caption names, so they are suggested first. */
	markUsed(handles: string[]) {
		const rows = handles.map((h) => this.rows[h]).filter((row): row is TikTokHandle => Boolean(row));
		void markTikTokHandlesUsed(rows).catch(() => {});
	}

	async #ask() {
		this.#timer = null;
		const wanted = this.#wanted;
		const gone = [...this.#mine].filter(([handle]) => !wanted.includes(handle));
		for (const [handle] of gone) this.#mine.delete(handle);
		if (gone.length > 0) void dropTikTokAsks(gone.map(([, id]) => id)).catch(() => {});
		const now = Date.now();
		await this.#send(wanted.filter((handle) => needsAsking(this.rows[handle], now)));
	}

	async #send(handles: string[]) {
		if (handles.length === 0) return;
		try {
			for (const row of await askTikTokHandles(handles, this.rows)) {
				this.rows[row.handle] = row;
				if (row.status === 'pending') this.#mine.set(row.handle, row.id);
			}
			this.error = '';
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		}
	}
}

export const tiktokHandles = new TikTokHandles();
