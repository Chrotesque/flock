import type { Brand, PlatformId } from './types';

/**
 * The name a brand starts with when there is none yet — the settings a
 * single-brand install already has become this brand. Generic on purpose:
 * the user renames it, and nothing personal belongs in the code.
 */
export const FIRST_BRAND_NAME = 'My brand';

export const BRAND_NAME_MAX = 120;

/** What makes two names the same brand: case and outer spaces do not count. */
export function brandKey(name: string): string {
	return name.trim().toLowerCase();
}

/** Why a name cannot be used, or '' when it can. */
export function brandNameProblem(name: string, brands: Brand[], exceptId = ''): string {
	const trimmed = name.trim();
	if (!trimmed) return 'A brand needs a name.';
	if (trimmed.length > BRAND_NAME_MAX) return `At most ${BRAND_NAME_MAX} characters.`;
	const key = brandKey(trimmed);
	if (brands.some((b) => b.id !== exceptId && brandKey(b.name) === key)) {
		return 'Another brand already has that name.';
	}
	return '';
}

/** "New brand", then "New brand 2", "New brand 3" — the first one free. */
export function nextBrandName(brands: Brand[], stem = 'New brand'): string {
	const taken = new Set(brands.map((b) => brandKey(b.name)));
	if (!taken.has(brandKey(stem))) return stem;
	for (let n = 2; ; n++) {
		const name = `${stem} ${n}`;
		if (!taken.has(brandKey(name))) return name;
	}
}

/** Brands in the user's order; ties (which renumbering prevents) by name. */
export function orderBrands(brands: Brand[]): Brand[] {
	return [...brands].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/**
 * The `app_settings` key of something kept per brand: `templates:<id>`,
 * `recent_tags:<id>`. Keys rather than a field on the brand row, so the
 * existing key/value plumbing — and its per-key writes — serve them as is.
 */
export function brandSettingKey(base: string, brandId: string): string {
	return `${base}:${brandId}`;
}

/** A settings row as far as adoption cares: its id, brand and platform. */
export interface SettingsRowRef {
	id: string;
	brand: string;
	platform: string;
}

/**
 * Settings rows that belong to no brand yet and should become `brandId`'s:
 * every one from before brands existed, but only for platforms the brand has
 * no row for — the (brand, platform) index would refuse a second, and a row
 * the brand already has is the one that counts.
 */
export function rowsToAdopt(rows: SettingsRowRef[], brandId: string, platforms: readonly PlatformId[]) {
	const owned = new Set(rows.filter((r) => r.brand === brandId).map((r) => r.platform));
	const adopt: SettingsRowRef[] = [];
	for (const row of rows) {
		if (row.brand || !platforms.includes(row.platform as PlatformId)) continue;
		if (owned.has(row.platform)) continue;
		owned.add(row.platform);
		adopt.push(row);
	}
	return adopt;
}
