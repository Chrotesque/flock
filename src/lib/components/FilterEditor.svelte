<script lang="ts">
	import Checkbox from './Checkbox.svelte';
	import { applyFilters, newRule } from '$lib/filters';
	import type { FilterRule } from '$lib/types';

	// The "replace X with Y" adaptation rules for one platform. Rules run top to
	// bottom and chain, so order is meaningful and reorder controls are part of
	// the editor rather than a nicety.
	let {
		rules,
		label,
		onchange
	}: { rules: FilterRule[]; label: string; onchange: (next: FilterRule[]) => void } = $props();

	let sample = $state('');

	let preview = $derived(applyFilters(sample, rules, 'description'));

	function update(id: string, patch: Partial<FilterRule>) {
		onchange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	}

	function remove(id: string) {
		onchange(rules.filter((r) => r.id !== id));
	}

	function add() {
		onchange([...rules, newRule()]);
	}

	function move(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= rules.length) return;
		const next = [...rules];
		[next[index], next[target]] = [next[target], next[index]];
		onchange(next);
	}
</script>

<div class="editor">
	<header>
		<div>
			<h4>Adaptations</h4>
			<p>
				Applied to the shared title and description before anything is published to {label}. Rules
				run in order and chain.
			</p>
		</div>
		<button class="btn sm" onclick={add}>Add rule</button>
	</header>

	{#if rules.length === 0}
		<p class="empty">
			No rules yet. Add one to rewrite anything {label} does not accept — a link that must become
			"link in bio", a hashtag style, a phrase that trips moderation.
		</p>
	{:else}
		<ul>
			{#each rules as rule, index (rule.id)}
				<li class:off={!rule.enabled}>
					<div class="top">
						<Checkbox
							checked={rule.enabled}
							onchange={(next) => update(rule.id, { enabled: next })}
						/>

						<input
							class="input find"
							placeholder="Find"
							value={rule.find}
							oninput={(e) => update(rule.id, { find: e.currentTarget.value })}
						/>

						<svg viewBox="0 0 16 10" width="15" height="10" aria-hidden="true">
							<path
								d="M1 5h13M10 1l4 4-4 4"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>

						<input
							class="input replace"
							placeholder="Replace with (empty removes it)"
							value={rule.replace}
							oninput={(e) => update(rule.id, { replace: e.currentTarget.value })}
						/>

						<div class="order">
							<button
								onclick={() => move(index, -1)}
								disabled={index === 0}
								aria-label="Move rule up"
							>
								<svg viewBox="0 0 12 12" width="10" height="10"
									><path
										d="M2.5 7.5 6 4l3.5 3.5"
										fill="none"
										stroke="currentColor"
										stroke-width="1.7"
										stroke-linecap="round"
										stroke-linejoin="round"
									/></svg
								>
							</button>
							<button
								onclick={() => move(index, 1)}
								disabled={index === rules.length - 1}
								aria-label="Move rule down"
							>
								<svg viewBox="0 0 12 12" width="10" height="10"
									><path
										d="M2.5 4.5 6 8l3.5-3.5"
										fill="none"
										stroke="currentColor"
										stroke-width="1.7"
										stroke-linecap="round"
										stroke-linejoin="round"
									/></svg
								>
							</button>
						</div>

						<button class="del" onclick={() => remove(rule.id)} aria-label="Delete rule">
							<svg viewBox="0 0 16 16" width="13" height="13"
								><path
									d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
									fill="none"
									stroke="currentColor"
									stroke-width="1.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</button>
					</div>

					<div class="bottom">
						<label>
							<span>Applies to</span>
							<select
								class="select"
								value={rule.target}
								onchange={(e) =>
									update(rule.id, { target: e.currentTarget.value as FilterRule['target'] })}
							>
								<option value="both">Title and description</option>
								<option value="title">Title only</option>
								<option value="description">Description only</option>
							</select>
						</label>

						<label>
							<span>Match</span>
							<select
								class="select"
								value={rule.mode}
								onchange={(e) =>
									update(rule.id, { mode: e.currentTarget.value as FilterRule['mode'] })}
							>
								<option value="literal">Plain text</option>
								<option value="regex">Regular expression</option>
							</select>
						</label>

						<Checkbox
							checked={rule.caseSensitive}
							label="Case sensitive"
							onchange={(next) => update(rule.id, { caseSensitive: next })}
						/>
					</div>
				</li>
			{/each}
		</ul>

		<div class="tester">
			<span class="label">Try it</span>
			<textarea
				class="textarea try"
				bind:value={sample}
				placeholder="Paste a sample description here to see what {label} would receive."
			></textarea>
			{#if sample}
				<div class="result">
					<p class="out">{preview.output}</p>
					<p class="count">
						{#if preview.hits.length === 0}
							No rule matched.
						{:else}
							{preview.hits.reduce((sum, h) => sum + h.count, 0)} replacement(s) from
							{preview.hits.length} rule(s).
						{/if}
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.editor header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}

	h4 {
		font-size: 13.5px;
	}

	header p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
		max-width: 54ch;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.empty {
		margin: 0;
		padding: 16px;
		border-radius: var(--radius);
		border: 1px dashed var(--border-strong);
		font-size: 12.5px;
		color: var(--text-faint);
		line-height: 1.55;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	li {
		padding: 11px 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: opacity 0.15s;
	}

	li.off {
		opacity: 0.5;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.top svg {
		flex: none;
		color: var(--text-faint);
	}

	.find,
	.replace {
		flex: 1;
		min-width: 0;
		padding: 7px 10px;
		font-size: 12.5px;
		font-family: var(--mono);
	}

	.order {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: none;
	}

	.order button {
		width: 20px;
		height: 15px;
		display: grid;
		place-items: center;
		border-radius: 4px;
		color: var(--text-faint);
	}

	.order button:hover:not(:disabled) {
		background: var(--surface-3);
		color: var(--text);
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
	}

	.del:hover {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.bottom {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.bottom label {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.bottom .select {
		width: auto;
		padding: 5px 28px 5px 9px;
		font-size: 12px;
		background-position: right 9px center;
	}

	.tester {
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.try {
		min-height: 74px;
		font-size: 12.5px;
	}

	.result {
		margin-top: 10px;
	}

	.out {
		margin: 0;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--surface-2);
		border: 1px solid var(--border);
		font-size: 12.5px;
		white-space: pre-wrap;
		line-height: 1.55;
	}

	.count {
		margin: 7px 0 0;
		font-size: 11px;
		color: var(--text-faint);
	}

	@media (max-width: 760px) {
		.top {
			flex-wrap: wrap;
		}
		.find,
		.replace {
			flex-basis: 100%;
		}
	}
</style>
