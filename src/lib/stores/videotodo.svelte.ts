import { getSetting, loadTodoStats, loadTodoUploads, setSetting } from '../repo';
import { logAction } from '../log';
import { device } from './device.svelte';
import { general } from './general.svelte';
import {
	LEGACY_JESTR_KEY,
	TODO_KEY,
	markDone,
	mergeStates,
	readTodoState,
	startOfDay,
	todoLines,
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
	#state = $state<TodoState | null>(null);
	/** `kind:id` being saved: a poll landing mid-save must not bring the line back. */
	#marking = $state<string[]>([]);
	#busy = false;

	lines = $derived.by((): TodoLine[] => {
		if (!this.#state) return [];
		const marking = this.#marking;
		const state: TodoState = {
			...this.#state,
			jestr: [...this.#state.jestr, ...marking.filter((m) => m.startsWith('jestr:')).map((m) => m.slice(6))],
			studio: [...this.#state.studio, ...marking.filter((m) => m.startsWith('studio:')).map((m) => m.slice(7))]
		};
		return todoLines(this.#stats, this.#uploads, state, { jestr: general.value.jestrIntegration });
	});

	#lastRead = 0;

	/** Starts polling — faster while a line waits; the returned function stops it. */
	start(): () => void {
		void this.refresh();
		const timer = setInterval(() => {
			const waiting = this.lines.some((line) => line.waiting);
			if (waiting || Date.now() - this.#lastRead >= POLL_MS - 1000) void this.refresh();
		}, WAITING_POLL_MS);
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onFocus);
		};
	}

	async #readState(): Promise<{ state: TodoState; stored: boolean }> {
		const [stored, legacy] = await Promise.all([
			getSetting<unknown>(TODO_KEY, null),
			getSetting<unknown>(LEGACY_JESTR_KEY, null)
		]);
		return { state: readTodoState(stored, legacy, this.#state?.since ?? startOfDay(new Date())), stored: Boolean(stored) };
	}

	/**
	 * Re-reads the state and both lists. The first read on an install writes
	 * the state down, starting the list at today's midnight — written, so the
	 * start stays put rather than moving with the date (and only by a named
	 * device, like every write).
	 */
	async refresh(): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		try {
			const read = await this.#readState();
			let state = read.state;
			if (!read.stored && device.named) await setSetting(TODO_KEY, state).catch(() => {});
			if (this.#state) state = mergeStates(state, this.#state);
			const [stats, uploads] = await Promise.all([loadTodoStats(state.since), loadTodoUploads(state.since)]);
			this.#state = state;
			this.#stats = stats;
			this.#uploads = uploads;
			this.#lastRead = Date.now();
		} catch {
			// Unreachable PocketBase: the list stays as it was until the next poll.
		} finally {
			this.#busy = false;
		}
	}

	/**
	 * Marks one part of a line done for good, merged with the stored state
	 * just before writing so a mark made in another browser meanwhile
	 * survives. A failed write (no device name, PocketBase unreachable) puts
	 * it back.
	 */
	async #mark(kind: TodoKind, line: TodoLine, action: string, detail: string): Promise<void> {
		if (!this.#state) return;
		const key = `${kind}:${line.id}`;
		this.#marking = [...this.#marking, key];
		try {
			const read = await this.#readState();
			const next = markDone(mergeStates(read.state, this.#state), kind, line.id);
			await setSetting(TODO_KEY, next);
			this.#state = next;
			logAction('upload', action, detail);
		} catch {
			// Not saved: the line keeps this part.
		} finally {
			this.#marking = this.#marking.filter((m) => m !== key);
		}
	}

	/** The Jestr button: the video is linked on Jestr. */
	markJestr(line: TodoLine): Promise<void> {
		return this.#mark(
			'jestr',
			line,
			`Linked on Jestr: "${line.title}"`,
			`${line.channel ? `${line.channel} · ` : ''}${line.watchUrl}`
		);
	}

	/** The YouTube icon, when it carries Studio steps: opening Studio counts as doing them. */
	markStudio(line: TodoLine): Promise<void> {
		return this.#mark('studio', line, `Opened in Studio: "${line.title}"`, `to set ${line.studio.join(' and ')} · ${line.studioUrl}`);
	}
}

export const videoTodo = new VideoTodoStore();
