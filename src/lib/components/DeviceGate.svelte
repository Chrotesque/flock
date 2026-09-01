<script lang="ts">
	import type { Snippet } from 'svelte';
	import DeviceSetup from './DeviceSetup.svelte';
	import { device } from '$lib/stores/device.svelte';

	/**
	 * Covers a page until this browser has been named.
	 *
	 * This is the *visible* half of the rule only. Hiding an overlay or
	 * re-enabling a control in devtools gets you back to the page but not past
	 * the block: every write calls `assertDeviceNamed()` before it touches
	 * PocketBase, so the change is refused at the point it would take effect.
	 */
	let { children, what }: { children: Snippet; what: string } = $props();

	let named = $derived(device.named);
</script>

{#if named}
	{@render children()}
{:else}
	<div class="gated">
		<!-- inert: not merely dimmed, so nothing behind is focusable or clickable -->
		<div class="behind" inert>
			{@render children()}
		</div>

		<div class="veil">
			<div class="panel card">
				<div class="mark">
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
						<path
							d="M12 8.5v5M12 16.8v.2M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>

				<h2>Name this device first</h2>
				<p>
					{what} is locked until this browser has a name. The Log records which machine made every
					change, and it cannot do that for an unnamed one.
				</p>

				<DeviceSetup />
			</div>
		</div>
	</div>
{/if}

<style>
	.gated {
		position: relative;
	}

	.behind {
		filter: grayscale(0.7) blur(1.5px);
		opacity: 0.35;
		pointer-events: none;
		user-select: none;
	}

	.veil {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 40px 20px;
		z-index: 10;
	}

	.panel {
		width: min(520px, 100%);
		padding: 26px 28px 24px;
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
	}

	.mark {
		width: 42px;
		height: 42px;
		display: grid;
		place-items: center;
		border-radius: 12px;
		margin-bottom: 14px;
		background: rgba(251, 191, 36, 0.13);
		border: 1px solid rgba(251, 191, 36, 0.35);
		color: var(--warn);
	}

	h2 {
		font-size: 18px;
	}

	.panel p {
		margin: 8px 0 18px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-dim);
	}
</style>
