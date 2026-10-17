import { describe, expect, it } from 'vitest';
import { cleanPlaylists, matchPlaylists, namesPlaylists, playlistsOf, withPlaylists } from './playlists';

describe('playlists', () => {
	it('cleans a list or one title: trimmed, no blanks, no repeats in any case', () => {
		expect(cleanPlaylists([' Shorts ', 'Clips', '', 'shorts', 7, 'Clips'])).toEqual(['Shorts', 'Clips']);
		expect(cleanPlaylists('  First Peck ')).toEqual(['First Peck']);
		expect(cleanPlaylists('   ')).toEqual([]);
		expect(cleanPlaylists(undefined)).toEqual([]);
	});

	it('reads the list, and the single playlist rows from before it', () => {
		expect(playlistsOf({ playlists: ['A', 'B'] })).toEqual(['A', 'B']);
		expect(playlistsOf({ playlist: 'Old' })).toEqual(['Old']);
		expect(playlistsOf({ playlists: ['A'], playlist: 'a' })).toEqual(['A']);
		expect(playlistsOf({ playlists: ['A'], playlist: 'Old' })).toEqual(['A', 'Old']);
		expect(playlistsOf({})).toEqual([]);
		expect(playlistsOf(null)).toEqual([]);
	});

	it('writes the list under its own key and drops the old one', () => {
		const out = withPlaylists({ playlist: 'Old', visibility: 'Public' }, ['A', ' A ', 'B']);
		expect(out).toEqual({ visibility: 'Public', playlists: ['A', 'B'] });
		expect(withPlaylists({}, [])).toEqual({ playlists: [] });
	});

	it('tells options that name no playlist from ones that chose none', () => {
		expect(namesPlaylists({ playlists: [] })).toBe(true);
		expect(namesPlaylists({ playlist: '' })).toBe(true);
		expect(namesPlaylists({ visibility: 'Public' })).toBe(false);
		expect(namesPlaylists(undefined)).toBe(false);
	});
});

describe('matchPlaylists', () => {
	it("takes the channel's spelling, and names what the channel lacks", () => {
		expect(matchPlaylists(['first peck', 'Clips', 'Gone'], ['First Peck', 'Clips'])).toEqual({
			titles: ['First Peck', 'Clips', 'Gone'],
			missing: ['Gone']
		});
		expect(matchPlaylists([], ['A'])).toEqual({ titles: [], missing: [] });
	});
});
