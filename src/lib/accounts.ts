import type { Account, Brand, PlatformId } from './types';

/**
 * Which account a brand posts as on a platform, and whether the platform is
 * offered for it at all — the rule that keeps one brand's post off another
 * brand's account.
 *
 * - A brand that chose an account posts as that one, while it exists.
 * - With a single brand, a platform with exactly one account needs no
 *   choice: that is the account (a stranger's install works unconfigured).
 * - Otherwise there is none. With several brands a guess could publish to
 *   the wrong one — which is exactly what nearly happened with one YouTube
 *   channel and two brands — so the platform is not offered until the brand
 *   picks an account in Settings → Brands.
 */
export function accountFor(
	brand: Brand | undefined,
	platform: PlatformId,
	accounts: Account[],
	brandCount: number
): Account | null {
	const own = accounts.filter((a) => a.platform === platform);
	const chosen = brand?.accounts?.[platform];
	if (chosen) return own.find((a) => a.account_id === chosen) ?? null;
	if (brandCount <= 1 && own.length === 1) return own[0];
	return null;
}

export type Offer =
	| { offered: true; account: Account | null }
	| { offered: false; reason: 'gone' | 'unchosen' | 'none' };

/**
 * Whether a platform is offered on uploads for a brand, and as which account.
 * A single-brand install keeps offering a platform the worker has reported
 * no account for (not set up yet, or no adapter at all) — the worker holds
 * those posts until it can publish them, as before brands. With several
 * brands, only a platform with a chosen, existing account is offered.
 */
export function offerFor(
	brand: Brand | undefined,
	platform: PlatformId,
	accounts: Account[],
	brandCount: number
): Offer {
	const account = accountFor(brand, platform, accounts, brandCount);
	if (account) return { offered: true, account };
	if (brand?.accounts?.[platform]) return { offered: false, reason: 'gone' };
	const known = accounts.some((a) => a.platform === platform);
	if (brandCount <= 1 && !known) return { offered: true, account: null };
	return { offered: false, reason: known ? 'unchosen' : 'none' };
}

/**
 * The choices a lone brand makes without being asked, written down: when a
 * second brand is added, the first must keep posting where it did, which
 * means turning "the only account" into an explicit choice before it stops
 * being the only brand.
 */
export function implicitChoices(
	brand: Brand,
	accounts: Account[],
	platforms: readonly PlatformId[]
): Partial<Record<PlatformId, string>> {
	const out: Partial<Record<PlatformId, string>> = { ...brand.accounts };
	for (const platform of platforms) {
		if (out[platform]) continue;
		const own = accounts.filter((a) => a.platform === platform);
		if (own.length === 1) out[platform] = own[0].account_id;
	}
	return out;
}

/** "@handle" when there is one (YouTube's already carries the @), else the name, else the id. */
export function accountLabel(account: Account): string {
	if (account.handle) return account.handle.startsWith('@') ? account.handle : `@${account.handle}`;
	return account.name || account.account_id;
}
