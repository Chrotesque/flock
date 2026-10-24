import { isStatPlatform, type DashFilter, type StatPlatform } from './releases';

/**
 * The Dashboard's Extended Stats: one platform at a time, with how many of
 * its views liked and commented beside the counters. Chosen per browser
 * (`flock.dashboard.extended`). While it is on, the filter's platforms are
 * not in effect: every number on the page is the chosen platform's alone,
 * and the filter's other choices — timeframe, kinds, visibility — still are.
 */
export interface ExtendedStats {
	on: boolean;
	/** The platform shown while on; kept while off, so it comes back as it was. */
	platform: StatPlatform;
}

export const DEFAULT_EXTENDED: ExtendedStats = { on: false, platform: 'youtube' };

/** A stored choice, rebuilt field by field. */
export function readExtended(raw: unknown): ExtendedStats {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return {
		on: r.on === true,
		platform: typeof r.platform === 'string' && isStatPlatform(r.platform) ? r.platform : DEFAULT_EXTENDED.platform
	};
}

/** The filter as the page applies it: with Extended Stats on, its platform alone. */
export function viewFilter(filter: DashFilter, extended: ExtendedStats): DashFilter {
	return extended.on ? { ...filter, platforms: [extended.platform] } : filter;
}

/** A counter as a share of the views, in percent: 12 likes on 1,100 views is 1.09. Null without views to divide by. */
export function perView(count: number | null | undefined, views: number | null | undefined): number | null {
	if (typeof count !== 'number' || typeof views !== 'number' || views <= 0) return null;
	return (count / views) * 100;
}

/**
 * Over several videos: their counts added up against their views added up,
 * each video counted only where both were read — so a video with many views
 * weighs as much as its views do.
 */
export function pooledPerView(rows: { count: number | null | undefined; views: number | null | undefined }[]): number | null {
	let count = 0;
	let views = 0;
	for (const row of rows) {
		if (typeof row.count !== 'number' || typeof row.views !== 'number' || row.views <= 0) continue;
		count += row.count;
		views += row.views;
	}
	return views > 0 ? (count / views) * 100 : null;
}

/** A share in percent, two decimals in the browser's decimal mark: 1.09 %, 1,09 %. */
export function percentWords(rate: number, locale?: string): string {
	return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate)} %`;
}
