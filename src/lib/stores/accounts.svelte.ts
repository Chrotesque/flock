import { loadAccounts } from '../repo';
import { accountFor, offerFor, type Offer } from '../accounts';
import { brands } from './brands.svelte';
import type { Account, InstagramAccount, PlatformId, TikTokCreator } from '../types';

/** A TikTok account row's details in the shape the compose screen reads. */
function toCreator(account: Account): TikTokCreator | null {
	const d = account.details;
	if (!d || typeof d.username !== 'string') return null;
	return {
		...(d as unknown as TikTokCreator),
		privacyOptions: Array.isArray(d.privacyOptions) ? (d.privacyOptions as string[]) : [],
		error: account.error || (typeof d.error === 'string' ? d.error : '')
	};
}

/** An Instagram account row's details in the shape the review step reads. */
function toInstagram(account: Account): InstagramAccount | null {
	const d = account.details;
	const username = typeof d?.username === 'string' && d.username ? d.username : account.handle;
	if (!username) return null;
	return {
		fetchedAt: String(d?.fetchedAt ?? account.fetched_at),
		userId: account.account_id,
		username,
		name: String(d?.name ?? account.name),
		pageId: typeof d?.pageId === 'string' ? d.pageId : undefined,
		pageName: typeof d?.pageName === 'string' ? d.pageName : undefined,
		quotaUsed: typeof d?.quotaUsed === 'number' ? d.quotaUsed : null,
		quotaTotal: typeof d?.quotaTotal === 'number' ? d.quotaTotal : null,
		error: account.error
	};
}

/**
 * The accounts the worker posts as, every platform, as it last read them.
 *
 * Read-only in the browser: the worker holds the credentials, reads each
 * account on its own timer and leaves the public half in the `accounts`
 * collection. Which one an upload goes out as is the brand's choice
 * (accounts.ts); the getters below answer for the brand in view, so the
 * compose screen asks `accounts.tiktok` as it always did. TikTok's rules
 * make the creator row load-bearing — the audiences offered on the compose
 * screen have to be the ones the account reports.
 */
class AccountsStore {
	list = $state<Account[]>([]);
	loaded = $state(false);

	#loading: Promise<void> | null = null;

	/** Loads once; `force` re-reads (Settings does, to list fresh accounts). */
	load(force = false): Promise<void> {
		if (!this.#loading || force) this.#loading = this.refresh();
		return this.#loading;
	}

	/** Re-reads the accounts, keeping what it has if the read fails. */
	async refresh(): Promise<void> {
		try {
			this.list = await loadAccounts();
		} catch {
			// A failed read leaves the previous list in place.
		} finally {
			this.loaded = true;
		}
	}

	forPlatform(platform: PlatformId): Account[] {
		return this.list.filter((a) => a.platform === platform);
	}

	/** The account the brand in view posts as on a platform, or null. */
	for(platform: PlatformId): Account | null {
		return accountFor(brands.current, platform, this.list, brands.list.length);
	}

	/** Whether the brand in view is offered the platform on uploads, and as which account. */
	offer(platform: PlatformId): Offer {
		return offerFor(brands.current, platform, this.list, brands.list.length);
	}

	/** The TikTok account the brand in view posts as. */
	get tiktok(): TikTokCreator | null {
		const account = this.for('tiktok');
		return account ? toCreator(account) : null;
	}

	/** The Instagram account the brand in view posts as. */
	get instagram(): InstagramAccount | null {
		const account = this.for('instagram');
		return account ? toInstagram(account) : null;
	}
}

export const accounts = new AccountsStore();
