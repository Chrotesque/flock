import { newId } from '../id';
import { getSetting, setSetting } from '../repo';
import { logAction } from '../log';
import { settle, LOG_SETTLE_MS } from '../settle';
import type { GeneralSettings, LocalFolder, NasDestination } from '../types';
import type { TimeZoneChoice } from '../timezones';

export const GENERAL_KEY = 'general';

export const DEFAULT_GENERAL: GeneralSettings = {
	destinations: [],
	defaultDestinationId: null,
	watchFolder: '',
	localFolders: [],
	complianceBranding: true,
	timeZones: []
};

/**
 * App-wide settings, stored as a single JSON blob under the `general` key in
 * `app_settings`. Deliberately one row rather than a column per setting: this
 * section is where half-formed ideas land, and most of them will be renamed or
 * deleted before any of it is settled enough to deserve a schema.
 */
class GeneralStore {
	value = $state<GeneralSettings>({ ...DEFAULT_GENERAL });
	loading = $state(true);
	saving = $state(false);
	error = $state<string | null>(null);

	#timer: ReturnType<typeof setTimeout> | null = null;
	#loaded = false;

	// The log describes what changed, so it needs the last state it reported on
	// to compare against — not the state of the previous save.
	#logged: GeneralSettings | null = null;
	#logSettle = settle(LOG_SETTLE_MS);

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		try {
			const stored = await getSetting<Partial<GeneralSettings>>(GENERAL_KEY, {});
			// Rebuilt field by field rather than spread, so a key added to
			// DEFAULT_GENERAL later cannot come back undefined and a key since
			// removed (defaultReleaseTime, now per-platform) is not carried
			// forward and written back on the next save.
			this.value = {
				destinations: Array.isArray(stored.destinations) ? stored.destinations : [],
				defaultDestinationId: stored.defaultDestinationId ?? null,
				watchFolder: stored.watchFolder ?? '',
				localFolders: Array.isArray(stored.localFolders)
					? stored.localFolders.filter(
							(f): f is LocalFolder => Boolean(f) && typeof f.id === 'string' && typeof f.path === 'string'
						)
					: [],
				complianceBranding: stored.complianceBranding ?? true,
				timeZones: Array.isArray(stored.timeZones) ? stored.timeZones : []
			};
			this.#loaded = true;
			this.#logged = $state.snapshot(this.value);
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

	/** Queues a diff of everything that changed since the last log entry. */
	#queueLog() {
		this.#logSettle.schedule(() => this.#logDiff());
	}

	#logDiff() {
		const before = this.#logged;
		const after = $state.snapshot(this.value) as GeneralSettings;
		this.#logged = after;
		if (!before) return;

		const was = new Map(before.destinations.map((d) => [d.id, d]));
		const now = new Map(after.destinations.map((d) => [d.id, d]));
		const name = (d?: NasDestination) => d?.label.trim() || d?.path.trim() || 'unnamed';

		for (const [id, dest] of now) {
			const old = was.get(id);

			// A row starts life blank, so it only counts as "added" once it has
			// something to identify it by.
			if (!old || (!old.label.trim() && !old.path.trim())) {
				if (dest.label.trim() || dest.path.trim()) {
					logAction('settings', `Added NAS destination ${name(dest)}`, dest.path);
				}
				continue;
			}

			if (old.label !== dest.label) {
				logAction('settings', `Renamed NAS destination ${name(old)} to ${name(dest)}`);
			}
			if (old.path !== dest.path) {
				logAction(
					'settings',
					`Changed path of ${name(dest)}`,
					`${old.path || '(empty)'} → ${dest.path || '(empty)'}`
				);
			}
		}

		for (const [id, dest] of was) {
			if (!now.has(id)) {
				logAction('settings', `Removed NAS destination ${name(dest)}`, dest.path);
			}
		}

		if (before.complianceBranding !== after.complianceBranding) {
			logAction(
				'settings',
				`Turned compliance branding ${after.complianceBranding ? 'on' : 'off'}`
			);
		}

		if (before.watchFolder !== after.watchFolder) {
			logAction(
				'settings',
				'Changed the watch folder',
				`${before.watchFolder || '(none)'} → ${after.watchFolder || '(none)'}`
			);
		}

		// A new row starts blank, so like a destination it is only "added" once
		// it has a path.
		const foldersWere = new Map(before.localFolders.map((f) => [f.id, f.path.trim()]));
		for (const folder of after.localFolders) {
			const path = folder.path.trim();
			const old = foldersWere.get(folder.id);
			if (!old) {
				if (path) logAction('settings', 'Added a local folder', path);
			} else if (old !== path) {
				logAction('settings', 'Changed a local folder', `${old} → ${path || '(empty)'}`);
			}
		}
		const foldersNow = new Set(after.localFolders.map((f) => f.id));
		for (const [id, path] of foldersWere) {
			if (!foldersNow.has(id) && path) logAction('settings', 'Removed a local folder', path);
		}

		const zonesWere = new Map(before.timeZones.map((z) => [z.id, z]));
		const zonesNow = new Map(after.timeZones.map((z) => [z.id, z]));
		const zoneName = (z?: TimeZoneChoice) => z?.label.trim() || z?.zone.trim() || 'unnamed';

		for (const [id, tz] of zonesNow) {
			const old = zonesWere.get(id);
			if (!old || (!old.label.trim() && !old.zone.trim())) {
				if (tz.label.trim() || tz.zone.trim()) {
					logAction('settings', `Added time zone ${zoneName(tz)}`, tz.zone);
				}
				continue;
			}
			if (old.label !== tz.label || old.zone !== tz.zone) {
				logAction(
					'settings',
					`Changed time zone ${zoneName(old)}`,
					`${old.label} (${old.zone}) → ${tz.label} (${tz.zone})`
				);
			}
		}

		for (const [id, tz] of zonesWere) {
			if (!zonesNow.has(id)) logAction('settings', `Removed time zone ${zoneName(tz)}`, tz.zone);
		}

		if (before.defaultDestinationId !== after.defaultDestinationId) {
			logAction(
				'settings',
				`Changed default location from ${name(was.get(before.defaultDestinationId ?? ''))} to ${name(now.get(after.defaultDestinationId ?? ''))}`
			);
		}
	}

	async saveNow() {
		this.saving = true;
		try {
			const written = $state.snapshot(this.value);
			await setSetting(GENERAL_KEY, written);
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.saving = false;
		}
	}

	/** The destination a new upload lands in, or null if none is configured. */
	get defaultDestination(): NasDestination | null {
		const { destinations, defaultDestinationId } = this.value;
		if (destinations.length === 0) return null;
		return destinations.find((d) => d.id === defaultDestinationId) ?? destinations[0];
	}

	addDestination() {
		const entry: NasDestination = { id: newId(), label: '', path: '' };
		this.value.destinations = [...this.value.destinations, entry];
		// First one added becomes the default, so there is never a list of
		// destinations with nothing selected.
		if (!this.value.defaultDestinationId) this.value.defaultDestinationId = entry.id;
		this.queueSave();
		this.#queueLog();
	}

	updateDestination(id: string, patch: Partial<NasDestination>) {
		this.value.destinations = this.value.destinations.map((d) =>
			d.id === id ? { ...d, ...patch } : d
		);
		this.queueSave();
		this.#queueLog();
	}

	removeDestination(id: string) {
		this.value.destinations = this.value.destinations.filter((d) => d.id !== id);
		if (this.value.defaultDestinationId === id) {
			this.value.defaultDestinationId = this.value.destinations[0]?.id ?? null;
		}
		this.queueSave();
		this.#queueLog();
	}

	setComplianceBranding(on: boolean) {
		this.value.complianceBranding = on;
		this.queueSave();
		this.#queueLog();
	}

	setWatchFolder(path: string) {
		this.value.watchFolder = path;
		this.queueSave();
		this.#queueLog();
	}

	/** Adds a chosen folder; one already listed (case-insensitively) is left as it is. */
	addLocalFolder(path: string) {
		const clean = path.trim();
		if (!clean) return;
		if (this.value.localFolders.some((f) => f.path.trim().toLowerCase() === clean.toLowerCase())) return;
		this.value.localFolders = [...this.value.localFolders, { id: newId(), path: clean }];
		this.queueSave();
		this.#queueLog();
	}

	setLocalFolder(id: string, path: string) {
		this.value.localFolders = this.value.localFolders.map((f) => (f.id === id ? { ...f, path } : f));
		this.queueSave();
		this.#queueLog();
	}

	removeLocalFolder(id: string) {
		this.value.localFolders = this.value.localFolders.filter((f) => f.id !== id);
		this.queueSave();
		this.#queueLog();
	}

	addTimeZone() {
		const entry: TimeZoneChoice = { id: newId(), label: '', zone: '' };
		this.value.timeZones = [...this.value.timeZones, entry];
		this.queueSave();
		this.#queueLog();
	}

	updateTimeZone(id: string, patch: Partial<TimeZoneChoice>) {
		this.value.timeZones = this.value.timeZones.map((z) => (z.id === id ? { ...z, ...patch } : z));
		this.queueSave();
		this.#queueLog();
	}

	removeTimeZone(id: string) {
		this.value.timeZones = this.value.timeZones.filter((z) => z.id !== id);
		this.queueSave();
		this.#queueLog();
	}

	setDefaultDestination(id: string) {
		this.value.defaultDestinationId = id;
		this.queueSave();
		this.#queueLog();
	}
}

export const general = new GeneralStore();
