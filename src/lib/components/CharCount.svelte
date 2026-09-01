<script lang="ts">
	let { value, limit }: { value: string; limit: number } = $props();

	let used = $derived(value.length);
	let ratio = $derived(limit ? used / limit : 0);
	let state = $derived(ratio > 1 ? 'over' : ratio > 0.9 ? 'near' : 'ok');
</script>

<span class="count {state}">{used.toLocaleString()} / {limit.toLocaleString()}</span>

<style>
	.count {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-faint);
		white-space: nowrap;
	}
	.near {
		color: var(--warn);
	}
	.over {
		color: var(--danger);
		font-weight: 650;
	}
</style>
