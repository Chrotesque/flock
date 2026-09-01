import { describe, expect, it } from 'vitest';
import { applyFilters, adapt } from './filters';
import type { FilterRule } from './types';

function rule(partial: Partial<FilterRule>): FilterRule {
	return {
		id: partial.id ?? Math.random().toString(36).slice(2),
		enabled: true,
		find: '',
		replace: '',
		target: 'both',
		mode: 'literal',
		caseSensitive: false,
		...partial
	};
}

describe('applyFilters', () => {
	it('replaces every literal occurrence and counts them', () => {
		const res = applyFilters('a link, a link', [rule({ find: 'link', replace: 'url' })], 'title');
		expect(res.output).toBe('a url, a url');
		expect(res.hits[0].count).toBe(2);
	});

	it('is case-insensitive by default and case-sensitive on request', () => {
		expect(applyFilters('Link link', [rule({ find: 'link', replace: 'x' })], 'title').output).toBe(
			'x x'
		);
		expect(
			applyFilters('Link link', [rule({ find: 'link', replace: 'x', caseSensitive: true })], 'title')
				.output
		).toBe('Link x');
	});

	it('treats literal mode as literal, not regex', () => {
		const res = applyFilters('cost is 5$ (max)', [rule({ find: '(max)', replace: 'top' })], 'title');
		expect(res.output).toBe('cost is 5$ top');
	});

	it('keeps a dollar sign in the replacement intact', () => {
		const res = applyFilters('price', [rule({ find: 'price', replace: '$5' })], 'title');
		expect(res.output).toBe('$5');
	});

	it('supports regex mode with capture groups', () => {
		const res = applyFilters(
			'see youtube.com/watch?v=abc for more',
			[
				rule({
					mode: 'regex',
					find: 'youtube\\.com/watch\\?v=(\\w+)',
					replace: 'the link in bio ($1)'
				})
			],
			'description'
		);
		expect(res.output).toBe('see the link in bio (abc) for more');
	});

	it('reports a bad regex instead of throwing', () => {
		const res = applyFilters(
			'text',
			[rule({ mode: 'regex', find: '([unclosed', replace: 'x' })],
			'title'
		);
		expect(res.output).toBe('text');
		expect(res.hits[0].error).toBeTruthy();
	});

	it('skips disabled rules, empty patterns and non-matching targets', () => {
		expect(
			applyFilters('keep', [rule({ find: 'keep', replace: 'x', enabled: false })], 'title').output
		).toBe('keep');
		expect(applyFilters('keep', [rule({ find: '', replace: 'x' })], 'title').output).toBe('keep');
		expect(
			applyFilters('keep', [rule({ find: 'keep', replace: 'x', target: 'description' })], 'title')
				.output
		).toBe('keep');
	});

	it('records no hit when a rule matches nothing', () => {
		expect(applyFilters('abc', [rule({ find: 'zzz', replace: 'x' })], 'title').hits).toHaveLength(0);
	});

	it('chains rules in order', () => {
		const res = applyFilters(
			'one',
			[rule({ find: 'one', replace: 'two' }), rule({ find: 'two', replace: 'three' })],
			'title'
		);
		expect(res.output).toBe('three');
	});
});

describe('adapt', () => {
	it('runs both fields and totals the hits', () => {
		const rules = [rule({ find: 'x', replace: 'y' })];
		const res = adapt('x', 'x x', rules);
		expect(res.title.output).toBe('y');
		expect(res.description.output).toBe('y y');
		expect(res.totalHits).toBe(3);
		expect(res.errors).toBe(0);
	});
});
