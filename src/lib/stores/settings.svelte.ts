import { loadPlatformSettings, savePlatformSettings } from '../repo';
import { PLATFORMS } from '../platforms';
import type { FilterRule, OptionValues, PlatformId, PlatformSettings } from '../types';

/**
 * Platform settings, loaded once and shared by the compose screen and the
 * settings screen. Writes go straight to PocketBase and are debounced, since
 * the settings screen edits fields on every keystroke.
 */
class SettingsStore {
	list = $state<PlatformSettings[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);
	saving = $state(false);

	#timers = new Map<PlatformId, ReturnType<typeof setTimeout>>();
	#loaded = false;

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		this.error = null;
		try {
			this.list = await loadPlatformSettings();
			this.#loaded = true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
	}

	/** Settings in the user's configured display order. */
	get ordered(): PlatformSettings[] {
		return [...this.list].sort((a, b) => a.sort_order - b.sort_order);
	}

	get(platform: PlatformId): PlatformSettings | undefined {
		return this.list.find((s) => s.platform === platform);
	}

	/** Saved defaults for a platform, falling back to the registry. */
	defaultsFor(platform: PlatformId): OptionValues {
		return { ...PLATFORMS[platform].defaults, ...(this.get(platform)?.defaults ?? {}) };
	}

	filtersFor(platform: PlatformId): FilterRule[] {
		return this.get(platform)?.filters ?? [];
	}

	/** Queues a write ~400ms after the last edit to that platform. */
	queueSave(platform: PlatformId) {
		const existing = this.#timers.get(platform);
		if (existing) clearTimeout(existing);
		this.#timers.set(
			platform,
			setTimeout(() => {
				this.#timers.delete(platform);
				void this.saveNow(platform);
			}, 400)
		);
	}

	async saveNow(platform: PlatformId) {
		const entry = this.get(platform);
		if (!entry) return;
		this.saving = true;
		try {
			await savePlatformSettings($state.snapshot(entry) as PlatformSettings);
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.saving = false;
		}
	}

	/** Moves a platform up or down in the display order and persists both rows. */
	async move(platform: PlatformId, direction: -1 | 1) {
		const ordered = this.ordered;
		const index = ordered.findIndex((s) => s.platform === platform);
		const swapWith = index + direction;
		if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return;

		const a = ordered[index];
		const b = ordered[swapWith];
		const tmp = a.sort_order;
		a.sort_order = b.sort_order;
		b.sort_order = tmp;

		// Ties would make the order non-deterministic; renumber to be safe.
		this.ordered.forEach((entry, i) => (entry.sort_order = i));

		await Promise.all([this.saveNow(a.platform), this.saveNow(b.platform)]);
	}
}

export const settings = new SettingsStore();
