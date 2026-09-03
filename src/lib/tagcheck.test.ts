import { describe, expect, it } from 'vitest';
import { checkTags } from './tagcheck';

const TEXT = 'The Sinking City 2 — first blind playthrough of the Frogwares detective horror sequel';

function kinds(tags: string[], text = TEXT, limit = 500) {
	return checkTags(tags, text, limit).findings.map((f) => f.kind);
}

describe('checkTags', () => {
	it('reports nothing to judge on an empty list', () => {
		const health = checkTags([], TEXT);
		expect(health.score).toBe(0);
		expect(health.findings.map((f) => f.kind)).toEqual(['empty']);
	});

	it('leaves a well-matched list alone', () => {
		const tags = ['sinking city 2', 'frogwares', 'detective horror', 'blind playthrough', 'sequel'];
		const health = checkTags(tags, TEXT);
		expect(health.score).toBe(100);
		expect(health.findings.filter((f) => f.cost > 0)).toEqual([]);
	});

	it('treats going over the limit as an error, not a warning', () => {
		const health = checkTags(['sinking city 2', 'frogwares'], TEXT, 10);
		const over = health.findings.find((f) => f.kind === 'over-budget');
		expect(over?.severity).toBe('error');
		expect(health.score).toBeLessThan(70);
	});

	it('flags tags with no word in common with the video', () => {
		const health = checkTags(['frogwares', 'knitting patterns'], TEXT);
		const finding = health.findings.find((f) => f.kind === 'unmentioned');
		expect(finding?.tags).toEqual(['knitting patterns']);
		expect(finding?.cost).toBeGreaterThan(0);
	});

	it('does not count noise words as relevance', () => {
		// "the" and "of" appear in the text, but prove nothing.
		const health = checkTags(['the of'], TEXT);
		expect(health.findings.some((f) => f.kind === 'unmentioned')).toBe(false);
	});

	it('reports overlap without deducting for it', () => {
		const tags = ['sinking city', 'sinking city 2 playthrough'];
		const finding = checkTags(tags, TEXT).findings.find((f) => f.kind === 'overlap');
		expect(finding?.tags).toEqual(['sinking city']);
		expect(finding?.cost).toBe(0);
	});

	it('notices a nearly-full budget separately from an overflowing one', () => {
		// 9 + ("detective horror" is 16 + 2 for the quotes) + 1 comma = 28.
		const tags = ['frogwares', 'detective horror'];
		expect(checkTags(tags, TEXT, 29).used).toBe(28);
		expect(kinds(tags, TEXT, 29)).toContain('near-budget');
		expect(kinds(tags, TEXT, 27)).toContain('over-budget');
	});

	it('never returns a score outside 0-100', () => {
		const awful = Array.from({ length: 40 }, (_, i) => `completely unrelated phrase number ${i}`);
		const health = checkTags(awful, TEXT, 100);
		expect(health.score).toBeGreaterThanOrEqual(0);
		expect(health.score).toBeLessThanOrEqual(100);
	});

	it('explains every point it takes off', () => {
		const health = checkTags(['knitting patterns', 'crochet'], TEXT, 500);
		const deducted = health.findings.reduce((total, f) => total + f.cost, 0);
		expect(health.score).toBe(100 - deducted);
	});
});
