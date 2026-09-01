<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import type { PlatformId } from '$lib/types';

	// The card that appears in a week grid cell. Shared by the upload wizard's
	// schedule step and the standalone Calendar, so the two read identically.
	//
	// `compact` reduces it to a draggable icon; the text is then only shown on a
	// deliberate hover, which is what keeps a week of four platforms readable.
	let {
		platform,
		time,
		title,
		description = '',
		muted = false,
		status = '',
		dim = false,
		compact = false
	}: {
		platform: PlatformId;
		time: string;
		title: string;
		description?: string;
		/** Already released (or past due) — greyed back, still legible. */
		muted?: boolean;
		status?: string;
		/** Mid-drag ghosting. */
		dim?: boolean;
		/** Icon only, with the detail behind a hover. */
		compact?: boolean;
	} = $props();

	const HOVER_DELAY = 1000;

	/**
	 * Moves the tooltip to <body>. `position: fixed` resolves against the nearest
	 * ancestor with a transform, and both the drag slot and the tile itself
	 * translate on hover — precisely when the tooltip is up — which pinned it to
	 * the card instead of the viewport. Scoped styles survive the move because
	 * Svelte scopes by class, not by tree position.
	 */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	let tile = $state<HTMLDivElement | null>(null);
	let showTip = $state(false);
	let tipX = $state(0);
	let tipY = $state(0);
	let tipBelow = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function open() {
		const el = tile;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		// Fixed positioning: an absolutely positioned tip would be clipped by the
		// grid's own scroll container.
		tipX = rect.left + rect.width / 2;
		tipBelow = rect.top < 170;
		tipY = tipBelow ? rect.bottom + 8 : rect.top - 8;
		showTip = true;
	}

	function onEnter() {
		if (!compact) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(open, HOVER_DELAY);
	}

	function onLeave() {
		if (timer) clearTimeout(timer);
		timer = null;
		showTip = false;
	}

	$effect(() => () => {
		if (timer) clearTimeout(timer);
	});
</script>

{#if compact}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="tile {platform}"
		class:muted
		class:dim
		bind:this={tile}
		aria-label="{PLATFORMS[platform].label} at {time} — {title}"
		onmouseenter={onEnter}
		onmouseleave={onLeave}
		ondragstart={onLeave}
	>
		<PlatformIcon {platform} size={17} />
	</div>

	{#if showTip}
		<div
			class="detailtip"
			class:below={tipBelow}
			style="left: {tipX}px; top: {tipY}px"
			role="tooltip"
			use:portal
		>
			<div class="tiphead">
				<PlatformIcon {platform} size={13} />
				<span class="tipwho">{PLATFORMS[platform].label}</span>
				<span class="tiptime">{time}</span>
			</div>
			<p class="tiptitle">{title || '(no title)'}</p>
			{#if description}
				<p class="tipbody">{description}</p>
			{/if}
		</div>
	{/if}
{:else}
	<div class="post {platform}" class:muted class:dim>
		<div class="posthead">
			<PlatformIcon {platform} size={14} />
			<span class="time">{time}</span>
		</div>
		<p class="posttitle">{title || '(no title)'}</p>
		{#if description}
			<p class="postbody">{description}</p>
		{/if}
		{#if status}
			<span class="status">{status}</span>
		{/if}
	</div>
{/if}

<style>
	/* ---- compact tile ---- */

	.tile {
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-left: 3px solid var(--text-faint);
		transition: transform 0.08s, box-shadow 0.14s, border-color 0.14s;
	}

	.tile:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
	}

	.tile.youtube {
		border-left-color: #e8484a;
	}
	.tile.instagram {
		border-left-color: #d6558f;
	}
	.tile.tiktok {
		border-left-color: #3de0dc;
	}
	.tile.facebook {
		border-left-color: #3b82f6;
	}

	.tile.muted {
		opacity: 0.42;
		filter: grayscale(0.85);
	}

	.tile.dim {
		opacity: 0.4;
	}

	/* ---- hover detail ---- */

	.detailtip {
		position: fixed;
		z-index: 40;
		width: 260px;
		transform: translate(-50%, -100%);
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
		pointer-events: none;
		animation: tipin 0.12s ease;
	}

	.detailtip.below {
		transform: translate(-50%, 0);
	}

	.tiphead {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 5px;
	}

	.tipwho {
		font-size: 11px;
		font-weight: 620;
		color: var(--text-dim);
	}

	.tiptime {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.tiptitle {
		margin: 0;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1.35;
	}

	.tipbody {
		margin: 5px 0 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-dim);
		white-space: pre-wrap;
		max-height: 128px;
		overflow: hidden;
	}

	@keyframes tipin {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.detailtip {
			animation: none;
		}
		.tile {
			transition: none;
		}
	}

	/* ---- full card ---- */

	.post {
		border-radius: 8px;
		padding: 7px 8px 8px;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-left: 3px solid var(--text-faint);
		transition: border-color 0.14s, transform 0.06s, box-shadow 0.14s, opacity 0.14s;
	}

	.post.youtube {
		border-left-color: #e8484a;
	}
	.post.instagram {
		border-left-color: #d6558f;
	}
	.post.tiktok {
		border-left-color: #3de0dc;
	}
	.post.facebook {
		border-left-color: #3b82f6;
	}

	/* Released or past due: pushed back, but not so far it cannot be read. */
	.post.muted {
		opacity: 0.42;
		background: var(--bg-elev);
		border-color: var(--border);
		filter: grayscale(0.85);
	}

	.post.muted:hover {
		opacity: 0.75;
		filter: grayscale(0.4);
	}

	.post.dim {
		opacity: 0.4;
	}

	.posthead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin-bottom: 3px;
	}

	.time {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text-faint);
	}

	.posttitle {
		margin: 0;
		font-size: 11.5px;
		font-weight: 600;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.postbody {
		margin: 3px 0 0;
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--text-faint);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.status {
		display: inline-block;
		margin-top: 5px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--surface-3);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
</style>
