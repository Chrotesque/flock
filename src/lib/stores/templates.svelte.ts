import { newId } from '../id';
import { getBrandSettings, setSetting } from '../repo';
import { brandSettingKey } from '../brands';
import { logAction } from '../log';
import { settle, LOG_SETTLE_MS } from '../settle';
import { brands } from './brands.svelte';
import type { TextTemplate } from '../types';

export const TEMPLATES_KEY = 'templates';

/**
 * The form a template is referenced by in text: lower case, with runs of
 * whitespace collapsed to a single dash. A template named "test 123" is used as
 * `{test-123}`, since a brace token reads better without spaces in it.
 */
export function tokenOf(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Reusable blocks of text, per brand, each brand's under its own
 * `app_settings` key (`templates:<brand id>`) rather than inside the general
 * blob — they are a list that grows, not a handful of settings. Every brand's
 * list is loaded at once, and `items` answers for the brand in view.
 */
class TemplateStore {
	loading = $state(true);
	saving = $state(false);
	error = $state<string | null>(null);

	#byBrand = $state<Record<string, TextTemplate[]>>({});
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#loaded = false;

	#logged = new Map<string, TextTemplate[]>();
	#logSettle = settle(LOG_SETTLE_MS);

	/** The brand in view's templates. */
	get items(): TextTemplate[] {
		return this.#byBrand[brands.currentId] ?? [];
	}

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		try {
			// After the brands: their first load moves the old single list to the
			// first brand's key.
			await brands.load();
			const stored = await getBrandSettings<{ items?: TextTemplate[] }>(TEMPLATES_KEY);
			const next: Record<string, TextTemplate[]> = {};
			this.#logged.clear();
			for (const [brand, value] of Object.entries(stored)) {
				next[brand] = Array.isArray(value?.items) ? value.items : [];
				this.#logged.set(brand, structuredClone(next[brand]));
			}
			this.#byBrand = next;
			this.#loaded = true;
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
	}

	/** Writes a brand's list ~400ms after its last edit. */
	#queueSave(brand: string) {
		const existing = this.#timers.get(brand);
		if (existing) clearTimeout(existing);
		this.#timers.set(
			brand,
			setTimeout(() => {
				this.#timers.delete(brand);
				void this.#save(brand);
			}, 400)
		);
	}

	async #save(brand: string) {
		this.saving = true;
		try {
			await setSetting(brandSettingKey(TEMPLATES_KEY, brand), {
				items: $state.snapshot(this.#byBrand[brand] ?? [])
			});
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.saving = false;
		}
	}

	#queueLog(brand: string) {
		this.#logSettle.schedule(() => this.#logDiff(brand));
	}

	/** Reports what actually changed, rather than that something did. */
	#logDiff(brand: string) {
		const before = this.#logged.get(brand) ?? [];
		const after = $state.snapshot(this.#byBrand[brand] ?? []) as TextTemplate[];
		this.#logged.set(brand, after);

		const was = new Map(before.map((t) => [t.id, t]));
		const now = new Map(after.map((t) => [t.id, t]));
		const name = (t?: TextTemplate) => t?.name.trim() || 'unnamed';
		// With more than one brand, whose template it was is half the news.
		const of = brands.multiple ? ` (${brands.byId(brand)?.name ?? 'deleted brand'})` : '';

		for (const [id, tpl] of now) {
			const old = was.get(id);
			// A template starts blank, so it only counts as added once named.
			if (!old || !old.name.trim()) {
				// The content rides along so the log records what the template said,
				// not merely that one appeared.
				if (tpl.name.trim()) {
					logAction('settings', `Added template ${name(tpl)}${of}`, tpl.content || '(empty)');
				}
				continue;
			}
			if (old.name !== tpl.name) {
				logAction('settings', `Renamed template ${name(old)} to ${name(tpl)}${of}`);
			}
			if (old.content !== tpl.content) {
				logAction('settings', `Edited template ${name(tpl)}${of}`, `${tpl.content.length} characters`);
			}
		}

		for (const [id, tpl] of was) {
			// Deletion is the only record of what the template held, so keep it.
			if (!now.has(id)) {
				logAction('settings', `Deleted template ${name(tpl)}${of}`, tpl.content || '(empty)');
			}
		}
	}

	/** Replaces the brand in view's list, then queues its write and its log line. */
	#edit(change: (list: TextTemplate[]) => TextTemplate[]) {
		const brand = brands.currentId;
		if (!brand) return;
		this.#byBrand[brand] = change(this.#byBrand[brand] ?? []);
		this.#queueSave(brand);
		this.#queueLog(brand);
	}

	/**
	 * Resolves a brace token to its template. Both sides go through `tokenOf`,
	 * so `{test-123}`, `{test 123}` and `{TEST-123}` all find "test 123" —
	 * liberal on the way in, canonical on the way out.
	 */
	byName(name: string): TextTemplate | undefined {
		const wanted = tokenOf(name);
		if (!wanted) return undefined;
		return this.items.find((t) => tokenOf(t.name) === wanted);
	}

	/** Returns the new template's id so the caller can expand it. */
	add(): string {
		const entry: TextTemplate = { id: newId(), name: '', content: '' };
		this.#edit((list) => [...list, entry]);
		return entry.id;
	}

	update(id: string, patch: Partial<TextTemplate>) {
		this.#edit((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	}

	remove(id: string) {
		this.#edit((list) => list.filter((t) => t.id !== id));
	}
}

export const templates = new TemplateStore();
