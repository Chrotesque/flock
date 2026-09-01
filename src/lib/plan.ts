import { PLATFORMS } from './platforms';
import { adapt } from './filters';
import { draft } from './stores/draft.svelte';
import { settings } from './stores/settings.svelte';
import { relativeTo } from './format';
import type { FilterHit, OptionValues, PlatformId } from './types';

/** One platform's fully resolved plan: what will actually be published, and when. */
export interface PlanRow {
	platform: PlatformId;
	title: string;
	description: string;
	options: OptionValues;
	date: string;
	time: string;
	relative: string;
	hits: number;
	errors: number;
	overLimit: boolean;
	allHits: FilterHit[];
}

/**
 * Resolves the draft against each selected platform's saved settings.
 *
 * This is the single place the adaptation rules are applied for real: the
 * confirmation screen renders these rows, and the same rows are written to
 * PocketBase. What is reviewed is therefore exactly what is stored — the
 * publishing worker never re-runs the filters.
 */
export function buildPlan(): PlanRow[] {
	return settings.available
		.filter((entry) => draft.selected[entry.platform])
		.map((entry) => {
			const platform = entry.platform;
			const def = PLATFORMS[platform];
			const result = adapt(draft.title, draft.description, entry.filters);
			const when = draft.scheduleFor(platform);

			return {
				platform,
				title: result.title.output,
				description: result.description.output,
				options: { ...settings.defaultsFor(platform), ...(draft.overrides[platform] ?? {}) },
				date: when.date,
				time: when.time,
				relative: relativeTo(when.date, when.time),
				hits: result.totalHits,
				errors: result.errors,
				overLimit:
					result.title.output.length > def.titleLimit ||
					result.description.output.length > def.descriptionLimit,
				allHits: [...result.title.hits, ...result.description.hits]
			};
		});
}
