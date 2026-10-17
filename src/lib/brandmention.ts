import type { Account, Brand } from './types';
import { playlistsOf } from './playlists';

/**
 * Whether an upload's text names another brand: "#papermoon" in a caption on
 * its way to Owls Nest's accounts is how a wrong-brand upload looks on the
 * Review step, the last place it can still be stopped for free. A warning,
 * never a block — a brand may well mention its sister channel.
 */

export interface BrandTerm {
	/** What is looked for: letters and digits only, lower case. */
	key: string;
	/** As the brand or account spells it, for the warning. */
	label: string;
}

export interface BrandMention {
	brandId: string;
	brand: string;
	/** The names found, as the brand or its accounts spell them. */
	found: string[];
}

/** Shorter names would turn up inside ordinary words. */
const MIN_LENGTH = 4;

/** Letters and digits only, lower case: "#Owls_Nest" and "Owl's Nest" both read "owlsnest". */
export function squash(text: string): string {
	return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** What names a brand: its own name, and the handle and name of every account it posts as. */
export function brandTerms(brand: Brand, accounts: Account[]): BrandTerm[] {
	const labels = [brand.name];
	for (const [platform, id] of Object.entries(brand.accounts ?? {})) {
		const account = accounts.find((a) => a.platform === platform && a.account_id === id);
		if (account) labels.push(account.handle, account.name);
	}
	const terms = new Map<string, string>();
	for (const label of labels) {
		const key = squash(label ?? '');
		if (key.length >= MIN_LENGTH && !terms.has(key)) terms.set(key, label.trim());
	}
	return [...terms].map(([key, label]) => ({ key, label }));
}

/**
 * The other brands `texts` name, for an upload made for `currentId`. Each
 * text is squashed on its own, so a name split by spaces or punctuation is
 * still found ("Paper Moon", "#paper_moon"). A term the current brand's own
 * names contain is left out — "Nest" is no mention of a brand "Nest" in an
 * Owls Nest upload.
 */
export function otherBrandMentions(
	texts: string[],
	currentId: string,
	brands: Brand[],
	accounts: Account[]
): BrandMention[] {
	const current = brands.find((b) => b.id === currentId);
	const own = current ? brandTerms(current, accounts).map((t) => t.key) : [];
	const hay = texts.map(squash).filter(Boolean);
	if (hay.length === 0) return [];

	const out: BrandMention[] = [];
	for (const brand of brands) {
		if (brand.id === currentId) continue;
		const found = brandTerms(brand, accounts)
			.filter((term) => !own.some((key) => key.includes(term.key)))
			.filter((term) => hay.some((text) => text.includes(term.key)))
			.map((term) => term.label);
		if (found.length > 0) out.push({ brandId: brand.id, brand: brand.name, found });
	}
	return out;
}

/** The text of a post that is checked: title, description, its tags and its playlists. */
export function postTexts(post: { title?: string; description?: string; options?: Record<string, unknown> }): string[] {
	const texts = [post.title ?? '', post.description ?? ''];
	for (const [key, value] of Object.entries(post.options ?? {})) {
		if (key.startsWith('tags') && Array.isArray(value)) texts.push(...value.map(String));
	}
	texts.push(...playlistsOf(post.options));
	return texts;
}

/** "Names Paper Moon (@papermoonchannel)" — the found names after the brand's own when they differ. */
export function mentionWords(mention: BrandMention): string {
	const extra = mention.found.filter((label) => squash(label) !== squash(mention.brand));
	return extra.length > 0 ? `${mention.brand} (${extra.join(', ')})` : mention.brand;
}
