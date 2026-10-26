/**
 * The Dashboard's title search: every word typed must be somewhere in the
 * title, in any order and anywhere in it, case and accents aside — "sker"
 * finds "SKER RITUAL", "cafe" finds "Café", "ritual sker" finds it too.
 */

/** Lower case with its accents taken off; length may change ("İ" → "i"). */
function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The words of a search, folded; none for a blank one, which matches every title. */
export function searchWords(query: string): string[] {
	return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * The title folded a character at a time, with where each folded unit
 * came from in the original (`start`/`end`, end exclusive), so a match
 * can be marked in the title as it is shown. A character that folds to
 * nothing (a combining accent) is taken in by the one before it.
 */
function folded(title: string): { text: string; start: number[]; end: number[] } {
	let text = '';
	const start: number[] = [];
	const end: number[] = [];
	let at = 0;
	let last = -1;
	for (const ch of title) {
		const f = fold(ch);
		if (f === '' && last >= 0) {
			for (let k = last; k < end.length; k++) end[k] = at + ch.length;
		} else if (f !== '') {
			last = end.length;
			for (let k = 0; k < f.length; k++) {
				start.push(at);
				end.push(at + ch.length);
			}
			text += f;
		}
		at += ch.length;
	}
	return { text, start, end };
}

/** Whether the title holds every word (`searchWords`); true with none. */
export function matchesTitle(title: string, words: string[]): boolean {
	if (words.length === 0) return true;
	const { text } = folded(title);
	return words.every((word) => text.includes(word));
}

export interface TitlePart {
	text: string;
	hit: boolean;
}

/** The title cut into what a word matched and what it did not, in order; one plain part with no words. */
export function titleParts(title: string, words: string[]): TitlePart[] {
	if (words.length === 0 || title === '') return [{ text: title, hit: false }];
	const { text, start, end } = folded(title);
	const hit = new Array<boolean>(title.length).fill(false);
	for (const word of words) {
		for (let from = text.indexOf(word); from !== -1; from = text.indexOf(word, from + 1)) {
			for (let i = start[from]; i < end[from + word.length - 1]; i++) hit[i] = true;
		}
	}
	const parts: TitlePart[] = [];
	for (let i = 0; i < title.length; i++) {
		const last = parts.at(-1);
		if (last && last.hit === hit[i]) last.text += title[i];
		else parts.push({ text: title[i], hit: hit[i] });
	}
	return parts;
}
