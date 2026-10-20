import { accountFor } from './accounts';
import type { Attention } from './attention';
import type { Account, Brand } from './types';
import type { TodoLine } from './videotodo';

/**
 * Which brands To finish follows for their finishing steps and Jestr (the
 * user's call, 20 Oct 2026: one brand for now, the others not yet). Stored as
 * `general.todoBrands`: null for every brand, else the ids ticked, so a brand
 * added later stays out until it is ticked — as on the Jestr Partner page and
 * for Combined. The brands left out still show every post that did not go
 * out (failed, or never sent); the system's own items show whatever the
 * brand.
 */
export function readTodoBrands(raw: unknown): string[] | null {
	return Array.isArray(raw)
		? [...new Set(raw.filter((id): id is string => typeof id === 'string' && id !== ''))]
		: null;
}

/** Whether the brand is followed. */
export function follows(chosen: string[] | null, brand: string): boolean {
	return chosen === null || chosen.includes(brand);
}

/** The ticks with one brand switched, in the app's order of `all`. */
export function toggled(all: { id: string }[], chosen: string[] | null, id: string): string[] {
	const now = chosen ?? all.map((b) => b.id);
	const next = now.includes(id) ? now.filter((b) => b !== id) : [...now, id];
	return all.filter((b) => next.includes(b.id)).map((b) => b.id);
}

/**
 * The followed brands' YouTube channels, which the video lines are on; null
 * when every brand is followed, so nothing is left out.
 */
export function followedChannels(brands: Brand[], rows: Account[], chosen: string[] | null): Set<string> | null {
	if (chosen === null) return null;
	const channels = new Set<string>();
	for (const brand of brands) {
		if (!chosen.includes(brand.id)) continue;
		const channel = accountFor(brand, 'youtube', rows, brands.length)?.account_id;
		if (channel) channels.add(channel);
	}
	return channels;
}

/** The lines on followed channels; one whose channel is not known yet stays, rather than vanish. */
export function followedLines(lines: TodoLine[], channels: Set<string> | null): TodoLine[] {
	return channels ? lines.filter((line) => !line.channelId || channels.has(line.channelId)) : lines;
}

/** Everything for followed brands; for the others only posts that did not go out. */
export function followedItems(items: Attention[], chosen: string[] | null): Attention[] {
	if (chosen === null) return items;
	return items.filter(
		(item) => !item.brand || chosen.includes(item.brand) || item.kind === 'failed' || item.kind === 'unsent'
	);
}
