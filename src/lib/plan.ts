import { PLATFORMS } from './platforms';
import { adapt } from './filters';
import { draft } from './stores/draft.svelte';
import { settings } from './stores/settings.svelte';
import { relativeTo, isoDate, makeTime, mergeTagGroups } from './format';
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
	/** Publish on pickup instead of at a slot. */
	immediate: boolean;
	hits: number;
	errors: number;
	overLimit: boolean;
	allHits: FilterHit[];
}

/**
 * A platform's options as they will be published.
 *
 * For a platform with a tag budget this also collapses its tag boxes into the
 * single `tags` list the API actually takes, de-duplicated across boxes. The
 * boxes are kept alongside it so the record shows how the list was assembled,
 * but `tags` is the field anything downstream reads.
 */
function resolveOptions(platform: PlatformId, def: (typeof PLATFORMS)[PlatformId]): OptionValues {
	const resolved: OptionValues = {
		...settings.defaultsFor(platform),
		...(draft.overrides[platform] ?? {})
	};
	const keys = def.tagBudget?.keys;
	if (keys && keys.length > 0) resolved.tags = mergeTagGroups(resolved, keys);
	return resolved;
}

/**
 * Resolves the draft against each selected platform's saved settings.
 *
 * Each platform is composed separately, so the text going in is that
 * platform's own — the rules then run over it, exactly once, here.
 *
 * This is the single place the adaptation rules are applied for real: the
 * confirmation screen renders these rows, and the same rows are written to
 * PocketBase. What is reviewed is therefore exactly what is stored — the
 * publishing worker never re-runs the filters.
 */
export function buildPlan(): PlanRow[] {
	return settings.available
		.filter((entry) => draft.isSelected(entry.platform))
		.map((entry) => {
			const platform = entry.platform;
			const def = PLATFORMS[platform];
			const text = draft.textFor(platform);
			const result = adapt(text.title, text.description, entry.filters);
			// An immediate release is stamped with the moment of confirmation. By
			// the time the worker reads it that instant has passed, which is exactly
			// what makes it publish straight away rather than hand over a release
			// time — no special case needed anywhere downstream.
			const immediate = draft.isImmediate(platform);
			const now = new Date();
			const when = immediate
				? { date: isoDate(now), time: makeTime(now.getHours(), now.getMinutes()) }
				: draft.scheduleFor(platform);

			return {
				platform,
				title: result.title.output,
				description: result.description.output,
				options: resolveOptions(platform, def),
				date: when.date,
				time: when.time,
				relative: immediate
					? 'as soon as the worker picks it up'
					: relativeTo(when.date, when.time),
				immediate,
				hits: result.totalHits,
				errors: result.errors,
				overLimit:
					result.title.output.length > def.titleLimit ||
					result.description.output.length > def.descriptionLimit,
				allHits: [...result.title.hits, ...result.description.hits]
			};
		});
}
