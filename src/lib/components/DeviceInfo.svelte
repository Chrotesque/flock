<script lang="ts">
	import { base } from '$app/paths';
	import { users } from '$lib/stores/users.svelte';

	// Display only: picking and switching happen in the gate and under Profiles.
	let current = $derived(users.current);
</script>

<div class="named">
	<span class="devicename">{current?.name ?? '…'}</span>
	<a class="user" href="{base}/settings?section=users">Switch or manage profiles</a>
</div>

<style>
	.named {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 13px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
	}

	.devicename {
		font-size: 13px;
		font-weight: 620;
		color: var(--text);
	}

	.user {
		margin-left: auto;
		font-size: 12px;
		color: var(--text-dim);
		text-decoration: none;
	}

	.user:hover {
		color: var(--pink-soft);
	}
</style>
