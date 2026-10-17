import type { OptionValues } from './types';

/**
 * The YouTube playlists a post goes into, by title — as many as the upload
 * names (since v0.16.23). Kept in the post's options as `playlists`; up to
 * then it was one title under `playlist`, which every reader here still takes,
 * since rows queued, drafts saved and records written before carry it. The
 * worker reads both the same way (`playlistNames` in worker/youtube.mjs).
 */

/** A list of titles as given: a list, or one title; trimmed, blanks and repeats (in any case) left out. */
export function cleanPlaylists(value: unknown): string[] {
	const given = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of given) {
		if (typeof item !== 'string') continue;
		const title = item.trim();
		if (!title || seen.has(title.toLowerCase())) continue;
		seen.add(title.toLowerCase());
		out.push(title);
	}
	return out;
}

/** The playlists a post's options name: `playlists`, then the older single `playlist`. */
export function playlistsOf(options: Record<string, unknown> | null | undefined): string[] {
	return cleanPlaylists([...cleanPlaylists(options?.playlists), ...cleanPlaylists(options?.playlist)]);
}

/** Options naming exactly these playlists, under `playlists`; the older key goes. */
export function withPlaylists(options: OptionValues, titles: string[]): OptionValues {
	const out: OptionValues = { ...options, playlists: cleanPlaylists(titles) };
	delete out.playlist;
	return out;
}

/** Whether the options say anything about playlists, even "none". */
export function namesPlaylists(options: Record<string, unknown> | null | undefined): boolean {
	return Boolean(options && ('playlists' in options || 'playlist' in options));
}

/**
 * The titles a paste named, in the channel's own spelling where it differs
 * only in case — the worker matches case aside too, but the box shows the
 * channel's list — and the ones the channel has no playlist for, kept as
 * given and named so the person can fix them.
 */
export function matchPlaylists(wanted: string[], channel: string[]): { titles: string[]; missing: string[] } {
	const missing: string[] = [];
	const titles = wanted.map((title) => {
		if (channel.includes(title)) return title;
		const loose = channel.find((t) => t.toLowerCase() === title.toLowerCase());
		if (loose) return loose;
		missing.push(title);
		return title;
	});
	return { titles: cleanPlaylists(titles), missing };
}
