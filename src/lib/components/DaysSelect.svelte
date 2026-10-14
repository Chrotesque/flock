<script lang="ts">
	import type { DaysShown } from '$lib/stores/daysshown.svelte';

	/** "Show N days" beside a week grid; the choice lives in a `DaysShown`. */
	let { days }: { days: DaysShown } = $props();
</script>

<label class="days">
	Show
	<select value={days.shown} onchange={(e) => days.set(Number(e.currentTarget.value))} aria-label="Days shown">
		{#each days.choices as n (n)}
			<option value={n}>{n}</option>
		{/each}
	</select>
	days
</label>

<style>
	.days {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: 14px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.days select {
		padding: 4px 8px;
		border-radius: 7px;
		border: 1px solid var(--border);
		background: var(--bg-elev);
		color: var(--text);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
</style>
