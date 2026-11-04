import { getSetting, loadTodoReels, loadTodoStats, loadTodoUploads, setSetting, subscribeTodoTargets } from '../repo';
import { deviceName, logAction } from '../log';
import { device } from './device.svelte';
import { general } from './general.svelte';
import { brands } from './brands.svelte';
import { accounts } from './accounts.svelte';
import { followedChannels, followedLines } from '../todobrands';
import {
	LEGACY_JESTR_KEY,
	INSTAGRAM_STEP,
	TODO_KEY,
	dismissLine,
	isComplete,
	markDone,
	mergeStates,
	readTodoState,
	restoreLine,
	splitDismissed,
	startOfDay,
	todoLines,
	type DismissedLine,
	type TodoReelRow,
	type StatsRow,
	type TodoKind,
	type TodoLine,
	type TodoState,
	type UploadRow
} from '../videotodo';

/** The stats pass writes every 30 s; a minute behind is soon enough for a reminder. */
const POLL_MS = 60_000;
/** While a line waits on YouTube, the moment it is there is worth seeing sooner. */
const WAITING_POLL_MS = 10_000;

/**
 * The sidebar's "To finish" list (rules in videotodo.ts). Polls two queries
 * of a few hundred bytes each rather than subscribing to `video_stats`,
 * whose counters change on every stats pass. The Jestr part follows the
 * setting live: switching it reshapes the list without a reload.
 */
class VideoTodoStore {
	#stats = $state<StatsRow[]>([]);
	#uploads = $state<UploadRow[]>([]);
	#reels = $state<TodoReelRow[]>([]);
	#state = $state<TodoState | null>(null);
	/** `kind:id` being saved: a poll landing mid-save must not bring the line back. */
	#marking = $state<string[]>([]);
	#busy = false;

	/** Every line with something left, dismissed ones included; `lines` and `dismissed` split it. */
	#all = $derived.by((): TodoLine[] => {
		if (!this.#state) return [];
		const marking = this.#marking;
		const state: TodoState = {
			...this.#state,
			jestr: [...this.#state.jestr, ...marking.filter((m) => m.startsWith('jestr:')).map((m) => m.slice(6))],
			studio: [...this.#state.studio, ...marking.filter((m) => m.startsWith('studio:')).map((m) => m.slice(7))],
			instagram: [
				...this.#state.instagram,
				...marking.filter((m) => m.startsWith('instagram:')).map((m) => m.slice(10))
			]
		};
		const lines = todoLines(this.#stats, this.#uploads, state, { jestr: general.value.jestrIntegration }, this.#reels);
		// Only the brands To finish follows (todobrands.ts) — once it is known
		// which channel is whose, so nothing flickers away while that loads.
		const ready = !brands.loading && accounts.loaded;
		return ready ? followedLines(lines, followedChannels(brands.list, accounts.list, general.value.todoBrands)) : lines;
	});

	/** Re-read every minute, so a dismissal leaves the second-chance list after its week. */
	#now = $state(Date.now());

	#split = $derived(
		this.#state ? splitDismissed(this.#all, this.#state, this.#now) : { lines: [], dismissed: [] as DismissedLine[] }
	);

	/** What the list shows and the sidebar's box counts. */
	lines = $derived(this.#split.lines);
	/** Taken off by hand in the last 7 days, newest first: offered back (v0.22.11). */
	dismissed = $derived(this.#split.dismissed);

	#lastRead = 0;
	#soon: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Starts polling — faster while a line waits — and follows YouTube's and
	 * Instagram's upload rows live, so a confirm, a claim or a link shows at
	 * once; the returned function stops it all.
	 */
	start(): () => void {
		void brands.load();
		void this.refresh();
		const stopLive = subscribeTodoTargets(() => {
			// A confirm writes several rows at once; one read covers them.
			if (this.#soon) clearTimeout(this.#soon);
			this.#soon = setTimeout(() => {
				this.#soon = null;
				void this.refresh();
			}, 400);
		});
		const timer = setInterval(() => {
			this.#now = Date.now();
			const waiting = this.lines.some((line) => line.waiting);
			if (waiting || Date.now() - this.#lastRead >= POLL_MS - 1000) void this.refresh();
		}, WAITING_POLL_MS);
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			stopLive();
			if (this.#soon) clearTimeout(this.#soon);
			window.removeEventListener('focus', onFocus);
		};
	}

	async #readState(): Promise<{ state: TodoState; complete: boolean }> {
		const [stored, legacy] = await Promise.all([
			getSetting<unknown>(TODO_KEY, null),
			getSetting<unknown>(LEGACY_JESTR_KEY, null)
		]);
		return {
			state: readTodoState(stored, legacy, this.#state?.since ?? startOfDay(new Date())),
			complete: isComplete(stored)
		};
	}

	/**
	 * Re-reads the state and the lists. The first read on an install writes
	 * the state down, starting the list at today's midnight — written, so the
	 * start stays put rather than moving with the date (and only by a named
	 * device, like every write). A row from before the reels were listed gets
	 * their start the same way.
	 */
	#again = false;

	async refresh(): Promise<void> {
		// Asked again mid-read (a live update): one more read once this one ends.
		if (this.#busy) {
			this.#again = true;
			return;
		}
		this.#busy = true;
		try {
			const read = await this.#readState();
			const state = read.state;
			if (!read.complete && device.ready) await setSetting(TODO_KEY, state).catch(() => {});
			const [stats, uploads, reels] = await Promise.all([
				loadTodoStats(state.since),
				loadTodoUploads(state.since),
				loadTodoReels(state.since)
			]);
			// Merged with what is in memory now, not before the lists were read:
			// a mark saved meanwhile is missing from the copy read above, and
			// taking that copy brought the line back until the next read (the
			// Jestr button needing a second press, 23 Oct 2026).
			this.#state = this.#state ? mergeStates(state, this.#state) : state;
			this.#stats = stats;
			this.#uploads = uploads;
			this.#reels = reels;
			this.#lastRead = Date.now();
		} catch {
			// Unreachable PocketBase: the list stays as it was until the next poll.
		} finally {
			this.#busy = false;
			if (this.#again) {
				this.#again = false;
				void this.refresh();
			}
		}
	}

	/**
	 * Marks parts of a line done for good, in one write, merged with the
	 * stored state just before writing so a mark made in another browser
	 * meanwhile survives. A failed write (no device name, PocketBase
	 * unreachable) puts them back.
	 */
	async #mark(marks: [TodoKind, string][], action: string, detail: string): Promise<void> {
		if (!this.#state || marks.length === 0) return;
		const keys = marks.map(([kind, id]) => `${kind}:${id}`);
		this.#marking = [...this.#marking, ...keys];
		try {
			const read = await this.#readState();
			const next = marks.reduce((state, [kind, id]) => markDone(state, kind, id), mergeStates(read.state, this.#state));
			await setSetting(TODO_KEY, next);
			// A read that ended during the save may have brought another browser's marks.
			this.#state = this.#state ? mergeStates(next, this.#state) : next;
			logAction('upload', action, detail);
		} catch {
			// Not saved: the line keeps these parts.
		} finally {
			this.#marking = this.#marking.filter((m) => !keys.includes(m));
		}
	}

	/** The Jestr button: the video is linked on Jestr. */
	markJestr(line: TodoLine): Promise<void> {
		return this.#mark(
			[['jestr', line.id]],
			`Linked on Jestr: "${line.title}"`,
			`${line.channel ? `${line.channel} · ` : ''}${line.watchUrl}`
		);
	}

	/**
	 * The Studio button: opening the video in Studio counts its Studio steps
	 * as done, and its reel's label too once the reel is out — the user's
	 * call, since she does the two one after the other.
	 */
	markOpened(line: TodoLine): Promise<void> {
		const reel = line.instagram?.state === 'open' ? line.instagram : null;
		const marks: [TodoKind, string][] = [];
		const what: string[] = [];
		if (line.studio.length > 0) {
			marks.push(['studio', line.id]);
			what.push(`to set ${line.studio.join(' and ')}`);
		}
		if (reel) {
			marks.push(['instagram', reel.target]);
			what.push(`Instagram's ${INSTAGRAM_STEP} (${reel.url})`);
		}
		return this.#mark(marks, `Opened in Studio: "${line.title}"`, `${what.join('; ')} · ${line.studioUrl}`);
	}

	/**
	 * Takes a line off the list (`dismiss`) or puts it back (`restore`), at
	 * once in memory and then merged with the stored state and written. The
	 * entries merge by whichever happened last, so a read landing meanwhile
	 * cannot undo either. A failed write puts the entry back as it was.
	 */
	async #setDismissed(line: TodoLine, restore: boolean): Promise<void> {
		if (!this.#state) return;
		const at = new Date().toISOString();
		const before = this.#state.dismissed.find((d) => d.id === line.id);
		const apply = (state: TodoState) =>
			restore ? restoreLine(state, line.id, at) : dismissLine(state, line.id, at, deviceName());
		this.#state = apply(this.#state);
		this.#now = Date.now();
		try {
			const read = await this.#readState();
			const next = mergeStates(apply(read.state), this.#state);
			await setSetting(TODO_KEY, next);
			this.#state = this.#state ? mergeStates(next, this.#state) : next;
			logAction(
				'upload',
				restore ? `Restored to To finish: "${line.title}"` : `Dismissed from To finish: "${line.title}"`,
				[line.channel, line.watchUrl].filter(Boolean).join(' · ')
			);
		} catch {
			if (this.#state) {
				const others = this.#state.dismissed.filter((d) => d.id !== line.id);
				this.#state = { ...this.#state, dismissed: before ? [...others, before] : others };
			}
		}
	}

	/** The row's Dismiss: done as far as the user is concerned, whatever is left on it. */
	dismiss(line: TodoLine): Promise<void> {
		return this.#setDismissed(line, false);
	}

	/** Restore on the second-chance list: the line comes back with what is left on it. */
	restore(line: TodoLine): Promise<void> {
		return this.#setDismissed(line, true);
	}
}

export const videoTodo = new VideoTodoStore();
