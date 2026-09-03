<script lang="ts">
	import TagInput from './TagInput.svelte';
	import { tagSets } from '$lib/stores/tagsets.svelte';
	import { tagListLength } from '$lib/format';

	// `limit` is the platform's whole budget, shown against each set so it is
	// obvious when one set alone would fill it.
	let { limit = 500 }: { limit?: number } = $props();

	let open = $state<string | null>(null);

	function add() {
		open = tagSets.add();
	}
</script>

<div class="wrap">
	<div class="subhead">
		<div>
			<h4>Tag sets</h4>
			<p>
				Named groups of tags you can drop into any tag box while composing. Build the collection
				once here — for a series, a genre, a recurring sponsor — rather than pasting the same list
				into every video.
			</p>
		</div>
		<button class="btn sm" onclick={add}>Add set</button>
	</div>

	{#if tagSets.loading}
		<p class="empty">Loading…</p>
	{:else if tagSets.items.length === 0}
		<p class="empty">
			No sets yet. Add one, name it after what it describes, then paste its tags in.
		</p>
	{:else}
		<ul>
			{#each tagSets.items as set (set.id)}
				{@const cost = tagListLength(set.tags)}
				<li>
					<div class="row">
						<button
							class="twist"
							class:open={open === set.id}
							onclick={() => (open = open === set.id ? null : set.id)}
							aria-label={open === set.id ? 'Collapse' : 'Expand'}
						>
							<svg viewBox="0 0 24 24" width="13" height="13" fill="none">
								<path
									d="M9 6l6 6-6 6"
									stroke="currentColor"
									stroke-width="1.9"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>

						<input
							class="input sm name"
							value={set.name}
							oninput={(e) => tagSets.update(set.id, { name: e.currentTarget.value })}
							placeholder="Set name — e.g. sinking city 2"
							autocomplete="off"
						/>

						<span class="cost" class:heavy={cost > limit}>
							{set.tags.length}
							{set.tags.length === 1 ? 'tag' : 'tags'} · {cost} chars
						</span>

						<button
							class="del"
							onclick={() => tagSets.remove(set.id)}
							aria-label="Delete {set.name.trim() || 'this set'}"
						>
							<svg viewBox="0 0 24 24" width="14" height="14" fill="none">
								<path
									d="M5 7h14M10 7V5.5h4V7m-7 0 .8 12h8.4L17 7"
									stroke="currentColor"
									stroke-width="1.7"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					</div>

					{#if open === set.id}
						<div class="body">
							<TagInput
								value={set.tags}
								placeholder="Paste or type"
								hint="Paste a comma-separated list, or type one and press Enter. Duplicates are dropped."
								clearable
								label="Tags in this set"
								onchange={(next) => tagSets.update(set.id, { tags: next })}
							/>
							{#if cost > limit}
								<p class="warnbox">
									This set alone is {cost} characters — more than the {limit} a video is allowed
									across all its tags. Adding it will always overflow.
								</p>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<p class="hint">
			A video allows {limit} characters across every tag box combined. The figure beside each set is
			what that set costs on its own, so you can tell in advance whether two will fit together.
		</p>
	{/if}
</div>

<style>
	.wrap {
		display: grid;
		gap: 14px;
	}

	.subhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	h4 {
		margin: 0 0 4px;
		font-size: 14px;
	}

	.subhead p {
		margin: 0;
		max-width: 62ch;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.sm {
		padding: 5px 11px;
		font-size: 12px;
	}

	.empty {
		margin: 0;
		padding: 14px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-faint);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	li {
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
	}

	.twist {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		color: var(--text-faint);
		transition: transform 0.16s, color 0.16s;
	}

	.twist:hover {
		color: var(--text);
	}

	.twist.open {
		transform: rotate(90deg);
		color: var(--pink-soft);
	}

	.name {
		flex: 1;
		min-width: 0;
	}

	.cost {
		flex: none;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.cost.heavy {
		color: var(--danger);
		font-weight: 600;
	}

	.del {
		flex: none;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 7px;
		color: var(--text-faint);
		transition: color 0.14s, background 0.14s;
	}

	.del:hover {
		color: var(--danger);
		background: rgba(248, 113, 113, 0.12);
	}

	.body {
		padding: 0 10px 12px 40px;
	}

	.warnbox {
		margin: 10px 0 0;
		padding: 8px 11px;
		border-radius: var(--radius-sm);
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
		color: var(--danger);
		font-size: 11.5px;
		line-height: 1.45;
	}

	.hint {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--text-faint);
	}
</style>
