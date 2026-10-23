import { describe, expect, it } from 'vitest';
import {
	askable,
	captionProblems,
	captionSegments,
	findMentions,
	lowerMentions,
	mentionAt,
	mentionNotes,
	needsAsking,
	replaceMention,
	suggestHandles,
	tiktokSearchUrl,
	type TikTokHandle
} from './tiktokmentions';

function row(handle: string, extra: Partial<TikTokHandle> = {}): TikTokHandle {
	return {
		id: handle,
		handle,
		status: 'found',
		name: '',
		checkedAt: '2026-10-24T00:00:00Z',
		error: '',
		used: false,
		updated: '2026-10-24 00:00:00.000Z',
		...extra
	};
}

describe('findMentions', () => {
	it('finds each handle with where it sits', () => {
		const text = 'Wishlist it. @OwlsNestGamesLtd VR version?\n@moth_and_marrow';
		expect(findMentions(text)).toEqual([
			{ start: 13, end: 30, handle: 'OwlsNestGamesLtd' },
			{ start: 43, end: 59, handle: 'moth_and_marrow' }
		]);
	});

	it('keeps periods inside a handle but not one ending the sentence', () => {
		expect(findMentions('by @dune.studios.').map((m) => m.handle)).toEqual(['dune.studios']);
		expect(findMentions('@7xz.game')[0]).toEqual({ start: 0, end: 9, handle: '7xz.game' });
	});

	it('stops at anything a handle cannot hold', () => {
		expect(findMentions('thanks @papermoonplay, and @lanternworks!').map((m) => m.handle)).toEqual([
			'papermoonplay',
			'lanternworks'
		]);
		expect(findMentions('(@gloamgames)').map((m) => m.handle)).toEqual(['gloamgames']);
	});

	it('does not read an e-mail address or a doubled @ as a mention', () => {
		expect(findMentions('mail me@example.com')).toEqual([]);
		expect(findMentions('@@x').map((m) => m.handle)).toEqual(['']);
	});

	it('includes a bare @ for the popup', () => {
		expect(findMentions('hey @')).toEqual([{ start: 4, end: 5, handle: '' }]);
	});
});

describe('mentionAt', () => {
	const mentions = findMentions('a @owls b');
	it('is the mention the caret is in or right after', () => {
		expect(mentionAt(mentions, 3)?.handle).toBe('owls');
		expect(mentionAt(mentions, 7)?.handle).toBe('owls');
	});
	it('is none before the @ or past the handle', () => {
		expect(mentionAt(mentions, 2)).toBeNull();
		expect(mentionAt(mentions, 8)).toBeNull();
	});
});

describe('askable', () => {
	it('takes 2 to 24 characters', () => {
		expect(askable('a')).toBe(false);
		expect(askable('ab')).toBe(true);
		expect(askable('x'.repeat(24))).toBe(true);
		expect(askable('x'.repeat(25))).toBe(false);
	});
});

describe('needsAsking', () => {
	const now = Date.parse('2026-10-24T12:00:00Z');
	it('asks about a handle never asked about', () => {
		expect(needsAsking(undefined, now)).toBe(true);
	});
	it('waits for a pending ask', () => {
		expect(needsAsking(row('x', { status: 'pending', checkedAt: '' }), now)).toBe(false);
	});
	it('trusts a found account for a month and a missing one for a day', () => {
		expect(needsAsking(row('x', { checkedAt: '2026-10-01T12:00:00Z' }), now)).toBe(false);
		expect(needsAsking(row('x', { checkedAt: '2026-09-20T12:00:00Z' }), now)).toBe(true);
		expect(needsAsking(row('x', { status: 'missing', checkedAt: '2026-10-24T01:00:00Z' }), now)).toBe(false);
		expect(needsAsking(row('x', { status: 'missing', checkedAt: '2026-10-23T11:00:00Z' }), now)).toBe(true);
	});
	it('asks again two minutes after a failure', () => {
		expect(needsAsking(row('x', { status: 'failed', checkedAt: '2026-10-24T11:59:00Z' }), now)).toBe(false);
		expect(needsAsking(row('x', { status: 'failed', checkedAt: '2026-10-24T11:57:00Z' }), now)).toBe(true);
	});
});

describe('mentionNotes', () => {
	const known = {
		owlsnestgamesltd: row('owlsnestgamesltd', { name: 'Owls Nest Games' }),
		nobody_here: row('nobody_here', { status: 'missing' }),
		papermoonplay: row('papermoonplay', { status: 'pending', checkedAt: '', error: 'TikTok is limiting lookups.' }),
		broken: row('broken', { status: 'failed', error: 'TikTok answered 500' })
	};

	it('says whose account each handle is, or what is wrong', () => {
		const notes = mentionNotes(
			'@owlsnestgamesltd @OwlsNestGamesLtd @nobody_here @papermoonplay @broken @new_one @',
			known
		);
		expect(notes.map((n) => [n.key, n.state, n.name])).toEqual([
			['owlsnestgamesltd', 'found', 'Owls Nest Games'],
			['owlsnestgamesltd', 'case', 'Owls Nest Games'],
			['nobody_here', 'missing', ''],
			['papermoonplay', 'checking', ''],
			['broken', 'failed', ''],
			['new_one', 'checking', '']
		]);
		expect(notes[1].words).toBe('@OwlsNestGamesLtd will not link: TikTok handles are lower case. Use @owlsnestgamesltd.');
		expect(notes[3].words).toBe('Asking TikTok about @papermoonplay… TikTok is limiting lookups.');
	});

	it('calls a handle too long for TikTok', () => {
		expect(mentionNotes(`@${'a'.repeat(25)}`, {})[0].state).toBe('long');
	});
});

describe('captionProblems', () => {
	it('holds only what can never link', () => {
		expect(captionProblems('@PaperMoonPlay and @nobody_here')).toEqual([
			'@PaperMoonPlay will not link: TikTok handles are lower case. Use @papermoonplay.'
		]);
		expect(captionProblems('@papermoonplay')).toEqual([]);
	});
});

describe('lowerMentions', () => {
	it('lowers the handles and nothing else', () => {
		expect(lowerMentions('By @OwlsNestGamesLtd. Wishlist it! @LanternWorks')).toBe(
			'By @owlsnestgamesltd. Wishlist it! @lanternworks'
		);
	});
});

describe('replaceMention', () => {
	it('swaps the mention and puts the caret after it', () => {
		const text = 'by @OwlsNest now';
		expect(replaceMention(text, findMentions(text)[0], 'owlsnestgamesltd')).toEqual({
			text: 'by @owlsnestgamesltd now',
			caret: 20
		});
	});
	it('adds a space when the mention ended the caption', () => {
		const text = 'by @owl';
		expect(replaceMention(text, findMentions(text)[0], 'owlsnestgamesltd')).toEqual({
			text: 'by @owlsnestgamesltd ',
			caret: 21
		});
	});
	it('keeps punctuation right after the mention', () => {
		const text = 'by @owl, now';
		expect(replaceMention(text, findMentions(text)[0], 'owlsnestgamesltd').text).toBe('by @owlsnestgamesltd, now');
	});
});

describe('captionSegments', () => {
	it('splits at the cut and at each mention', () => {
		const text = 'Hi @owls and more';
		expect(captionSegments(text, 12, findMentions(text))).toEqual([
			{ text: 'Hi ', cut: false, mention: -1 },
			{ text: '@owls', cut: false, mention: 0 },
			{ text: ' and', cut: false, mention: -1 },
			{ text: ' more', cut: true, mention: -1 }
		]);
	});
	it('splits a mention the cut runs through', () => {
		const text = 'x @abcdef';
		expect(captionSegments(text, 5, findMentions(text))).toEqual([
			{ text: 'x ', cut: false, mention: -1 },
			{ text: '@ab', cut: false, mention: 0 },
			{ text: 'cdef', cut: true, mention: 0 }
		]);
	});
	it('adds up to the caption', () => {
		const text = '@a @b\n@c. end';
		expect(captionSegments(text, null, findMentions(text)).map((s) => s.text).join('')).toBe(text);
		expect(captionSegments('', 100, [])).toEqual([]);
	});
});

describe('suggestHandles', () => {
	const known = [
		row('owlsnestgamesltd', { name: 'Owls Nest Games', used: true }),
		row('owls', { name: 'Owls Daily' }),
		row('papermoonplay', { name: 'PaperMoonPlay', used: true, updated: '2026-10-23 00:00:00.000Z' }),
		row('lanternworks', { name: 'Lantern Works', updated: '2026-10-25 00:00:00.000Z' }),
		row('ghost', { status: 'missing' })
	];

	it('matches the handle or the name, best first', () => {
		expect(suggestHandles('owl', known).map((r) => r.handle)).toEqual(['owlsnestgamesltd', 'owls']);
		expect(suggestHandles('OwlsNestGamesLtd', known).map((r) => r.handle)).toEqual([]);
		expect(suggestHandles('games', known).map((r) => r.handle)).toEqual(['owlsnestgamesltd']);
		expect(suggestHandles('daily', known).map((r) => r.handle)).toEqual(['owls']);
	});

	it('offers the accounts used before, newest first, for a bare @', () => {
		expect(suggestHandles('', known).map((r) => r.handle)).toEqual([
			'owlsnestgamesltd',
			'papermoonplay',
			'lanternworks',
			'owls'
		]);
	});

	it('never offers an account TikTok did not confirm', () => {
		expect(suggestHandles('gho', known)).toEqual([]);
	});
});

describe('tiktokSearchUrl', () => {
	it("is TikTok's account search", () => {
		expect(tiktokSearchUrl('Owls Nest Games')).toBe('https://www.tiktok.com/search/user?q=Owls%20Nest%20Games');
	});
});
