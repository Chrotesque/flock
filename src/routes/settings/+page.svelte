<script lang="ts">
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import Checkbox from '$lib/components/Checkbox.svelte';
	import OptionEditor from '$lib/components/OptionEditor.svelte';
	import FilterEditor from '$lib/components/FilterEditor.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { settings } from '$lib/stores/settings.svelte';
	import { VERSION } from '$lib/version';
	import { PB_URL } from '$lib/pb';
	import type { FilterRule, OptionValues, PlatformId } from '$lib/types';

	settings.load();

	let active = $state<PlatformId>('youtube');
	let tab = $state<'defaults' | 'filters'>('defaults');

	let entry = $derived(settings.get(active));
	let def = $derived(PLATFORMS[active]);

	function onDefaultsChanged(values: OptionValues) {
		if (!entry) return;
		entry.defaults = values;
		settings.queueSave(active);
	}

	function onFiltersChanged(next: FilterRule[]) {
		if (!entry) return;
		entry.filters = next;
		settings.queueSave(active);
	}

	function resetDefaults() {
		if (!entry) return;
		entry.defaults = { ...PLATFORMS[active].defaults };
		settings.queueSave(active);
	}
</script>

<div class="page">
	<header class="head">
		<div>
			<h1>Settings</h1>
			<p>Display order, per-platform defaults, and the adaptation rules.</p>
		</div>
		{#if settings.saving}
			<span class="pill saving">Saving…</span>
		{/if}
	</header>

	{#if settings.error}
		<p class="banner error">Could not reach PocketBase — {settings.error}</p>
	{/if}

	{#if settings.loading}
		<p class="banner">Loading…</p>
	{:else}
		<div class="split">
			<aside class="card list">
				<h3>Platforms</h3>
				<p class="note">
					This order is used everywhere — the compose rail, the schedule list and the confirmation
					screen.
				</p>

				<ul>
					{#each settings.ordered as item, index (item.platform)}
						<li class:active={active === item.platform} class:off={!item.enabled}>
							<button class="pick" onclick={() => (active = item.platform)}>
								<span class="ic"><PlatformIcon platform={item.platform} size={18} /></span>
								<span class="who">
									<span class="name">{PLATFORMS[item.platform].label}</span>
									<span class="sub">
										{item.filters.length}
										{item.filters.length === 1 ? 'rule' : 'rules'}
									</span>
								</span>
							</button>

							<div class="order">
								<button
									onclick={() => settings.move(item.platform, -1)}
									disabled={index === 0}
									aria-label="Move {PLATFORMS[item.platform].label} up"
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
									onclick={() => settings.move(item.platform, 1)}
									disabled={index === settings.ordered.length - 1}
									aria-label="Move {PLATFORMS[item.platform].label} down"
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

							<Checkbox
								checked={item.enabled}
								onchange={(next) => {
									item.enabled = next;
									settings.queueSave(item.platform);
								}}
							/>
						</li>
					{/each}
				</ul>

				<p class="note foot">
					The checkbox sets whether a platform starts selected on a new upload. It does not remove
					the platform.
				</p>
			</aside>

			<section class="card panel">
				<header class="panelhead">
					<div class="ident">
						<span class="ic big"><PlatformIcon platform={active} size={22} /></span>
						<div>
							<h2>{def.label}</h2>
							<p>
								{def.fieldNote} Title limit {def.titleLimit.toLocaleString()}, description limit
								{def.descriptionLimit.toLocaleString()}.
							</p>
						</div>
					</div>
				</header>

				<div class="tabs">
					<button class:active={tab === 'defaults'} onclick={() => (tab = 'defaults')}>
						Defaults
					</button>
					<button class:active={tab === 'filters'} onclick={() => (tab = 'filters')}>
						Adaptations
						{#if entry && entry.filters.length > 0}
							<span class="dot">{entry.filters.length}</span>
						{/if}
					</button>
				</div>

				{#if entry}
					{#if tab === 'defaults'}
						<div class="defaults">
							<div class="subhead">
								<div>
									<h4>Default publish options</h4>
									<p>
										Pre-filled on every new upload. Changing them on an upload only affects that
										upload.
									</p>
								</div>
								<button class="btn sm" onclick={resetDefaults}>Reset</button>
							</div>

							<OptionEditor
								fields={def.fields}
								values={entry.defaults}
								onchange={() => onDefaultsChanged(entry.defaults)}
							/>

							<p class="footnote">
								Every option above is a placeholder invented to give the interface something real to
								show. Once the {def.label} API is connected, expect this whole set to be replaced.
							</p>
						</div>
					{:else}
						<FilterEditor
							rules={entry.filters}
							label={def.label}
							onchange={onFiltersChanged}
						/>
					{/if}
				{/if}
			</section>
		</div>

		<footer class="version">
			<span>flock {VERSION}</span>
			<span class="sep">·</span>
			<span class="mono">{PB_URL}</span>
		</footer>
	{/if}
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.saving {
		background: var(--accent-grad-soft);
		color: var(--pink-soft);
	}

	.banner {
		margin: 0 0 16px;
		padding: 11px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.error {
		border-color: rgba(248, 113, 113, 0.4);
		color: var(--danger);
	}

	.split {
		display: grid;
		grid-template-columns: 310px minmax(0, 1fr);
		gap: 18px;
		align-items: start;
	}

	.list {
		padding: 18px 16px;
	}

	h3 {
		font-size: 14px;
	}

	.note {
		margin: 5px 0 14px;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.note.foot {
		margin: 14px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 10px 4px 4px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.15s, background 0.15s, opacity 0.15s;
	}

	li.off {
		opacity: 0.5;
	}

	li.active {
		border-color: rgba(255, 77, 158, 0.45);
		background: var(--accent-grad-soft);
	}

	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 2px 8px 7px;
		text-align: left;
	}

	.ic {
		flex: none;
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	.ic.big {
		width: 40px;
		height: 40px;
		border-radius: 12px;
	}

	.name {
		display: block;
		font-size: 13px;
		font-weight: 570;
	}

	.sub {
		display: block;
		font-size: 10.5px;
		color: var(--text-faint);
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

	.panel {
		padding: 20px 22px 24px;
	}

	.panelhead {
		margin-bottom: 18px;
	}

	.ident {
		display: flex;
		align-items: center;
		gap: 13px;
	}

	h2 {
		font-size: 17px;
	}

	.ident p {
		margin: 3px 0 0;
		font-size: 12px;
		color: var(--text-dim);
		max-width: 62ch;
		line-height: 1.5;
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: 20px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 10px;
		width: fit-content;
	}

	.tabs button {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 16px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text-dim);
		transition: background 0.15s, color 0.15s;
	}

	.tabs button:hover {
		color: var(--text);
	}

	.tabs button.active {
		background: var(--surface-3);
		color: var(--text);
	}

	.dot {
		min-width: 17px;
		height: 17px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--accent-grad);
		color: #fff;
		font-size: 10.5px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}

	.subhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
	}

	h4 {
		font-size: 13.5px;
	}

	.subhead p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		max-width: 54ch;
		line-height: 1.5;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.footnote {
		margin: 22px 0 0;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.55;
	}

	.version {
		margin-top: 26px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.sep {
		opacity: 0.5;
	}

	@media (max-width: 940px) {
		.split {
			grid-template-columns: 1fr;
		}
	}
</style>
