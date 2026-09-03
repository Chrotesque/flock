<script lang="ts">
	import { parseTagList, tagListLength } from '$lib/format';

	// Controlled: the parent owns the array and is told about every change.
	// Two-way binding would not survive the values object being replaced.
	let {
		value = [],
		placeholder = 'Add and press Enter',
		onchange,
		charLimit
	}: {
		value?: string[];
		placeholder?: string;
		onchange?: (next: string[]) => void;
		/** Platform character budget for the whole list, if it has one. */
		charLimit?: number;
	} = $props();

	let entry = $state('');

	/**
	 * Takes one tag or a whole comma-separated list, so the list a platform hands
	 * you can be pasted in as-is rather than typed one at a time.
	 */
	function commit() {
		const raw = entry;
		entry = '';
		const added = parseTagList(raw, value);
		if (added.length > 0) onchange?.([...value, ...added]);
	}

	/**
	 * Splitting on paste rather than waiting for Enter: a pasted list otherwise
	 * sits in the field as one long string, and the obvious next move — pressing
	 * Enter — would previously have committed all of it as a single tag.
	 */
	function onPaste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData('text') ?? '';
		if (!text.includes(',')) return; // a single tag can paste normally
		event.preventDefault();
		entry = entry + text;
		commit();
	}

	function remove(tag: string) {
		onchange?.(value.filter((t) => t !== tag));
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Backspace' && !entry && value.length) {
			onchange?.(value.slice(0, -1));
		}
	}

	// Only YouTube sets a budget, and its arithmetic is not the sum of the tags —
	// see tagListLength.
	let used = $derived(charLimit ? tagListLength(value) : 0);
	let over = $derived(Boolean(charLimit) && used > (charLimit ?? 0));
</script>

<div class="tags">
	{#each value as tag (tag)}
		<span class="tag">
			{tag}
			<button onclick={() => remove(tag)} aria-label="Remove {tag}">
				<svg viewBox="0 0 12 12" width="9" height="9"
					><path
						d="M3 3l6 6M9 3l-6 6"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
					/></svg
				>
			</button>
		</span>
	{/each}
	<input
		bind:value={entry}
		onkeydown={onKeydown}
		onpaste={onPaste}
		onblur={commit}
		{placeholder}
	/>
</div>

{#if charLimit}
	<p class="budget" class:over>
		<span>{used} / {charLimit} characters</span>
		{#if over}
			<span class="warn">over the limit — the upload will be rejected</span>
		{:else}
			<span class="note">
				{value.length}
				{value.length === 1 ? 'tag' : 'tags'} · a tag with a space is counted as though quoted
			</span>
		{/if}
	</p>
{/if}

<style>
	.tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 7px 8px;
		transition: border-color 0.15s;
	}

	.tags:focus-within {
		border-color: var(--pink);
		box-shadow: 0 0 0 3px rgba(255, 77, 158, 0.14);
	}

	.budget {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin: 6px 0 0;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.budget.over {
		color: var(--danger);
	}

	.budget .warn {
		font-weight: 600;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 6px 3px 9px;
		border-radius: 7px;
		font-size: 12px;
		background: var(--accent-grad-soft);
		border: 1px solid rgba(255, 77, 158, 0.28);
		color: var(--pink-soft);
	}

	.tag button {
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		border-radius: 4px;
		color: inherit;
		opacity: 0.7;
	}

	.tag button:hover {
		opacity: 1;
		background: rgba(255, 77, 158, 0.2);
	}

	input {
		flex: 1;
		min-width: 110px;
		border: none;
		background: none;
		outline: none;
		padding: 3px 2px;
		font-size: 13px;
	}

	input::placeholder {
		color: var(--text-faint);
	}
</style>
