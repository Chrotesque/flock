import { describe, expect, it } from 'vitest';
import { actionWords, firstWord, wordKey } from './logwords';

describe('firstWord', () => {
	it('takes the first word', () => {
		expect(firstWord('Published to youtube')).toBe('Published');
		expect(firstWord('Rescheduled facebook')).toBe('Rescheduled');
		expect(firstWord('  Moved YouTube to Paper Moon')).toBe('Moved');
	});

	it('trims quotes and colons', () => {
		expect(firstWord('Uploaded "A Made-Up Title"')).toBe('Uploaded');
		expect(firstWord('Linked on Jestr: "x"')).toBe('Linked');
		expect(firstWord('Dismissed: TikTok: "Cages" failed')).toBe('Dismissed');
		expect(firstWord('"Quoted" first')).toBe('Quoted');
	});

	it('skips the brand a line is about', () => {
		expect(firstWord('Owls Nest: posts to TikTok as @owls_nest')).toBe('posts');
		expect(firstWord('Paper Moon: posts to Facebook as @PaperMoon')).toBe('posts');
		expect(firstWord('Paper Moon: kept its accounts as chosen ones')).toBe('kept');
	});

	it('keeps the DevTest tag as the word', () => {
		expect(firstWord('DevTest: the combined view adds up Owls Nest, Paper Moon')).toBe('DevTest');
		expect(firstWord('DevTest: Jestr Partner shows Owls Nest')).toBe('DevTest');
	});

	it('gives nothing for an empty action', () => {
		expect(firstWord('')).toBe('');
		expect(firstWord('   ')).toBe('');
		expect(firstWord('"" ')).toBe('');
	});
});

describe('actionWords', () => {
	it('counts each word once, case aside, A to Z', () => {
		expect(
			actionWords([
				'Published to youtube',
				'Moved on YouTube',
				'Deleted facebook',
				'published to tiktok',
				'Paper Moon: posts to TikTok as @papermoon',
				'',
				'Deleted Facebook'
			])
		).toEqual([
			{ key: 'deleted', label: 'Deleted', count: 2 },
			{ key: 'moved', label: 'Moved', count: 1 },
			{ key: 'posts', label: 'Posts', count: 1 },
			{ key: 'published', label: 'Published', count: 2 }
		]);
	});

	it('keys match the words', () => {
		expect(wordKey('Owls Nest: posts to TikTok as @x')).toBe('posts');
		expect(wordKey('DevTest: Notes: comments seen')).toBe('devtest');
	});
});
