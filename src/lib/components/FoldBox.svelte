<script lang="ts">
	import type { Snippet } from 'svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import type { PlatformId } from '$lib/types';

	// A side box that folds to one line once its job is done — a file chosen, a
	// playlist picked — so the finished parts of the compose screen stop taking
	// the space of the unfinished ones. It folds the moment `done` turns true,
	// unfolds if that is undone (the file removed), and in between the header
	// toggles it at will.
	let {
		label,
		done = false,
		summary = '',
		platforms = [],
		children
	}: {
		label: string;
		done?: boolean;
		summary?: string;
		/** Which platforms this box serves, shown as small icons after the label. */
		platforms?: PlatformId[];
		children: Snippet;
	} = $props();

	let collapsed = $state(false);

	// Depends on `done` only; writing `collapsed` here is what makes a fresh
	// selection fold the box without also re-folding it on every render.
	$effect(() => {
		collapsed = done;
	});
</script>

{#snippet heading()}
	<span class="label">
		{label}
		{#if platforms.length > 0}
			<span class="icons">
				{#each platforms as platform (platform)}
					<PlatformIcon {platform} size={13} />
				{/each}
			</span>
		{/if}
	</span>
{/snippet}

<section class="box card" class:collapsed>
	{#if done}
		<button
			class="head"
			onclick={() => (collapsed = !collapsed)}
			aria-expanded={!collapsed}
			title={collapsed ? 'Show' : 'Hide'}
		>
			<svg class="chevron" class:open={!collapsed} viewBox="0 0 16 16" aria-hidden="true">
				<path
					d="M6 3.5l4.5 4.5L6 12.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			{@render heading()}
			<svg class="check" viewBox="0 0 16 16" aria-label="done">
				<path
					d="M3 8.5l3.2 3.2L13 5"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			{#if summary}
				<span class="summary" title={summary}>{summary}</span>
			{/if}
		</button>
	{:else}
		{@render heading()}
	{/if}

	{#if !collapsed}
		{@render children()}
	{/if}
</section>

<style>
	.box {
		padding: 18px 16px;
		display: grid;
		gap: 4px;
		/* Grid items default to min-width: auto, which lets a long file name push
		   the box out of its column. */
		min-width: 0;
	}

	.box.collapsed {
		padding: 12px 16px;
		gap: 0;
	}

	.box > :global(*) {
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		margin: 0 0 4px;
		padding: 0;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.collapsed .head {
		margin-bottom: 0;
	}

	.head .label {
		margin: 0;
	}

	.icons {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: 7px;
		vertical-align: -2px;
	}

	.chevron {
		flex: none;
		width: 14px;
		height: 14px;
		color: var(--text-faint);
		transition: transform 0.15s;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.head:hover .chevron {
		color: var(--text);
	}

	.check {
		flex: none;
		width: 15px;
		height: 15px;
		color: var(--ok);
	}

	.summary {
		min-width: 0;
		margin-left: auto;
		font-size: 11.5px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
