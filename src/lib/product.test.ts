import { describe, expect, it } from 'vitest';
import { normalCase, productLabel } from './product';

describe('normalCase', () => {
	it('capitalises a name written in capitals as a title', () => {
		expect(normalCase('LANTERN KEEP')).toBe('Lantern Keep');
		expect(normalCase('TOWER OF THE OWLS')).toBe('Tower of the Owls');
		expect(normalCase('WAKE TO MY SONG!')).toBe('Wake to My Song!');
	});

	it('capitalises small words that start or end the name, or follow a colon', () => {
		expect(normalCase('THE OWL WHO SAT ON')).toBe('The Owl Who Sat On');
		expect(normalCase('MOTH: THE LONG NIGHT')).toBe('Moth: The Long Night');
	});

	it('keeps roman numerals, hyphens and apostrophes right', () => {
		expect(normalCase('PAPER MOON II')).toBe('Paper Moon II');
		expect(normalCase('HALF-LIT HALLS')).toBe('Half-Lit Halls');
		expect(normalCase("DON'T LOOK UP")).toBe("Don't Look Up");
	});

	it('leaves a name with any lower case as it was written', () => {
		expect(normalCase('Beyond the Owls: Nightwatch')).toBe('Beyond the Owls: Nightwatch');
		expect(normalCase('MOTH and Me')).toBe('MOTH and Me');
		expect(normalCase('123')).toBe('123');
		expect(normalCase('')).toBe('');
	});
});

describe('productLabel', () => {
	it('shows the part before a colon', () => {
		expect(productLabel('Beyond the Owls: Nightwatch')).toBe('Beyond the Owls');
		expect(productLabel('BALL TOWER: MERGE PARTY')).toBe('Ball Tower');
	});

	it('shows a name without a colon whole, capitalised as a title', () => {
		expect(productLabel('  FROG POND ')).toBe('Frog Pond');
		expect(productLabel('Plinko Lab')).toBe('Plinko Lab');
	});

	it('shows the whole name when nothing comes before the colon', () => {
		expect(productLabel(':ECHO')).toBe(':Echo');
		expect(productLabel(': Echo')).toBe(': Echo');
	});
});
