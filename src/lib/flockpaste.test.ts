import { describe, expect, it } from 'vitest';
import { filledSummary, matchBrand, readFlockPaste, type FlockPaste } from './flockpaste';
import type { Brand } from './types';

function read(text: string): FlockPaste {
	const result = readFlockPaste(text);
	if (!result || !result.ok) throw new Error(`expected a paste, got ${JSON.stringify(result)}`);
	return result.paste;
}

const block = (extra: Record<string, unknown>) => JSON.stringify({ flock: 1, ...extra });

describe('readFlockPaste: what counts as a flock block', () => {
	it('ignores ordinary text', () => {
		expect(readFlockPaste('just a caption #cats')).toBeNull();
		expect(readFlockPaste('')).toBeNull();
	});

	it('ignores JSON without the flock key', () => {
		expect(readFlockPaste('{"youtube": {"title": "x"}}')).toBeNull();
	});

	it('ignores prose that only mentions the key', () => {
		expect(readFlockPaste('set "flock": to something {later}')).toBeNull();
	});

	it('reads a bare block', () => {
		const paste = read(block({ youtube: { title: 'Hello', description: 'World' } }));
		expect(paste.platforms.youtube).toEqual({ title: 'Hello', description: 'World' });
		expect(paste.notes).toEqual([]);
	});

	it('takes the version as a number or a string', () => {
		expect(readFlockPaste('{"flock": "1", "tiktok": {"caption": "x"}}')?.ok).toBe(true);
	});

	it('refuses another version, saying which', () => {
		const result = readFlockPaste('{"flock": 2, "tiktok": {"caption": "x"}}');
		expect(result?.ok).toBe(false);
		expect(!result?.ok && result?.error).toContain('format 2');
	});

	it('explains a version 1 block that does not parse', () => {
		const result = readFlockPaste('{"flock": 1, "tiktok": {"caption": "unterminated}');
		expect(result?.ok).toBe(false);
		expect(!result?.ok && result?.error).toContain('not valid JSON');
	});

	it('finds the block inside a copied chat message with a fence and prose', () => {
		const text = [
			'Here is the block for {your} video:',
			'```json',
			block({ instagram: { caption: 'A {curly} caption' } }),
			'```',
			'Paste it into flock. {Enjoy}'
		].join('\n');
		expect(read(text).platforms.instagram).toEqual({ description: 'A {curly} caption' });
	});

	it('finds an unfenced block between prose with braces', () => {
		const text = `Sure {ok}: ${block({ tiktok: { caption: 'Brace } inside' } })} and {more}`;
		expect(read(text).platforms.tiktok).toEqual({ description: 'Brace } inside' });
	});

	it('repairs single backslashes in a Windows path', () => {
		const paste = read('{"flock": 1, "thumbnail": "C:\\Users\\me\\Pictures\\thumb.png"}');
		expect(paste.thumbnail).toBe('C:\\Users\\me\\Pictures\\thumb.png');
	});

	it('reads a correctly escaped path the same way', () => {
		expect(read('{"flock": 1, "thumbnail": "C:\\\\Users\\\\me\\\\thumb.png"}').thumbnail).toBe(
			'C:\\Users\\me\\thumb.png'
		);
		expect(read(block({ thumbnail: 'C:/Users/me/thumb.png' })).thumbnail).toBe('C:/Users/me/thumb.png');
	});

	it('never reads \\n or \\t in a path as a newline or a tab', () => {
		expect(read('{"flock": 1, "thumbnail": "C:\\new\\thumb.png"}').thumbnail).toBe('C:\\new\\thumb.png');
	});

	it('repairs a lone backslash elsewhere, keeping valid escapes', () => {
		const paste = read('{"flock": 1, "brand": "A\\B", "tiktok": {"caption": "line\\nnext \\\\ end"}}');
		expect(paste.brand).toBe('A\\B');
		expect(paste.platforms.tiktok?.description).toBe('line\nnext \\ end');
	});
});

describe('readFlockPaste: what a block fills', () => {
	it('reads caption and description as the same thing', () => {
		const paste = read(block({ tiktok: { caption: ' trimmed ' }, youtube: { description: 'd' } }));
		expect(paste.platforms.tiktok?.description).toBe('trimmed');
		expect(paste.platforms.youtube?.description).toBe('d');
	});

	it('prefers description when both disagree, and says so', () => {
		const paste = read(block({ youtube: { description: 'a', caption: 'b' } }));
		expect(paste.platforms.youtube?.description).toBe('a');
		expect(paste.notes).toHaveLength(1);
	});

	it('leaves out a title for a caption-only platform', () => {
		const paste = read(block({ instagram: { title: 'Nope', caption: 'yes' } }));
		expect(paste.platforms.instagram).toEqual({ description: 'yes' });
		expect(paste.notes[0]).toContain('no title');
	});

	it('takes tags as a list or a comma string, without # and duplicates', () => {
		expect(read(block({ youtube: { tags: ['#cats', 'cats', ' Kittens '] } })).platforms.youtube?.tags).toEqual([
			'cats',
			'Kittens'
		]);
		expect(read(block({ youtube: { tags: 'a, b,,a' } })).platforms.youtube?.tags).toEqual(['a', 'b']);
	});

	it('refuses tags where the platform has none', () => {
		const paste = read(block({ tiktok: { caption: 'x', tags: ['a'] } }));
		expect(paste.platforms.tiktok?.tags).toBeUndefined();
		expect(paste.notes[0]).toContain('hashtags');
	});

	it('takes a playlist for YouTube only', () => {
		const paste = read(block({ youtube: { playlist: 'Shorts' }, instagram: { playlist: 'x' } }));
		expect(paste.platforms.youtube?.playlist).toBe('Shorts');
		expect(paste.platforms.instagram).toEqual({});
		expect(paste.notes).toHaveLength(1);
	});

	it('names platforms case-insensitively and skips unknown keys', () => {
		const paste = read(block({ YouTube: { title: 't' }, twitter: { caption: 'x' }, youtube_extra: 1 }));
		expect(paste.platforms.youtube).toEqual({ title: 't' });
		expect(paste.notes).toHaveLength(2);
	});

	it('never reads TikTok posting choices, and says they were ignored', () => {
		const paste = read(block({ tiktok: { caption: 'x', privacy: 'Public', allowComments: true } }));
		expect(paste.platforms.tiktok).toEqual({ description: 'x' });
		expect(paste.notes).toHaveLength(2);
	});

	it('reports text over a platform limit but keeps it whole', () => {
		const title = 'x'.repeat(120);
		const paste = read(block({ youtube: { title } }));
		expect(paste.platforms.youtube?.title).toBe(title);
		expect(paste.notes[0]).toContain('120 characters');
	});

	it('says when there is nothing to fill', () => {
		expect(read(block({})).notes[0]).toContain('nothing to fill');
	});
});

describe('matchBrand', () => {
	const brands: Brand[] = [
		{ id: 'a', name: 'Owls Nest', sort_order: 0, accounts: {} },
		{ id: 'b', name: 'Paper Moon', sort_order: 1, accounts: {} }
	];

	it('matches ignoring case, spaces and punctuation', () => {
		expect(matchBrand(brands, "Owl's Nest")?.id).toBe('a');
		expect(matchBrand(brands, ' paper moon ')?.id).toBe('b');
	});

	it('finds nothing for an unknown or empty name', () => {
		expect(matchBrand(brands, 'Other')).toBeNull();
		expect(matchBrand(brands, '')).toBeNull();
	});
});

describe('filledSummary', () => {
	it('lists what a platform got', () => {
		expect(filledSummary('youtube', { title: 't', description: 'd', tags: ['a'], playlist: 'p' })).toBe(
			'title, description, 1 tag, playlist'
		);
		expect(filledSummary('tiktok', { description: 'd' })).toBe('caption');
		expect(filledSummary('instagram', {})).toBe('ticked, nothing to fill');
	});
});
