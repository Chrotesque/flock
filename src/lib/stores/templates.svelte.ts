import { getSetting, setSetting } from '../repo';
import { logAction } from '../log';
import { settle, LOG_SETTLE_MS } from '../settle';
import type { TextTemplate } from '../types';

export const TEMPLATES_KEY = 'templates';

/**
 * Reusable blocks of text, kept under their own `app_settings` key rather than
 * inside the general blob — they are a list that grows, not a handful of
 * settings, and the compose screen loads them on their own.
 */
class TemplateStore {
	items = $state<TextTemplate[]>([]);
	loading = $state(true);
	saving = $state(false);
	error = $state<string | null>(null);

	#timer: ReturnType<typeof setTimeout> | null = null;
	#loaded = false;

	#logged: TextTemplate[] | null = null;
	#logSettle = settle(LOG_SETTLE_MS);

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		try {
			const stored = await getSetting<{ items?: TextTemplate[] }>(TEMPLATES_KEY, {});
			this.items = Array.isArray(stored.items) ? stored.items : [];
			this.#loaded = true;
			this.#logged = $state.snapshot(this.items) as TextTemplate[];
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
	}

	queueSave() {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.saveNow();
		}, 400);
	}

	async saveNow() {
		this.saving = true;
		try {
			await setSetting(TEMPLATES_KEY, { items: $state.snapshot(this.items) });
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.saving = false;
		}
	}

	#queueLog() {
		this.#logSettle.schedule(() => this.#logDiff());
	}

	/** Reports what actually changed, rather than that something did. */
	#logDiff() {
		const before = this.#logged;
		const after = $state.snapshot(this.items) as TextTemplate[];
		this.#logged = after;
		if (!before) return;

		const was = new Map(before.map((t) => [t.id, t]));
		const now = new Map(after.map((t) => [t.id, t]));
		const name = (t?: TextTemplate) => t?.name.trim() || 'unnamed';

		for (const [id, tpl] of now) {
			const old = was.get(id);
			// A template starts blank, so it only counts as added once named.
			if (!old || !old.name.trim()) {
				// The content rides along so the log records what the template said,
				// not merely that one appeared.
				if (tpl.name.trim()) {
					logAction('settings', `Added template ${name(tpl)}`, tpl.content || '(empty)');
				}
				continue;
			}
			if (old.name !== tpl.name) {
				logAction('settings', `Renamed template ${name(old)} to ${name(tpl)}`);
			}
			if (old.content !== tpl.content) {
				logAction('settings', `Edited template ${name(tpl)}`, `${tpl.content.length} characters`);
			}
		}

		for (const [id, tpl] of was) {
			// Deletion is the only record of what the template held, so keep it.
			if (!now.has(id)) {
				logAction('settings', `Deleted template ${name(tpl)}`, tpl.content || '(empty)');
			}
		}
	}

	/**
	 * Names are forced lower case on entry, but this still folds case so that
	 * `{Socials}` typed mid-sentence finds `socials`.
	 */
	byName(name: string): TextTemplate | undefined {
		const wanted = name.trim().toLowerCase();
		if (!wanted) return undefined;
		return this.items.find((t) => t.name.trim().toLowerCase() === wanted);
	}

	/** Returns the new template's id so the caller can expand it. */
	add(): string {
		const entry: TextTemplate = { id: crypto.randomUUID(), name: '', content: '' };
		this.items = [...this.items, entry];
		this.queueSave();
		this.#queueLog();
		return entry.id;
	}

	update(id: string, patch: Partial<TextTemplate>) {
		this.items = this.items.map((t) => (t.id === id ? { ...t, ...patch } : t));
		this.queueSave();
		this.#queueLog();
	}

	remove(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
		this.queueSave();
		this.#queueLog();
	}
}

export const templates = new TemplateStore();
