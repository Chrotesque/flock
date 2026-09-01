import { loadPlatformSettings, savePlatformSettings } from '../repo';
import { PLATFORMS } from '../platforms';
import { logAction } from '../log';
import { settle, LOG_SETTLE_MS } from '../settle';
import { DEFAULT_SCHEDULING } from '../types';
import type {
	FilterRule,
	OptionValues,
	PlatformId,
	PlatformScheduling,
	PlatformSettings
} from '../types';

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

	#logged = new Map<PlatformId, PlatformSettings>();
	#logSettle = settle(LOG_SETTLE_MS);

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		this.error = null;
		try {
			this.list = await loadPlatformSettings();
			for (const entry of this.list) {
				this.#logged.set(entry.platform, $state.snapshot(entry) as PlatformSettings);
			}
			this.#loaded = true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
	}

	/** Every platform, in the user's configured display order. */
	get ordered(): PlatformSettings[] {
		return [...this.list].sort((a, b) => a.sort_order - b.sort_order);
	}

	/**
	 * The platforms a new upload may target. Unticking a platform in Settings
	 * removes it from the compose flow entirely rather than merely starting it
	 * unselected, so this — not `ordered` — is what the upload screens iterate.
	 */
	get available(): PlatformSettings[] {
		return this.ordered.filter((entry) => entry.enabled);
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

	schedulingFor(platform: PlatformId): PlatformScheduling {
		return this.get(platform)?.scheduling ?? { ...DEFAULT_SCHEDULING, profiles: [] };
	}

	#queueLog(platform: PlatformId) {
		this.#logSettle.schedule(() => this.#logDiff(platform));
	}

	/** Names the setting that moved, rather than restating the whole platform. */
	#logDiff(platform: PlatformId) {
		const entry = this.get(platform);
		if (!entry) return;
		const before = this.#logged.get(platform);
		const after = $state.snapshot(entry) as PlatformSettings;
		this.#logged.set(platform, after);
		if (!before) return;

		const label = PLATFORMS[platform].label;

		if (before.enabled !== after.enabled) {
			logAction('settings', `${after.enabled ? 'Enabled' : 'Disabled'} ${label}`);
		}
		if (before.sort_order !== after.sort_order) {
			logAction('settings', `Reordered ${label}`, `position ${before.sort_order + 1} → ${after.sort_order + 1}`);
		}
		if (before.filters.length !== after.filters.length) {
			logAction(
				'settings',
				`${after.filters.length > before.filters.length ? 'Added' : 'Removed'} a ${label} adaptation rule`,
				`${before.filters.length} → ${after.filters.length} rule(s)`
			);
		} else if (JSON.stringify(before.filters) !== JSON.stringify(after.filters)) {
			logAction('settings', `Edited ${label} adaptation rules`);
		}
		if (before.scheduling.mode !== after.scheduling.mode) {
			logAction('settings', `Set ${label} timing to ${after.scheduling.mode}`);
		} else if (before.scheduling.defaultTime !== after.scheduling.defaultTime) {
			logAction(
				'settings',
				`Changed ${label} release time`,
				`${before.scheduling.defaultTime} → ${after.scheduling.defaultTime}`
			);
		} else if (
			JSON.stringify(before.scheduling.profiles) !== JSON.stringify(after.scheduling.profiles)
		) {
			logAction('settings', `Edited ${label} scheduling profiles`);
		}
		if (JSON.stringify(before.defaults) !== JSON.stringify(after.defaults)) {
			logAction('settings', `Changed ${label} publish defaults`);
		}
	}

	/** Queues a write ~400ms after the last edit to that platform. */
	queueSave(platform: PlatformId) {
		this.#queueLog(platform);
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
