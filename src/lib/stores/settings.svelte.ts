import { loadPlatformSettings, savePlatformSettings } from '../repo';
import { PLATFORMS } from '../platforms';
import { logAction } from '../log';
import { settle, LOG_SETTLE_MS } from '../settle';
import { DEFAULT_SCHEDULING } from '../types';
import { brands } from './brands.svelte';
import { accounts } from './accounts.svelte';
import type {
	FilterRule,
	OptionValues,
	PlatformId,
	PlatformScheduling,
	PlatformSettings
} from '../types';

/**
 * Platform settings, loaded once and shared by the compose screen and the
 * settings screen. Every brand has its own row per platform; `list` holds all
 * of them, and every accessor answers for the brand in view
 * (`brands.currentId`), so switching brand needs no load. Writes go straight
 * to PocketBase and are debounced, since the settings screen edits fields on
 * every keystroke.
 */
class SettingsStore {
	list = $state<PlatformSettings[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);
	saving = $state(false);

	/** Pending writes and last-logged snapshots, by row id — one per brand and platform. */
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#loaded = false;

	#logged = new Map<string, PlatformSettings>();
	#logSettle = settle(LOG_SETTLE_MS);

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		this.error = null;
		try {
			// The brands first: their first load turns brandless rows into the
			// first brand's, which seeding below must not race. The accounts
			// decide which platforms a brand is offered (`available`).
			await Promise.all([brands.load(), accounts.load()]);
			if (brands.error) throw new Error(brands.error);
			this.list = await loadPlatformSettings(brands.list);
			this.#logged.clear();
			for (const entry of this.list) {
				if (entry.id) this.#logged.set(entry.id, $state.snapshot(entry) as PlatformSettings);
			}
			this.#loaded = true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
	}

	/** The brand in view's platforms, in its configured display order. */
	get ordered(): PlatformSettings[] {
		const brand = brands.currentId;
		return this.list.filter((s) => s.brand === brand).sort((a, b) => a.sort_order - b.sort_order);
	}

	/**
	 * The platforms a new upload may target. Unticking a platform in Settings
	 * removes it from the compose flow entirely rather than merely starting it
	 * unselected, so this — not `ordered` — is what the upload screens iterate.
	 * A platform the brand has no account for is left out too (accounts.ts):
	 * with several brands, that is what keeps a post off another brand's
	 * account.
	 */
	get available(): PlatformSettings[] {
		return this.ordered.filter((entry) => entry.enabled && accounts.offer(entry.platform).offered);
	}

	/** Enabled for the brand in view but not offered, for want of an account. */
	get withoutAccount(): PlatformId[] {
		return this.ordered
			.filter((entry) => entry.enabled && !accounts.offer(entry.platform).offered)
			.map((entry) => entry.platform);
	}

	get(platform: PlatformId): PlatformSettings | undefined {
		const brand = brands.currentId;
		return this.list.find((s) => s.platform === platform && s.brand === brand);
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

	#queueLog(entry: PlatformSettings) {
		this.#logSettle.schedule(() => this.#logDiff(entry));
	}

	/** Names the setting that moved, rather than restating the whole platform. */
	#logDiff(entry: PlatformSettings) {
		if (!entry.id) return;
		const before = this.#logged.get(entry.id);
		const after = $state.snapshot(entry) as PlatformSettings;
		this.#logged.set(entry.id, after);
		if (!before) return;

		// With more than one brand, which brand's settings moved is half the news.
		const brand = brands.multiple ? brands.byId(entry.brand)?.name : undefined;
		const label = brand ? `${brand} ${PLATFORMS[entry.platform].label}` : PLATFORMS[entry.platform].label;

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

	/**
	 * Queues a write ~400ms after the last edit to that platform. The row is
	 * taken now, not when the timer fires: switching brand in between must not
	 * send the other brand's row instead.
	 */
	queueSave(platform: PlatformId) {
		const entry = this.get(platform);
		if (!entry?.id) return;
		const id = entry.id;
		this.#queueLog(entry);
		const existing = this.#timers.get(id);
		if (existing) clearTimeout(existing);
		this.#timers.set(
			id,
			setTimeout(() => {
				this.#timers.delete(id);
				void this.#save(entry);
			}, 400)
		);
	}

	async #save(entry: PlatformSettings) {
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

	/** Moves a platform up or down in the brand's display order and persists both rows. */
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

		await Promise.all([this.#save(a), this.#save(b)]);
	}
}

export const settings = new SettingsStore();
