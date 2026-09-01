<script lang="ts">
	import { deviceName } from '$lib/log';
	import { device } from '$lib/stores/device.svelte';

	// Display only. Naming happens in the gate that covers every page until it
	// is done, so offering the form again here would be an option that can never
	// be reached.
	let named = $derived(device.named);
	let name = $derived(named ? deviceName() : '');
</script>

{#if named}
	<div class="named">
		<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
			<path
				d="M7 10.5V8a5 5 0 0 1 10 0v2.5M6 10.5h12a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="devicename">{name}</span>
		<span class="lockhint">Set — this cannot be changed.</span>
	</div>
{:else}
	<p class="pending">
		This browser has not been named yet. Everything stays locked until it is.
	</p>
{/if}

<style>
	.named {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 13px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		color: var(--text-faint);
	}

	.devicename {
		font-size: 13px;
		font-weight: 620;
		color: var(--text);
	}

	.lockhint {
		font-size: 11.5px;
	}

	.pending {
		margin: 0;
		padding: 10px 13px;
		border-radius: var(--radius);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		font-size: 12px;
		color: var(--warn);
	}
</style>
