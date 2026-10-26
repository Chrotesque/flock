import { describe, expect, it } from 'vitest';
import { matchesTitle, searchWords, titleParts } from './titlesearch';

const marked = (title: string, query: string) =>
	titleParts(title, searchWords(query))
		.map((p) => (p.hit ? `[${p.text}]` : p.text))
		.join('');

describe('searchWords', () => {
	it('folds case and accents and splits on any space', () => {
		expect(searchWords('  Café   RITUAL\t')).toEqual(['cafe', 'ritual']);
	});

	it('has no words for a blank search', () => {
		expect(searchWords('   ')).toEqual([]);
		expect(searchWords('')).toEqual([]);
	});
});

describe('matchesTitle', () => {
	it('matches every title with no words', () => {
		expect(matchesTitle('Anything', [])).toBe(true);
	});

	it('finds a word anywhere in the title, case aside', () => {
		expect(matchesTitle('The SKER RITUAL is out', searchWords('ritual'))).toBe(true);
		expect(matchesTitle('The SKER RITUAL is out', searchWords('itua'))).toBe(true);
	});

	it('needs every word, in any order', () => {
		expect(matchesTitle('Sker Ritual', searchWords('ritual sker'))).toBe(true);
		expect(matchesTitle('Sker Ritual', searchWords('ritual goblin'))).toBe(false);
	});

	it('takes accents off both sides', () => {
		expect(matchesTitle('Café Débris', searchWords('cafe debris'))).toBe(true);
		expect(matchesTitle('Cafe', searchWords('café'))).toBe(true);
		// A title written with combining accents.
		expect(matchesTitle('Café', searchWords('cafe'))).toBe(true);
	});

	it('does not match across what is not there', () => {
		expect(matchesTitle('Isle Goblin', searchWords('islegoblin'))).toBe(false);
	});
});

describe('titleParts', () => {
	it('is the title whole with no words', () => {
		expect(titleParts('Sker Ritual', [])).toEqual([{ text: 'Sker Ritual', hit: false }]);
	});

	it('marks each word where it is, in the title as written', () => {
		expect(marked('The SKER RITUAL is out', 'ritual sker')).toBe('The [SKER] [RITUAL] is out');
	});

	it('marks every occurrence, and overlapping words as one stretch', () => {
		expect(marked('ha ha', 'ha')).toBe('[ha] [ha]');
		expect(marked('Goblin', 'gob lin bli')).toBe('[Goblin]');
	});

	it('marks the accented letters themselves', () => {
		expect(marked('Café Débris', 'cafe')).toBe('[Café] Débris');
		expect(marked('Café x', 'cafe')).toBe('[Café] x');
	});

	it('keeps characters outside the basic plane whole', () => {
		expect(marked('🦉 Owls Nest', 'owls')).toBe('🦉 [Owls] Nest');
	});
});
