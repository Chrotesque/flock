<script lang="ts">
	import { base } from '$app/paths';
	import VideoPicker from '../VideoPicker.svelte';
	import PlatformIcon from '../PlatformIcon.svelte';
	import Checkbox from '../Checkbox.svelte';
	import PlatformModal from '../PlatformModal.svelte';
	import CharCount from '../CharCount.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { adapt } from '$lib/filters';
	import { draft } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import type { PlatformId } from '$lib/types';

	let modalOpen = $state(false);
	let modalPlatform = $state<PlatformId | null>(null);

	function openModal(platform: PlatformId) {
		modalPlatform = platform;
		modalOpen = true;
	}

	// One adaptation pass per platform, so the rail can show at a glance how
	// much each platform's text differs from what was typed. Only platforms
	// enabled in Settings appear here at all.
	let summaries = $derived(
		settings.available.map((entry) => {
			const def = PLATFORMS[entry.platform];
			const result = adapt(draft.title, draft.description, entry.filters);
			return {
				platform: entry.platform,
				def,
				hits: result.totalHits,
				errors: result.errors,
				overLimit:
					result.title.output.length > def.titleLimit ||
					result.description.output.length > def.descriptionLimit,
				overridden: Object.keys(draft.overrides[entry.platform] ?? {}).length > 0
			};
		})
	);
</script>

<div class="stage">
	<section class="main card">
		<div class="field">
			<div class="fieldhead">
				<label class="label" for="title">Title</label>
				<CharCount value={draft.title} limit={100} />
			</div>
			<input
				id="title"
				class="input"
				bind:value={draft.title}
				placeholder="One title — each platform adapts it"
				autocomplete="off"
			/>
		</div>

		<div class="field">
			<div class="fieldhead">
				<label class="label" for="description">Description</label>
				<CharCount value={draft.description} limit={5000} />
			</div>
			<textarea
				id="description"
				class="textarea"
				bind:value={draft.description}
				placeholder="One description. Platform-specific quirks are handled by the adaptation rules in Settings."
			></textarea>
		</div>

		<div class="field">
			<span class="label">Video file</span>
			<VideoPicker bind:file={draft.file} bind:duration={draft.duration} />
		</div>
	</section>

	<aside class="rail card">
		<header>
			<h3>Platforms</h3>
			<span class="pill">{draft.activePlatforms.length} of {summaries.length}</span>
		</header>

		<p class="railnote">Click a platform to review its options and adapted text.</p>

		<ul>
			{#each summaries as item (item.platform)}
				<li class:off={!draft.selected[item.platform]}>
					<button class="open" onclick={() => openModal(item.platform)}>
						<span class="ic"><PlatformIcon platform={item.platform} size={19} /></span>
						<span class="who">
							<span class="name">{item.def.label}</span>
							<span class="tags">
								{#if item.errors > 0}
									<span class="tag bad">rule error</span>
								{:else if item.hits > 0}
									<span class="tag">{item.hits} adapted</span>
								{/if}
								{#if item.overLimit}
									<span class="tag warn">over limit</span>
								{/if}
								{#if item.overridden}
									<span class="tag alt">custom</span>
								{/if}
							</span>
						</span>
						<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
							<path
								d="M9 6l6 6-6 6"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<span class="check">
						<Checkbox
							checked={draft.selected[item.platform]}
							onchange={(next) => (draft.selected[item.platform] = next)}
						/>
					</span>
				</li>
			{/each}
		</ul>

		{#if summaries.length === 0}
			<p class="warnbox">
				No platforms are enabled. Turn one on in <a href="{base}/settings">Settings</a>.
			</p>
		{:else if draft.activePlatforms.length === 0}
			<p class="warnbox">Select at least one platform to continue.</p>
		{/if}
	</aside>
</div>

<PlatformModal bind:open={modalOpen} platform={modalPlatform} />

<style>
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 20px;
		align-items: start;
	}

	.main {
		padding: 22px;
		display: grid;
		gap: 20px;
	}

	.fieldhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.fieldhead .label {
		margin-bottom: 8px;
	}

	.rail {
		padding: 18px 16px;
		position: sticky;
		top: 0;
	}

	.rail header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	h3 {
		font-size: 14px;
	}

	.railnote {
		margin: 0 0 14px;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.45;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 7px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px 4px 4px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.16s, opacity 0.16s, background 0.16s;
	}

	li:hover {
		border-color: var(--border-strong);
	}

	li.off {
		opacity: 0.42;
	}

	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 4px 8px 7px;
		color: var(--text-dim);
		text-align: left;
	}

	.open:hover {
		color: var(--text);
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

	.who {
		min-width: 0;
		flex: 1;
	}

	.name {
		display: block;
		font-size: 13px;
		font-weight: 570;
		color: var(--text);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}

	.tag {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 999px;
		background: rgba(168, 85, 247, 0.16);
		color: #cfa8fb;
	}

	.tag.alt {
		background: rgba(255, 77, 158, 0.16);
		color: var(--pink-soft);
	}

	.tag.warn {
		background: rgba(251, 191, 36, 0.16);
		color: var(--warn);
	}

	.tag.bad {
		background: rgba(248, 113, 113, 0.16);
		color: var(--danger);
	}

	.check {
		flex: none;
	}

	.warnbox {
		margin: 14px 0 0;
		padding: 9px 11px;
		border-radius: var(--radius-sm);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		color: var(--warn);
		font-size: 11.5px;
	}

	.warnbox a {
		color: inherit;
		font-weight: 600;
	}

	@media (max-width: 1040px) {
		.stage {
			grid-template-columns: 1fr;
		}
		.rail {
			position: static;
		}
	}
</style>
