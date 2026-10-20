import { newId } from '../id';
import { getSetting, setSetting } from '../repo';
import { logAction } from '../log';
import { settle, LOG_SETTLE_MS } from '../settle';
import type { GeneralSettings, NasDestination, WatchFolder } from '../types';
import type { TimeZoneChoice } from '../timezones';
import { DEFAULT_COLUMNS, columnWords, readColumns, type DashColumn } from '../dashcolumns';
import {
	folderKind,
	importFolder,
	legacyWatchKeys,
	migrateWatchFolders,
	readFolders,
	sameFolder
} from '../folders';

/** The two folder lists, which share their rows' shape and their methods. */
export type FolderListKey = 'watchFolders' | 'projectFolders';

const FOLDER_WORDS: Record<FolderListKey, string> = {
	watchFolders: 'watch folder',
	projectFolders: 'project folder'
};

export const GENERAL_KEY = 'general';

export const DEFAULT_GENERAL: GeneralSettings = {
	destinations: [],
	defaultDestinationId: null,
	watchFolders: [],
	importFolderId: null,
	projectFolders: [],
	complianceBranding: true,
	jestrIntegration: false,
	showTodo: true,
	timeZones: [],
	dashboardColumns: DEFAULT_COLUMNS
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
				// One list since the NAS watch folder and the local ones merged;
				// a row from before is read into it (folders.ts).
				watchFolders: migrateWatchFolders(stored as Record<string, unknown>, newId),
				importFolderId: typeof stored.importFolderId === 'string' ? stored.importFolderId : null,
				projectFolders: readFolders(stored.projectFolders),
				complianceBranding: stored.complianceBranding ?? true,
				jestrIntegration: stored.jestrIntegration === true,
				showTodo: stored.showTodo !== false,
				timeZones: Array.isArray(stored.timeZones) ? stored.timeZones : [],
				dashboardColumns: readColumns(stored.dashboardColumns)
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

		if (before.jestrIntegration !== after.jestrIntegration) {
			logAction('settings', `Turned the Jestr integration ${after.jestrIntegration ? 'on' : 'off'}`);
		}

		if (before.showTodo !== after.showTodo) {
			logAction('settings', `${after.showTodo ? 'Showed' : 'Hid'} the To finish indicator`);
		}

		const columnsWere = columnWords(before.dashboardColumns);
		const columnsNow = columnWords(after.dashboardColumns);
		if (columnsWere !== columnsNow) logAction('settings', 'Changed the Dashboard columns', `${columnsWere} → ${columnsNow}`);

		for (const key of ['watchFolders', 'projectFolders'] as const) this.#logFolders(key, before, after);

		const importWas = importFolder(before.watchFolders, before.importFolderId);
		const importNow = importFolder(after.watchFolders, after.importFolderId);
		if (importWas && importNow && importWas.id !== importNow.id) {
			logAction('settings', 'Changed where local videos are copied', `${importWas.path} → ${importNow.path}`);
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

	/**
	 * One entry per folder added, changed or removed. A new row starts blank,
	 * so like a destination it is only "added" once it has a path.
	 */
	#logFolders(key: FolderListKey, before: GeneralSettings, after: GeneralSettings) {
		const word = FOLDER_WORDS[key];
		const kind = (path: string) => (folderKind(path) === 'network' ? 'network ' : 'local ');
		const was = new Map(before[key].map((f) => [f.id, f.path.trim()]));
		for (const folder of after[key]) {
			const path = folder.path.trim();
			const old = was.get(folder.id);
			if (!old) {
				if (path) logAction('settings', `Added a ${kind(path)}${word}`, path);
			} else if (old !== path) {
				logAction('settings', `Changed a ${word}`, `${old} → ${path || '(empty)'}`);
			}
		}
		const now = new Set(after[key].map((f) => f.id));
		for (const [id, path] of was) {
			if (!now.has(id) && path) logAction('settings', `Removed a ${kind(path)}${word}`, path);
		}
	}

	async saveNow() {
		this.saving = true;
		try {
			const value = $state.snapshot(this.value) as GeneralSettings;
			// Plus the two keys a worker from before the merge reads — see
			// legacyWatchKeys. Load ignores them.
			const written = { ...value, ...legacyWatchKeys(value.watchFolders, value.importFolderId) };
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

	setJestrIntegration(on: boolean) {
		this.value.jestrIntegration = on;
		this.queueSave();
		this.#queueLog();
	}

	setShowTodo(on: boolean) {
		this.value.showTodo = on;
		this.queueSave();
		this.#queueLog();
	}

	/** The Dashboard list's columns, as Settings → Dashboard arranges them. */
	setDashboardColumns(next: DashColumn[]) {
		this.value.dashboardColumns = readColumns(next);
		this.queueSave();
		this.#queueLog();
	}

	/**
	 * Adds a folder; one already in the list (however it is cased) is left as
	 * it is. An empty path adds a blank row to type a path into; `chosen`
	 * marks one that came back from the folder dialog.
	 */
	addFolder(key: FolderListKey, path = '', chosen = false) {
		const clean = path.trim();
		if (clean && this.value[key].some((f) => sameFolder(f.path, clean))) return;
		this.value[key] = [...this.value[key], { id: newId(), path: clean, ...(chosen ? { chosen } : {}) }];
		this.queueSave();
		this.#queueLog();
	}

	/** A typed edit, or with `chosen` the dialog's answer replacing the path. */
	setFolder(key: FolderListKey, id: string, path: string, chosen?: boolean) {
		this.value[key] = this.value[key].map((f: WatchFolder) =>
			f.id === id ? { ...f, path, ...(chosen ? { chosen } : {}) } : f
		);
		this.queueSave();
		this.#queueLog();
	}

	removeFolder(key: FolderListKey, id: string) {
		this.value[key] = this.value[key].filter((f: WatchFolder) => f.id !== id);
		if (key === 'watchFolders' && this.value.importFolderId === id) this.value.importFolderId = null;
		this.queueSave();
		this.#queueLog();
	}

	/** The network watch folder local picks are copied into. */
	setImportFolder(id: string) {
		this.value.importFolderId = id;
		this.queueSave();
		this.#queueLog();
	}

	/** Where local picks are copied, or null with no network watch folder. */
	get importFolder(): WatchFolder | null {
		return importFolder(this.value.watchFolders, this.value.importFolderId);
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
