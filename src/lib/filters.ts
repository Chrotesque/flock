import type { FilterHit, FilterResult, FilterRule } from './types';

function escapeRegex(source: string): string {
	return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `$` is special in a replacement string (`$&`, `$1`, `$$`...). In literal mode
 * the user means a dollar sign, so it has to be doubled before handing it to
 * String.replace.
 */
function escapeReplacement(source: string): string {
	return source.replace(/\$/g, '$$$$');
}

export function newRule(partial: Partial<FilterRule> = {}): FilterRule {
	return {
		id: crypto.randomUUID(),
		enabled: true,
		find: '',
		replace: '',
		target: 'both',
		mode: 'literal',
		caseSensitive: false,
		...partial
	};
}

function appliesTo(rule: FilterRule, field: 'title' | 'description'): boolean {
	return rule.target === 'both' || rule.target === field;
}

/**
 * Runs a platform's adaptation rules over one field, in order, and reports
 * which ones actually fired. Rules see the output of the rules before them,
 * so they chain.
 *
 * A rule that cannot compile (bad regex) is skipped and reported via
 * `hit.error` rather than throwing — a typo in settings must never be able to
 * break the compose screen.
 */
export function applyFilters(
	text: string,
	rules: FilterRule[],
	field: 'title' | 'description'
): FilterResult {
	let output = text;
	const hits: FilterHit[] = [];

	for (const rule of rules) {
		if (!rule.enabled || !rule.find || !appliesTo(rule, field)) continue;

		const flags = rule.caseSensitive ? 'g' : 'gi';
		let pattern: RegExp;
		try {
			pattern = new RegExp(rule.mode === 'regex' ? rule.find : escapeRegex(rule.find), flags);
		} catch (err) {
			hits.push({
				ruleId: rule.id,
				find: rule.find,
				replace: rule.replace,
				count: 0,
				error: err instanceof Error ? err.message : 'Invalid pattern'
			});
			continue;
		}

		const count = [...output.matchAll(pattern)].length;
		if (count === 0) continue;

		const replacement = rule.mode === 'regex' ? rule.replace : escapeReplacement(rule.replace);
		output = output.replace(pattern, replacement);

		hits.push({ ruleId: rule.id, find: rule.find, replace: rule.replace, count });
	}

	return { output, hits };
}

/** Both fields at once — what the compose screen and confirmation screen use. */
export function adapt(
	title: string,
	description: string,
	rules: FilterRule[]
): { title: FilterResult; description: FilterResult; totalHits: number; errors: number } {
	const t = applyFilters(title, rules, 'title');
	const d = applyFilters(description, rules, 'description');
	const all = [...t.hits, ...d.hits];
	return {
		title: t,
		description: d,
		totalHits: all.reduce((sum, h) => sum + h.count, 0),
		errors: all.filter((h) => h.error).length
	};
}
