import { tagListLength } from './format';

/**
 * A local health check for a tag list.
 *
 * Emphatically **not** vidIQ's rating. That one is a proprietary model over
 * their own search data, it is not in their API, and nothing here could
 * reconstruct it. This measures only what flock can see for itself: whether the
 * list fits, whether it repeats itself, and whether the tags have anything to
 * do with the video's own words.
 *
 * The rule for deductions is deliberately conservative — points only come off
 * for things that are unambiguously wasteful. Anything arguable (a broad tag
 * alongside a specific one, say, which is a legitimate strategy) is reported
 * without a penalty, because a confident number built on a guess is worse than
 * no number.
 */

export type Severity = 'error' | 'warn' | 'note';

export interface TagFinding {
	kind: string;
	severity: Severity;
	/** What is wrong, in one line. */
	message: string;
	/** The tags it applies to, for highlighting. */
	tags: string[];
	/** Points this took off, so the score is never a black box. */
	cost: number;
}

export interface TagHealth {
	score: number;
	used: number;
	limit: number;
	findings: TagFinding[];
}

/** Words too common to prove anything about relevance. */
const NOISE = new Set([
	'a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
	'is', 'it', 'my', 'your', 'this', 'that', 'vs', 'part'
]);

function words(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9']+/)
		.filter((word) => word.length > 0);
}

function meaningful(value: string): string[] {
	return words(value).filter((word) => !NOISE.has(word));
}

/**
 * Rates a tag list against what the video itself says.
 *
 * `text` is the title and description together — the tags are supposed to
 * describe that, so it is the only relevance signal available locally.
 */
export function checkTags(tags: string[], text: string, limit = 500): TagHealth {
	const used = tagListLength(tags);
	const findings: TagFinding[] = [];

	if (tags.length === 0) {
		return {
			score: 0,
			used,
			limit,
			findings: [
				{
					kind: 'empty',
					severity: 'note',
					message: 'No tags yet.',
					tags: [],
					cost: 0
				}
			]
		};
	}

	let score = 100;
	const take = (points: number) => {
		score -= points;
		return points;
	};

	// Over the limit is the only fatal one: the upload is rejected outright.
	if (used > limit) {
		findings.push({
			kind: 'over-budget',
			severity: 'error',
			message: `${used} characters against a ${limit} limit — the upload would be rejected.`,
			tags: [],
			cost: take(40)
		});
	} else if (used > limit * 0.95) {
		findings.push({
			kind: 'near-budget',
			severity: 'warn',
			message: `${used} of ${limit} characters used — almost no room left.`,
			tags: [],
			cost: take(5)
		});
	}

	// Tags whose words appear nowhere in the video's own text. A tag you never
	// say is the weakest kind there is.
	const haystack = new Set(meaningful(text));
	const unmentioned = tags.filter((tag) => {
		const parts = meaningful(tag);
		if (parts.length === 0) return false;
		return !parts.some((part) => haystack.has(part));
	});

	if (unmentioned.length > 0) {
		findings.push({
			kind: 'unmentioned',
			severity: 'warn',
			message:
				`${unmentioned.length} ${unmentioned.length === 1 ? 'tag has' : 'tags have'} no word in ` +
				'common with the title or description.',
			tags: unmentioned,
			cost: take(Math.min(25, unmentioned.length * 3))
		});
	}

	// Long tags cost disproportionately, and the quotes on a multi-word tag are
	// charged too.
	const longTags = tags.filter((tag) => tag.length > 30);
	if (longTags.length > 0) {
		findings.push({
			kind: 'long',
			severity: 'note',
			message: `${longTags.length} ${longTags.length === 1 ? 'tag is' : 'tags are'} over 30 characters.`,
			tags: longTags,
			cost: take(Math.min(12, longTags.length * 3))
		});
	}

	// Reported, never penalised: pairing a broad tag with a specific one is a
	// real strategy, not a mistake. Worth seeing, not worth judging.
	const overlaps: string[] = [];
	const sets = tags.map((tag) => ({ tag, parts: new Set(meaningful(tag)) }));
	for (const a of sets) {
		if (a.parts.size === 0) continue;
		const inside = sets.some(
			(b) => b.tag !== a.tag && b.parts.size > a.parts.size && [...a.parts].every((p) => b.parts.has(p))
		);
		if (inside) overlaps.push(a.tag);
	}
	if (overlaps.length > 0) {
		findings.push({
			kind: 'overlap',
			severity: 'note',
			message:
				`${overlaps.length} ${overlaps.length === 1 ? 'tag is' : 'tags are'} fully contained in a ` +
				'longer one. Often deliberate — flagged only so the spend is visible.',
			tags: overlaps,
			cost: 0
		});
	}

	// Plenty of budget left and very little in it.
	if (tags.length < 5 && used < limit * 0.4) {
		findings.push({
			kind: 'sparse',
			severity: 'note',
			message: `Only ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}, using ${used} of ${limit} characters.`,
			tags: [],
			cost: take(10)
		});
	}

	return { score: Math.max(0, Math.min(100, score)), used, limit, findings };
}
