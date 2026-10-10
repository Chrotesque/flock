<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import PlatformModal from './PlatformModal.svelte';
	import Checkbox from './Checkbox.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { draft } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { general } from '$lib/stores/general.svelte';
	import type { PlatformId } from '$lib/types';

	// The Details step's platform picker, in the page header beside the brand.
	// Every platform of the brand is a button with its mark: pressing one
	// writes for it (ticking it first if it was off). A corner badge says
	// whether a ticked platform is done (check) or still needs something (!).
	// Hovering a button shows, above it, its tick on the left — on or off for
	// this upload, starting as Settings has it — and a gear on the right for
	// its options. A platform the brand has no account for shows both too,
	// greyed out with the reason: it cannot be used until Settings → Brands
	// chooses its account, which is what keeps a post off another brand's.

	let items = $derived(
		settings.ordered.map((entry) => {
			const platform = entry.platform;
			const offered = accounts.offer(platform).offered;
			const on = offered && draft.isSelected(platform);
			return {
				platform,
				label: PLATFORMS[platform].label,
				offered,
				on,
				complete: on && draft.isComplete(platform)
			};
		})
	);

	let composing = $derived(
		draft.composing && draft.activePlatforms.includes(draft.composing) ? draft.composing : null
	);

	function compose(platform: PlatformId) {
		if (!draft.isSelected(platform)) draft.select(platform, true);
		draft.composing = platform;
	}

	/**
	 * Whether a platform's mark must keep its colour while it is off. An off
	 * button goes grey, but YouTube (with the compliance switch on), TikTok
	 * (its black or white only) and Facebook (its blue or white) forbid any
	 * other colour — fading white TikTok to grey is a recolour too — so their
	 * marks stay as they are and only the button around them dims. Instagram
	 * allows any solid colour, grey included.
	 */
	function keepsColour(platform: PlatformId): boolean {
		if (platform === 'youtube') return general.value.complianceBranding;
		return platform === 'tiktok' || platform === 'facebook';
	}

	function noAccount(label: string): string {
		return `${brands.current?.name ?? 'This brand'} has no ${label} account chosen. Choose one in Settings → Brands to post there.`;
	}

	function hint(item: (typeof items)[number]): string {
		if (!item.offered) return noAccount(item.label);
		if (!item.on) return `${item.label} is off for this upload. Click to turn it on and write for it.`;
		return item.complete ? `${item.label}: done` : `${item.label}: still to write`;
	}

	let modalOpen = $state(false);
	let modalPlatform = $state<PlatformId | null>(null);

	function openModal(platform: PlatformId) {
		modalPlatform = platform;
		modalOpen = true;
	}
</script>

<div class="platforms" role="group" aria-label="Platforms">
	{#each items as item (item.platform)}
		<div
			class="plat"
			class:off={!item.on}
			class:locked={!item.offered}
			class:keep={keepsColour(item.platform)}
		>
			<span class="controls" title={item.offered ? '' : noAccount(item.label)}>
				<Checkbox
					checked={item.on}
					disabled={!item.offered}
					ariaLabel="Post to {item.label} with this upload"
					onchange={(next) => draft.select(item.platform, next)}
				/>
				<button
					class="gear"
					disabled={!item.offered}
					onclick={() => openModal(item.platform)}
					aria-label="{item.label} options for this upload"
					title={item.offered ? `${item.label} options for this upload` : noAccount(item.label)}
				>
					<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
						<path
							d="M10.3 3.6a1.7 1.7 0 0 1 3.4 0 1.7 1.7 0 0 0 2.6 1.1 1.7 1.7 0 0 1 2.4 2.4 1.7 1.7 0 0 0 1.1 2.6 1.7 1.7 0 0 1 0 3.4 1.7 1.7 0 0 0-1.1 2.6 1.7 1.7 0 0 1-2.4 2.4 1.7 1.7 0 0 0-2.6 1.1 1.7 1.7 0 0 1-3.4 0 1.7 1.7 0 0 0-2.6-1.1 1.7 1.7 0 0 1-2.4-2.4 1.7 1.7 0 0 0-1.1-2.6 1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 1.1-2.6 1.7 1.7 0 0 1 2.4-2.4 1.7 1.7 0 0 0 2.6-1.1Z"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linejoin="round"
						/>
						<circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.7" />
					</svg>
				</button>
			</span>

			<button
				class="mark"
				class:active={composing === item.platform}
				aria-disabled={!item.offered}
				aria-pressed={composing === item.platform}
				aria-label="Write for {item.label}"
				title={hint(item)}
				onclick={() => item.offered && compose(item.platform)}
			>
				<PlatformIcon platform={item.platform} size={20} />
				{#if item.on}
					{#if item.complete}
						<span class="badge ok" aria-hidden="true">
							<svg viewBox="0 0 24 24" width="9" height="9" fill="none">
								<path
									d="M4 12.5 9.5 18 20 6.5"
									stroke="currentColor"
									stroke-width="3.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</span>
					{:else}
						<span class="badge todo" aria-hidden="true">!</span>
					{/if}
				{/if}
			</button>
		</div>
	{/each}
</div>

<PlatformModal bind:open={modalOpen} platform={modalPlatform} />

<style>
	.platforms {
		display: flex;
		gap: 10px;
	}

	/* The tick and the gear sit above the button, laid over the header
	   rather than taking room in it, so the row keeps the height of the
	   buttons. Their padding reaches down to the button, so moving the
	   pointer up onto them never leaves the hover. */
	.plat {
		position: relative;
	}

	.controls {
		position: absolute;
		bottom: 100%;
		left: 50%;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 6px;
		padding-bottom: 7px;
		transform: translateX(-50%);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.14s;
	}

	.plat:hover .controls,
	.plat:focus-within .controls {
		opacity: 1;
		pointer-events: auto;
	}

	/* No hover on a touch screen: keep them in view. */
	@media (hover: none) {
		.controls {
			opacity: 1;
			pointer-events: auto;
		}
	}

	.mark {
		position: relative;
		width: 44px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		transition: background 0.14s, border-color 0.14s;
	}

	.mark:hover:not([aria-disabled='true']) {
		border-color: var(--pink-soft);
	}

	.mark.active {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
	}

	.off .mark {
		background: transparent;
		border-style: dashed;
	}

	.off:not(.keep) .mark :global(svg.icon) {
		filter: grayscale(1);
		opacity: 0.45;
	}

	/* Dimmed like any off one, not faded as a whole: that would fade the
	   protected marks too. */
	.locked .mark {
		border-color: var(--border);
		cursor: not-allowed;
	}

	/* Done or not, as a badge on the button's corner. */
	.badge {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 15px;
		height: 15px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		border: 2px solid var(--surface);
		box-sizing: content-box;
	}

	.badge.todo {
		background: #fbbf24;
		color: #1a1305;
		font-size: 10px;
		font-weight: 850;
		line-height: 1;
	}

	.badge.ok {
		background: var(--ok);
		color: #fff;
	}

	.gear {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		color: var(--text-dim);
		transition: color 0.14s, border-color 0.14s;
	}

	.gear:hover:not(:disabled) {
		color: var(--pink);
		border-color: var(--pink-soft);
	}
</style>
