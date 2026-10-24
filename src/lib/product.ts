/**
 * How an upload's product name is shown (the Calendar's boxes and hover
 * card): the part before a colon — "Ball Guys" for "Ball Guys: Merge
 * Party" — and, for a name written all in capitals, as a title is
 * capitalised. A name with any lower case is taken as written: that was
 * a choice. The name itself is stored as typed.
 */

/** Words a title leaves lower case, unless they start or end it. */
const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'at', 'by', 'in', 'of', 'on', 'to', 'as', 'vs']);

/** Roman numerals stay capitals: "Half-Life II". */
const ROMAN = /^[IVX]+$/;

function capitalise(word: string): string {
	if (ROMAN.test(word)) return word;
	// Each part of a hyphenated word; after an apostrophe it stays lower ("Don't").
	return word
		.toLowerCase()
		.split('-')
		.map((part) => part.replace(/\p{L}/u, (letter) => letter.toUpperCase()))
		.join('-');
}

/** A name in capitals only, capitalised as a title; any other name as it is. */
export function normalCase(name: string): string {
	if (!/\p{Lu}/u.test(name) || /\p{Ll}/u.test(name)) return name;
	// Each part after a colon is a title of its own: its first word is capitalised.
	return name
		.split(/(:\s*)/)
		.map((part, i) => {
			if (i % 2 === 1) return part;
			const words = part.split(/(\s+)/);
			const real = words.map((w, j) => (j % 2 === 0 && w ? j : -1)).filter((j) => j >= 0);
			const first = real[0];
			const last = real[real.length - 1];
			return words
				.map((word, j) => {
					if (j % 2 === 1 || !word) return word;
					const bare = word.toLowerCase().replace(/[^\p{L}]/gu, '');
					return j !== first && j !== last && SMALL.has(bare) ? word.toLowerCase() : capitalise(word);
				})
				.join('');
		})
		.join('');
}

/** What the Calendar shows for a product name: the part before a colon, capitalised as a title. */
export function productLabel(name: string): string {
	const trimmed = name.trim();
	const colon = trimmed.indexOf(':');
	const head = colon > 0 ? trimmed.slice(0, colon).trim() : trimmed;
	return normalCase(head || trimmed);
}
