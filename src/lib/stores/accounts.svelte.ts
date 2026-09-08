import { loadTikTokCreator, loadInstagramAccount } from '../repo';
import type { InstagramAccount, TikTokCreator } from '../types';

/**
 * The accounts the worker posts as, as it last read them.
 *
 * Read-only in the browser: the worker holds the credentials, reads each
 * account on its own timer and leaves the result in `app_settings`, and this
 * is the one place the wizard reads it from. TikTok's rules make the creator
 * row load-bearing — the audiences offered on the compose screen have to be
 * the ones the account reports — which is why it lives in a store the draft
 * can read rather than in whichever component happens to show it. Absent
 * until the worker has run with that platform set up.
 */
class AccountsStore {
	tiktok = $state<TikTokCreator | null>(null);
	instagram = $state<InstagramAccount | null>(null);
	loaded = $state(false);

	#loading: Promise<void> | null = null;

	/** Loads once; later calls share the first load. */
	load(): Promise<void> {
		if (!this.#loading) this.#loading = this.refresh();
		return this.#loading;
	}

	/** Re-reads both rows, keeping what it has if the read fails. */
	async refresh(): Promise<void> {
		try {
			const [tiktok, instagram] = await Promise.all([loadTikTokCreator(), loadInstagramAccount()]);
			this.tiktok = tiktok;
			this.instagram = instagram;
		} catch {
			// A failed read leaves the previous rows in place.
		} finally {
			this.loaded = true;
		}
	}
}

export const accounts = new AccountsStore();
