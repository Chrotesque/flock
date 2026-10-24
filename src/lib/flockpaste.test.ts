import { describe, expect, it } from 'vitest';
import { closestBrand, filledSummary, matchBrand, parseSchedule, readFlockPaste, type FlockPaste } from './flockpaste';
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

	it('reads the product name, trimmed, and leaves it empty without one', () => {
		const paste = read(block({ product: ' Lantern Keep: The Long Night ', youtube: { title: 't' } }));
		expect(paste.product).toBe('Lantern Keep: The Long Night');
		expect(paste.notes).toEqual([]);
		expect(read(block({ youtube: { title: 't' } })).product).toBe('');
	});

	it('fills a block that carries only a product name, and says when it is not text', () => {
		expect(read(block({ product: 'Lantern Keep' })).notes).toEqual([]);
		const odd = read(block({ product: ['Lantern Keep'], youtube: { title: 't' } }));
		expect(odd.product).toBe('');
		expect(odd.notes).toEqual(['Ignored "product": expected the name as text.']);
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
		expect(paste.platforms.youtube?.playlists).toEqual(['Shorts']);
		expect(paste.platforms.instagram).toEqual({});
		expect(paste.notes).toHaveLength(1);
	});

	it('takes several playlists, as a list under either name', () => {
		expect(read(block({ youtube: { playlists: ['Shorts', ' Clips ', 'shorts', ''] } })).platforms.youtube?.playlists).toEqual([
			'Shorts',
			'Clips'
		]);
		expect(read(block({ youtube: { playlist: ['A', 'B'] } })).platforms.youtube?.playlists).toEqual(['A', 'B']);
		expect(read(block({ youtube: { playlists: 'A', playlist: 'B' } })).platforms.youtube?.playlists).toEqual(['A', 'B']);
		const none = read(block({ youtube: { playlists: [] } }));
		expect(none.platforms.youtube?.playlists).toEqual([]);
		expect(none.notes).toEqual([]);
		expect(read(block({ tiktok: { playlists: ['x'] } })).notes).toHaveLength(1);
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

	it('does not match a near miss — that is closestBrand’s suggestion', () => {
		expect(matchBrand(brands, 'Owls Nets')).toBeNull();
	});
});

describe('closestBrand', () => {
	const brands: Brand[] = [
		{ id: 'a', name: 'Owls Nest', sort_order: 0, accounts: {} },
		{ id: 'b', name: 'Paper Moon', sort_order: 1, accounts: {} },
		{ id: 'c', name: 'Lantern', sort_order: 2, accounts: {} }
	];

	it('suggests the brand a typo was meant to be', () => {
		expect(closestBrand(brands, 'Lanturn')?.id).toBe('c');
		expect(closestBrand(brands, 'Paper Mon')?.id).toBe('b');
		expect(closestBrand(brands, "owl's nset")?.id).toBe('a');
	});

	it('suggests nothing for a name that is not close', () => {
		expect(closestBrand(brands, 'Other')).toBeNull();
		expect(closestBrand(brands, 'Lamp')).toBeNull();
		expect(closestBrand(brands, '')).toBeNull();
	});

	it('suggests nothing when two brands are as close', () => {
		const twins: Brand[] = [
			{ id: 'x', name: 'Cat A', sort_order: 0, accounts: {} },
			{ id: 'y', name: 'Cat B', sort_order: 1, accounts: {} }
		];
		expect(closestBrand(twins, 'Cat C')).toBeNull();
	});
});

describe('filledSummary', () => {
	it('lists what a platform got', () => {
		expect(filledSummary('youtube', { title: 't', description: 'd', tags: ['a'], playlists: ['p'] })).toBe(
			'title, description, 1 tag, playlist'
		);
		expect(filledSummary('youtube', { playlists: ['p', 'q'] })).toBe('2 playlists');
		expect(filledSummary('youtube', { playlists: [] })).toBe('no playlist');
		expect(filledSummary('tiktok', { description: 'd' })).toBe('caption');
		expect(filledSummary('instagram', {})).toBe('ticked, nothing to fill');
	});
});

describe('parseSchedule', () => {
	it('reads a local date and time', () => {
		expect(parseSchedule('2026-10-13 18:00')).toEqual({ date: '2026-10-13', time: '18:00' });
		expect(parseSchedule(' 2026-10-13T9:05:00 ')).toEqual({ date: '2026-10-13', time: '09:05' });
	});

	it('turns an offset into local time', () => {
		const at = new Date('2026-10-13T16:00:00Z');
		const local = { date: `2026-10-${String(at.getDate()).padStart(2, '0')}`, time: `${String(at.getHours()).padStart(2, '0')}:00` };
		expect(parseSchedule('2026-10-13T16:00:00Z')).toEqual(local);
		expect(parseSchedule('2026-10-13T18:00+0200')).toEqual(local);
		expect(parseSchedule('2026-10-13 18:00:00+02:00')).toEqual(local);
	});

	it('takes now', () => {
		expect(parseSchedule('now')).toBe('now');
		expect(parseSchedule('Immediately')).toBe('now');
	});

	it('refuses anything else', () => {
		expect(parseSchedule('tomorrow at six')).toBeNull();
		expect(parseSchedule('2026-02-30 10:00')).toBeNull();
		expect(parseSchedule('2026-10-13 25:00')).toBeNull();
		expect(parseSchedule(1760371200)).toBeNull();
	});
});

describe('readFlockPaste: schedule', () => {
	const now = new Date(2026, 9, 12, 12, 0).getTime();

	it('reads each platform its own slot', () => {
		const paste = readFlockPaste(
			block({ youtube: { title: 'T', description: 'D', schedule: '2026-10-13 18:00' }, tiktok: { caption: 'c', schedule: 'now' } }),
			now
		);
		expect(paste?.ok && paste.paste.platforms.youtube?.schedule).toEqual({ date: '2026-10-13', time: '18:00' });
		expect(paste?.ok && paste.paste.platforms.tiktok?.schedule).toBe('now');
		expect(paste?.ok && paste.paste.notes).toEqual([]);
	});

	it('says when a slot cannot be read, or has passed', () => {
		const paste = readFlockPaste(
			block({ instagram: { caption: 'c', schedule: 'Monday evening' }, youtube: { title: 'T', schedule: '2026-10-11 08:00' } }),
			now
		);
		const notes = paste?.ok ? paste.paste.notes : [];
		expect(paste?.ok && paste.paste.platforms.instagram?.schedule).toBeUndefined();
		expect(notes.some((n) => n.startsWith('Instagram: ignored the schedule "Monday evening"'))).toBe(true);
		expect(notes.some((n) => n.startsWith("YouTube's time, Sun 11 Oct, 08:00, has passed"))).toBe(true);
	});

	it('names the slot in the summary', () => {
		expect(filledSummary('instagram', { description: 'c', schedule: { date: '2026-10-13', time: '19:30' } })).toBe(
			'caption, Tue 13 Oct, 19:30'
		);
		expect(filledSummary('tiktok', { schedule: 'now' })).toBe('out on pickup');
	});
});

describe('keys a local module reads', () => {
	const block = JSON.stringify({ flock: 1, tiktok: { caption: 'Hi', extra: 'x', other: 2 }, youtube: { title: 'T', extra: 1 } });

	it('are ignored, and noted, when no module reads them', () => {
		const result = readFlockPaste(block);
		const paste = result?.ok ? result.paste : null;
		expect(paste?.claimed).toBeUndefined();
		expect(paste?.notes).toEqual(['TikTok: ignored "extra".', 'TikTok: ignored "other".', 'YouTube: ignored "extra".']);
	});

	it('travel on as they were for the module that reads them, per platform', () => {
		const result = readFlockPaste(block, Date.now(), (p) => (p === 'tiktok' ? ['extra'] : []));
		const paste = result?.ok ? result.paste : null;
		expect(paste?.claimed).toEqual({ tiktok: { extra: 'x' } });
		expect(paste?.notes).toEqual(['TikTok: ignored "other".', 'YouTube: ignored "extra".']);
		expect(paste?.platforms.tiktok).toEqual({ description: 'Hi' });
	});
});

