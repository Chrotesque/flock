<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import { paste } from '$lib/stores/paste.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import type { PlatformId } from '$lib/types';

	// What a pasted flock block filled, in the corner of every page. A clean
	// fill closes itself; anything that needs reading — a note, a failed or
	// still-coming thumbnail, a block that could not be used — stays until
	// closed.
	let notice = $derived(paste.notice);
	let clean = $derived(
		Boolean(notice) &&
			!notice!.error &&
			notice!.notes.length === 0 &&
			(!notice!.thumbnail || notice!.thumbnail.state === 'done')
	);

	$effect(() => {
		if (!clean) return;
		const timer = setTimeout(() => paste.dismiss(), 10_000);
		return () => clearTimeout(timer);
	});

	/** Named in the block but not offered for the brand: ticked, yet not going out. */
	function unoffered(id: PlatformId): boolean {
		return settings.ordered.length > 0 && !settings.available.some((entry) => entry.platform === id);
	}
</script>

{#if notice}
	<aside class="notice" class:bad={Boolean(notice.error)} role="status" aria-live="polite">
		<header>
			<strong>{notice.error ? 'Nothing pasted' : 'Filled from paste'}</strong>
			{#if notice.brand}<span class="brand">for {notice.brand}</span>{/if}
			<button class="close" onclick={() => paste.dismiss()} aria-label="Close">
				<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
				</svg>
			</button>
		</header>

		{#if notice.error}
			<p class="error">{notice.error}</p>
		{/if}

		{#if notice.platforms.length > 0}
			<ul class="filled">
				{#each notice.platforms as entry (entry.id)}
					<li class:off={unoffered(entry.id)}>
						<PlatformIcon platform={entry.id} size={15} />
						<span class="what-for">{PLATFORMS[entry.id].label}</span>
						<span class="what">
							{unoffered(entry.id) ? 'not offered for this brand' : entry.summary}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if notice.thumbnail}
			<p class="thumb {notice.thumbnail.state}" title={notice.thumbnail.path}>
				<span class="what-for">Thumbnail</span>
				{#if notice.thumbnail.state === 'fetching'}
					fetching from the worker…
				{:else}
					{notice.thumbnail.message}
				{/if}
			</p>
		{/if}

		{#if notice.notes.length > 0}
			<ul class="notes">
				{#each notice.notes as note, i (i)}
					<li>{note}</li>
				{/each}
			</ul>
		{/if}
	</aside>
{/if}

<style>
	.notice {
		position: fixed;
		right: 20px;
		bottom: 20px;
		z-index: 60;
		width: min(380px, calc(100vw - 32px));
		padding: 12px 14px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface-2);
		box-shadow: var(--shadow);
		font-size: 13px;
	}

	.notice.bad {
		border-color: rgba(248, 113, 113, 0.5);
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 8px;
	}

	header strong {
		font-size: 13.5px;
	}

	.brand {
		color: var(--text-dim);
	}

	.close {
		margin-left: auto;
		align-self: center;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}

	.close:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.filled li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}

	.filled li.off {
		color: var(--text-faint);
	}

	.what-for {
		flex: none;
		min-width: 74px;
		color: var(--text-dim);
	}

	.what {
		min-width: 0;
	}

	.thumb {
		display: flex;
		gap: 8px;
		margin: 6px 0 0;
		overflow-wrap: anywhere;
	}

	.thumb.waiting {
		color: var(--warn);
	}

	.thumb.failed {
		color: var(--danger);
	}

	.thumb.done {
		color: var(--ok);
	}

	.error {
		margin: 0;
		color: var(--danger);
	}

	.notes {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
		color: var(--warn);
	}

	.notes li + li {
		margin-top: 3px;
	}
</style>
