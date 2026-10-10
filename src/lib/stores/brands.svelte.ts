import { createBrand, deleteBrand, ensureBrands, renameBrand, reorderBrands } from '../repo';
import { nextBrandName, orderBrands } from '../brands';
import type { Brand } from '../types';

const CURRENT_KEY = 'flock.brand';

function loadCurrent(): string {
	try {
		return localStorage.getItem(CURRENT_KEY) ?? '';
	} catch {
		return '';
	}
}

function saveCurrent(id: string) {
	try {
		localStorage.setItem(CURRENT_KEY, id);
	} catch {
		// Private windows and blocked site data throw; the choice just is not kept.
	}
}

/**
 * The brands, and the one this browser is working in.
 *
 * One current brand for the whole app: the wizard's picker and the Settings
 * selector are the same choice, so settings edited are the settings the next
 * upload starts from. Remembered per browser, like the calendar's time zone.
 * Every per-brand store reads `currentId`; nothing here reads them back.
 */
class BrandStore {
	list = $state<Brand[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);

	#currentId = $state(loadCurrent());
	#loading: Promise<void> | null = null;

	/** Loads once; `force` reloads. Creates the first brand when there is none. */
	load(force = false): Promise<void> {
		if (!this.#loading || force) this.#loading = this.#fetch();
		return this.#loading;
	}

	async #fetch() {
		this.loading = true;
		try {
			this.list = await ensureBrands();
			this.error = null;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loading = false;
		}
	}

	get ordered(): Brand[] {
		return orderBrands(this.list);
	}

	/** The brand in view: the remembered one while it exists, else the first. */
	get current(): Brand | undefined {
		const ordered = this.ordered;
		return ordered.find((b) => b.id === this.#currentId) ?? ordered[0];
	}

	get currentId(): string {
		return this.current?.id ?? '';
	}

	/** With one brand there is nothing to choose, and pickers stay hidden. */
	get multiple(): boolean {
		return this.list.length > 1;
	}

	byId(id: string): Brand | undefined {
		return this.list.find((b) => b.id === id);
	}

	select(id: string) {
		if (!this.byId(id)) return;
		this.#currentId = id;
		saveCurrent(id);
	}

	/** A new brand, copied from the current one, and switched to. */
	async add(): Promise<Brand> {
		const brand = await createBrand(nextBrandName(this.list), this.list.length, this.current ?? null);
		this.list = [...this.list, brand];
		this.select(brand.id);
		return brand;
	}

	async rename(brand: Brand, name: string) {
		await renameBrand(brand, name);
		this.list = this.list.map((b) => (b.id === brand.id ? { ...b, name: name.trim() } : b));
	}

	async move(id: string, direction: -1 | 1) {
		const ordered = this.ordered;
		const index = ordered.findIndex((b) => b.id === id);
		const swapWith = index + direction;
		if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return;
		[ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
		await reorderBrands(ordered);
		this.list = ordered.map((b, i) => ({ ...b, sort_order: i }));
	}

	/** Refused for the last brand: everything per brand needs one to live in. */
	async remove(brand: Brand) {
		if (this.list.length <= 1) throw new Error('The last brand cannot be deleted.');
		await deleteBrand(brand);
		this.list = this.list.filter((b) => b.id !== brand.id);
	}
}

export const brands = new BrandStore();
