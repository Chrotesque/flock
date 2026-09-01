<script lang="ts">
	import type { FilterHit } from '$lib/types';

	// The "quick overview of modifications" shown inside a platform's modal:
	// which adaptation rules fired for this particular video, and how often.
	let { hits, compact = false }: { hits: FilterHit[]; compact?: boolean } = $props();

	let fired = $derived(hits.filter((h) => !h.error));
	let broken = $derived(hits.filter((h) => h.error));
</script>

{#if hits.length === 0}
	<p class="none">No adaptations applied — this platform gets the text unchanged.</p>
{:else}
	<ul class="list" class:compact>
		{#each fired as hit (hit.ruleId + hit.find)}
			<li>
				<code class="from">{hit.find}</code>
				<svg viewBox="0 0 16 10" width="15" height="9" aria-hidden="true">
					<path
						d="M1 5h13M10 1l4 4-4 4"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<code class="to">{hit.replace || '(removed)'}</code>
				<span class="count">{hit.count}×</span>
			</li>
		{/each}
		{#each broken as hit (hit.ruleId)}
			<li class="broken">
				<code class="from">{hit.find}</code>
				<span class="err">invalid pattern — skipped</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.none {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: var(--radius-sm);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 12px;
	}

	.compact li {
		padding: 5px 8px;
	}

	li svg {
		flex: none;
		color: var(--text-faint);
	}

	code {
		font-family: var(--mono);
		font-size: 11.5px;
		padding: 2px 6px;
		border-radius: 5px;
		max-width: 42%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.from {
		background: rgba(248, 113, 113, 0.12);
		color: #f9a8a8;
	}

	.to {
		background: rgba(52, 211, 153, 0.12);
		color: #6ee7b7;
	}

	.count {
		margin-left: auto;
		flex: none;
		font-size: 11px;
		font-weight: 650;
		color: var(--text-faint);
	}

	.broken {
		border-color: rgba(248, 113, 113, 0.4);
	}

	.err {
		font-size: 11.5px;
		color: var(--danger);
	}
</style>
