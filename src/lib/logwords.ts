/**
 * The Log's second filter bar: the first word of each action — "Published",
 * "Moved", "Linked" — so a long log can be cut down before searching it.
 */

export interface ActionWord {
	/** Lower case: "Deleted facebook" and "Deleted Facebook" are one word. */
	key: string;
	label: string;
	count: number;
}

/** Prefixes that are the word themselves, not the subject of the line. */
const TAGS = new Set(['devtest']);

/**
 * Capitalised words and a colon before a lower-case phrase name the brand a
 * line is about ("Owls Nest: posts to TikTok as @x"), so the word is the one
 * after them. "Dismissed: TikTok: …" goes on with a capital and keeps its own.
 */
const SUBJECT = /^((?:[A-Z][^\s:]*\s+)*[A-Z][^\s:]*):\s+(?=[a-z])/;

/** The word an action starts with, quotes and colons trimmed off. */
export function firstWord(action: string): string {
	let text = action.trim();
	const subject = SUBJECT.exec(text);
	if (subject && !TAGS.has(subject[1].toLowerCase())) text = text.slice(subject[0].length);
	const word = text.split(/\s+/, 1)[0] ?? '';
	return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function wordKey(action: string): string {
	return firstWord(action).toLowerCase();
}

/** Every first word among the actions with how many start with it, A to Z. */
export function actionWords(actions: string[]): ActionWord[] {
	const byKey = new Map<string, ActionWord>();
	for (const action of actions) {
		const word = firstWord(action);
		if (!word) continue;
		const key = word.toLowerCase();
		const seen = byKey.get(key);
		if (seen) seen.count++;
		else byKey.set(key, { key, label: word[0].toUpperCase() + word.slice(1), count: 1 });
	}
	return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
