import { getSetting, setSetting } from '../repo';
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

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		try {
			const stored = await getSetting<{ items?: TextTemplate[] }>(TEMPLATES_KEY, {});
			this.items = Array.isArray(stored.items) ? stored.items : [];
			this.#loaded = true;
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
		return entry.id;
	}

	update(id: string, patch: Partial<TextTemplate>) {
		this.items = this.items.map((t) => (t.id === id ? { ...t, ...patch } : t));
		this.queueSave();
	}

	remove(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
		this.queueSave();
	}
}

export const templates = new TemplateStore();
