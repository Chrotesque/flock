import { getSetting, setSetting } from '../repo';
import type { GeneralSettings, NasDestination } from '../types';

export const GENERAL_KEY = 'general';

export const DEFAULT_GENERAL: GeneralSettings = {
	destinations: [],
	defaultDestinationId: null,
	defaultReleaseTime: '09:00'
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

	async load(force = false) {
		if (this.#loaded && !force) return;
		this.loading = true;
		try {
			const stored = await getSetting<Partial<GeneralSettings>>(GENERAL_KEY, {});
			// Merged rather than replaced, so a key added to DEFAULT_GENERAL after
			// the row was written does not come back undefined.
			this.value = {
				...DEFAULT_GENERAL,
				...stored,
				destinations: Array.isArray(stored.destinations) ? stored.destinations : []
			};
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
			await setSetting(GENERAL_KEY, $state.snapshot(this.value));
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
		const entry: NasDestination = { id: crypto.randomUUID(), label: '', path: '' };
		this.value.destinations = [...this.value.destinations, entry];
		// First one added becomes the default, so there is never a list of
		// destinations with nothing selected.
		if (!this.value.defaultDestinationId) this.value.defaultDestinationId = entry.id;
		this.queueSave();
	}

	updateDestination(id: string, patch: Partial<NasDestination>) {
		this.value.destinations = this.value.destinations.map((d) =>
			d.id === id ? { ...d, ...patch } : d
		);
		this.queueSave();
	}

	removeDestination(id: string) {
		this.value.destinations = this.value.destinations.filter((d) => d.id !== id);
		if (this.value.defaultDestinationId === id) {
			this.value.defaultDestinationId = this.value.destinations[0]?.id ?? null;
		}
		this.queueSave();
	}

	setDefaultDestination(id: string) {
		this.value.defaultDestinationId = id;
		this.queueSave();
	}

	setReleaseTime(time: string) {
		this.value.defaultReleaseTime = time || '09:00';
		this.queueSave();
	}
}

export const general = new GeneralStore();
