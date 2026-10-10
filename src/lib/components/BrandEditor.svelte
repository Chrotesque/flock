<script lang="ts">
	import { brands } from '$lib/stores/brands.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { templates } from '$lib/stores/templates.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { brandNameProblem } from '$lib/brands';
	import { accountLabel, implicitChoices } from '$lib/accounts';
	import { PLATFORMS, PLATFORM_IDS } from '$lib/platforms';
	import PlatformIcon from './PlatformIcon.svelte';
	import type { Brand, PlatformId } from '$lib/types';

	/** Platforms the worker has reported at least one account for. */
	let connected = $derived(PLATFORM_IDS.filter((p) => accounts.forPlatform(p).length > 0));

	/** Sets, or clears with '', the account a brand posts as on a platform. */
	function onAccount(brand: Brand, platform: PlatformId, id: string) {
		const next = { ...brand.accounts };
		if (id) next[platform] = id;
		else delete next[platform];
		const chosen = accounts.forPlatform(platform).find((a) => a.account_id === id);
		const label = chosen
			? `posts to ${PLATFORMS[platform].label} as ${accountLabel(chosen)}`
			: `posts to ${PLATFORMS[platform].label} as no account`;
		void run(() => brands.setAccounts(brand, next, label));
	}

	/**
	 * A lone brand posts as each platform's only account without choosing
	 * (accounts.ts); a second brand ends that, so the first brand's accounts
	 * are written down as its choices before the second exists.
	 */
	async function addBrand() {
		if (brands.list.length === 1) {
			const first = brands.list[0];
			const choices = implicitChoices(first, accounts.list, PLATFORM_IDS);
			if (JSON.stringify(choices) !== JSON.stringify(first.accounts)) {
				await brands.setAccounts(first, choices, 'kept its accounts as chosen ones');
			}
		}
		await brands.add();
	}

	let busy = $state(false);
	let error = $state('');
	/** Per brand, why the name typed there cannot be saved. */
	let nameErrors = $state<Record<string, string>>({});

	/**
	 * Adding and deleting change which settings rows and template lists
	 * exist, so both stores reload afterwards; a rename or a move does not.
	 */
	async function run(action: () => Promise<unknown>, reload = false) {
		busy = true;
		error = '';
		try {
			await action();
			if (reload) await Promise.all([settings.load(true), templates.load(true)]);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	/** Saved on change (Enter or leaving the field), not per keystroke: a rename is logged. */
	function onName(brand: Brand, el: HTMLInputElement) {
		const name = el.value.trim();
		if (name === brand.name) {
			nameErrors[brand.id] = '';
			return;
		}
		const problem = brandNameProblem(name, brands.list, brand.id);
		nameErrors[brand.id] = problem;
		if (problem) return;
		void run(() => brands.rename(brand, name));
	}

	/* ---- delete confirmation ----
	 *
	 * The same two-press gate as everywhere else that cannot be undone: a brand
	 * takes its settings and templates with it.
	 */
	let armed = $state<string | null>(null);
	let armTimer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		armed = null;
		if (armTimer) clearTimeout(armTimer);
		armTimer = null;
	}

	function onDelete(brand: Brand) {
		if (armed === brand.id) {
			disarm();
			void run(() => brands.remove(brand), true);
			return;
		}
		disarm();
		armed = brand.id;
		armTimer = setTimeout(() => {
			armed = null;
			armTimer = null;
		}, 2000);
	}

	$effect(() => () => {
		if (armTimer) clearTimeout(armTimer);
	});
</script>

<div class="editor">
	<header>
		<div>
			<h4>Brands</h4>
			<p>
				Each brand has its own platform defaults, adaptation rules, release times and templates, and
				every upload is made for one of them. A new brand starts as a copy of the brand in view.
			</p>
		</div>
		<button class="btn sm" onclick={() => run(addBrand, true)} disabled={busy}>Add brand</button>
	</header>

	<ul>
		{#each brands.ordered as brand, index (brand.id)}
			<li class:current={brand.id === brands.currentId}>
				<div class="row">
					<input
						class="input name"
						value={brand.name}
						aria-label="Brand name"
						disabled={busy}
						onchange={(e) => onName(brand, e.currentTarget)}
						onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					/>

					{#if brand.id === brands.currentId}
						<span class="tag">in view</span>
					{:else}
						<button class="view" onclick={() => brands.select(brand.id)}>View</button>
					{/if}

					<div class="order">
						<button
							onclick={() => run(() => brands.move(brand.id, -1))}
							disabled={busy || index === 0}
							aria-label="Move {brand.name} up"
						>
							<svg viewBox="0 0 12 12" width="10" height="10"
								><path
									d="M2.5 7.5 6 4l3.5 3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.7"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</button>
						<button
							onclick={() => run(() => brands.move(brand.id, 1))}
							disabled={busy || index === brands.ordered.length - 1}
							aria-label="Move {brand.name} down"
						>
							<svg viewBox="0 0 12 12" width="10" height="10"
								><path
									d="M2.5 4.5 6 8l3.5-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.7"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</button>
					</div>

					<button
						class="del"
						class:armed={armed === brand.id}
						onclick={() => onDelete(brand)}
						onblur={disarm}
						disabled={busy || brands.list.length <= 1}
						title={brands.list.length <= 1 ? 'The last brand cannot be deleted' : ''}
						aria-label={armed === brand.id ? `Confirm deleting ${brand.name}` : `Delete ${brand.name}`}
					>
						{#if armed === brand.id}
							<span class="ask">?</span>
						{:else}
							<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
								><path
									d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
									fill="none"
									stroke="currentColor"
									stroke-width="1.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						{/if}
					</button>
				</div>
				{#if nameErrors[brand.id]}
					<p class="hint warn">{nameErrors[brand.id]}</p>
				{/if}

				{#if connected.length > 0}
					<!-- Which account this brand posts as, per platform the worker has accounts for. -->
					<div class="accounts">
						{#each connected as platform (platform)}
							{@const chosen = brand.accounts[platform] ?? ''}
							{@const list = accounts.forPlatform(platform)}
							{@const gone = chosen && !list.some((a) => a.account_id === chosen)}
							<label class="acct" class:unset={!chosen} class:gone>
								<PlatformIcon {platform} size={14} />
								<select
									class="input"
									value={chosen}
									disabled={busy}
									aria-label="{brand.name}: {PLATFORMS[platform].label} account"
									onchange={(e) => onAccount(brand, platform, e.currentTarget.value)}
								>
									<option value="">
										{brands.list.length === 1 && list.length === 1 ? 'Its only account' : 'No account'}
									</option>
									{#if gone}
										<option value={chosen}>Disconnected account</option>
									{/if}
									{#each list as account (account.id)}
										<option value={account.account_id}>
											{accountLabel(account)}{account.name && account.handle ? ` — ${account.name}` : ''}
										</option>
									{/each}
								</select>
							</label>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	{#if connected.length === 0}
		<p class="hint">
			No accounts listed yet. The worker lists the accounts it can post as here once it has run
			with them connected; then each brand picks its own.
		</p>
	{:else if brands.list.length > 1}
		<p class="hint">
			With more than one brand, a platform is only offered on an upload for a brand that has an
			account chosen for it — so one brand's post can never go out on another brand's account.
		</p>
	{/if}

	{#if error}
		<p class="hint error">{error}</p>
	{/if}

	<p class="hint foot">
		Deleting a brand removes its settings and templates. Its uploads stay in the Calendar and the
		log under its name, and anything already queued still goes out as it was composed.
	</p>
</div>

<style>
	.editor header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}

	h4 {
		font-size: 13.5px;
	}

	header p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
		max-width: 58ch;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	li {
		padding: 8px 10px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		display: grid;
		gap: 6px;
		transition: border-color 0.15s, background 0.15s;
	}

	li.current {
		border-color: rgba(255, 77, 158, 0.45);
		background: var(--accent-grad-soft);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.name {
		flex: 1;
		min-width: 0;
		padding: 8px 11px;
		font-size: 13px;
		font-weight: 560;
	}

	.tag,
	.view {
		flex: none;
		min-width: 58px;
		padding: 4px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		text-align: center;
	}

	.tag {
		color: var(--pink-soft);
	}

	.view {
		border: 1px solid var(--border-strong);
		color: var(--text-dim);
		transition: border-color 0.14s, color 0.14s;
	}

	.view:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.order {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: none;
	}

	.order button {
		width: 20px;
		height: 15px;
		display: grid;
		place-items: center;
		border-radius: 4px;
		color: var(--text-faint);
	}

	.order button:hover:not(:disabled) {
		background: var(--surface-3);
		color: var(--text);
	}

	.accounts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-left: 2px;
	}

	.acct {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 4px 3px 8px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
	}

	.acct select {
		padding: 4px 6px;
		font-size: 11.5px;
		min-width: 0;
		max-width: 220px;
	}

	.acct.unset {
		opacity: 0.75;
	}

	.acct.gone {
		border-color: rgba(251, 191, 36, 0.5);
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
		transition: background 0.14s, color 0.14s;
	}

	.del:hover:not(:disabled) {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.del:disabled {
		opacity: 0.35;
	}

	.del.armed,
	.del.armed:hover {
		background: var(--pink-hot);
		color: var(--bg-elev);
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.ask {
		font-size: 14px;
		font-weight: 800;
		line-height: 1;
	}

	.hint {
		margin: 0;
		font-size: 11px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.hint.warn {
		color: var(--warn);
	}

	.hint.error {
		margin-top: 10px;
		color: var(--danger);
	}

	.hint.foot {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
</style>
