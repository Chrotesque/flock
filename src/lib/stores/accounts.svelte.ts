import { loadAccounts, requestTikTokCheck } from '../repo';
import { accountFor, accountLabel, offerFor, type Offer } from '../accounts';
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

	/**
	 * The last on-demand TikTok check (`checkTikTok`): what came of it, and
	 * when. `idle` until one is asked for.
	 */
	tiktokCheck = $state<{ state: 'idle' | 'checking' | 'done' | 'failed' | 'timeout'; at: number }>({
		state: 'idle',
		at: 0
	});
	#checking: Promise<void> | null = null;

	/**
	 * Has the worker read the TikTok accounts afresh, then re-reads the rows —
	 * TikTok's guidelines want the latest creator info whenever the Post to
	 * TikTok box is shown. At most once a minute after a good check, one at a
	 * time.
	 */
	checkTikTok(): Promise<void> {
		if (this.#checking) return this.#checking;
		if (this.tiktokCheck.state === 'done' && Date.now() - this.tiktokCheck.at < 60_000) return Promise.resolve();
		this.tiktokCheck = { state: 'checking', at: Date.now() };
		this.#checking = (async () => {
			let state: 'done' | 'failed' | 'timeout';
			try {
				state = await requestTikTokCheck();
			} catch {
				state = 'failed';
			}
			await this.refresh();
			this.tiktokCheck = { state, at: Date.now() };
		})().finally(() => {
			this.#checking = null;
		});
		return this.#checking;
	}

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

	/**
	 * Who a post goes out as, in words, as the worker last read it. TikTok's
	 * rules ask for the creator's display name wherever a post is confirmed;
	 * YouTube is named by channel, which is the question with brands. '' until
	 * the worker has run with the platform set up, rather than a guess.
	 */
	postingAs(platform: PlatformId): string {
		if (platform === 'tiktok' && this.tiktok) {
			const creator = this.tiktok;
			return creator.nickname ? `${creator.nickname} (@${creator.username})` : `@${creator.username}`;
		}
		if (platform === 'instagram' && this.instagram) return `@${this.instagram.username}`;
		const account = this.for(platform);
		if (account) return account.name || accountLabel(account);
		return '';
	}
}

export const accounts = new AccountsStore();
