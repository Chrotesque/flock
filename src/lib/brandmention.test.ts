import { describe, expect, it } from 'vitest';
import { brandTerms, mentionWords, otherBrandMentions, postTexts, squash } from './brandmention';
import type { Account, Brand } from './types';

const account = (platform: Account['platform'], account_id: string, handle: string, name: string): Account => ({
	id: account_id,
	platform,
	account_id,
	handle,
	name,
	details: null,
	error: '',
	fetched_at: ''
});

const accounts: Account[] = [
	account('youtube', 'UC1', '@owlsnest', "Owl's Nest"),
	account('instagram', 'ig1', 'owls.nest.daily', 'Owls Nest'),
	account('youtube', 'UC2', '@papermoonchannel', 'Paper Moon'),
	account('instagram', 'ig2', 'papermoon', 'Paper Moon')
];

const brands: Brand[] = [
	{ id: 'owl', name: 'Owls Nest', sort_order: 0, accounts: { youtube: 'UC1', instagram: 'ig1' } },
	{ id: 'moon', name: 'Paper Moon', sort_order: 1, accounts: { youtube: 'UC2', instagram: 'ig2' } }
];

describe('squash', () => {
	it('keeps letters and digits, lower case', () => {
		expect(squash("#Owl's_Nest 2")).toBe('owlsnest2');
	});
});

describe('brandTerms', () => {
	it('names a brand by itself and its accounts, once each', () => {
		expect(brandTerms(brands[0], accounts)).toEqual([
			{ key: 'owlsnest', label: 'Owls Nest' },
			{ key: 'owlsnestdaily', label: 'owls.nest.daily' }
		]);
	});

	it('drops names too short to look for', () => {
		expect(brandTerms({ id: 'x', name: 'Ox', sort_order: 0, accounts: {} }, [])).toEqual([]);
	});
});

describe('otherBrandMentions', () => {
	it('finds another brand named in a hashtag', () => {
		const found = otherBrandMentions(['A new video #papermoon'], 'owl', brands, accounts);
		expect(found).toEqual([{ brandId: 'moon', brand: 'Paper Moon', found: ['Paper Moon'] }]);
	});

	it('finds a handle split by spaces or punctuation', () => {
		const found = otherBrandMentions(['subscribe to @paper_moon_channel'], 'owl', brands, accounts);
		expect(found[0]?.found).toEqual(['Paper Moon', '@papermoonchannel']);
	});

	it('says nothing about the brand the upload is for', () => {
		expect(otherBrandMentions(['#owlsnest forever'], 'owl', brands, accounts)).toEqual([]);
	});

	it('leaves out a name the current brand’s own names contain', () => {
		const nested: Brand[] = [
			{ id: 'a', name: 'Moon Paper Moon', sort_order: 0, accounts: {} },
			{ id: 'b', name: 'Paper Moon', sort_order: 1, accounts: {} }
		];
		expect(otherBrandMentions(['Moon Paper Moon live'], 'a', nested, [])).toEqual([]);
	});

	it('finds nothing in empty text', () => {
		expect(otherBrandMentions(['', ''], 'owl', brands, accounts)).toEqual([]);
	});
});

describe('postTexts', () => {
	it('reads title, description, tag lists and playlist', () => {
		expect(
			postTexts({
				title: 't',
				description: 'd',
				options: { tags: ['a'], tagsOther: ['b'], playlist: 'p', collaborators: ['c'], visibility: 'Public' }
			})
		).toEqual(['t', 'd', 'a', 'b', 'p']);
	});

	it('reads every playlist', () => {
		expect(postTexts({ options: { playlists: ['p', 'q'] } })).toEqual(['', '', 'p', 'q']);
	});
});

describe('mentionWords', () => {
	it('adds the names found when they are not the brand’s own', () => {
		expect(mentionWords({ brandId: 'm', brand: 'Paper Moon', found: ['Paper Moon'] })).toBe('Paper Moon');
		expect(mentionWords({ brandId: 'm', brand: 'Paper Moon', found: ['Paper Moon', 'papermoon'] })).toBe('Paper Moon');
		expect(mentionWords({ brandId: 'm', brand: 'Paper Moon', found: ['@papermoonchannel'] })).toBe(
			'Paper Moon (@papermoonchannel)'
		);
	});
});
