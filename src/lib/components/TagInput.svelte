<script lang="ts">
	import { parseTagList, tagListLength } from '$lib/format';

	// Controlled: the parent owns the array and is told about every change.
	// Two-way binding would not survive the values object being replaced.
	let {
		value = [],
		placeholder = 'Add and press Enter',
		onchange,
		charLimit,
		label,
		hint,
		onfocus,
		clearable = false
	}: {
		value?: string[];
		placeholder?: string;
		onchange?: (next: string[]) => void;
		/** Own character budget, for a field that is not part of a shared one. */
		charLimit?: number;
		/** Rendered above the box, beside the count and the clear button. */
		label?: string;
		/** Rendered under the box, where it has room to be read. */
		hint?: string;
		/** Lets the parent remember which box to drop an inserted set into. */
		onfocus?: () => void;
		clearable?: boolean;
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

{#if label}
	<div class="head">
		<span class="boxlabel">{label}</span>
		<span class="count">{value.length}</span>
		{#if clearable}
			<button
				class="clear"
				disabled={value.length === 0}
				onclick={() => onchange?.([])}
				title="Remove every tag in {label}"
			>
				<svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
					<path
						d="M5 7h14M10 7V5.5h4V7m-7 0 .8 12h8.4L17 7"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				Clear
			</button>
		{/if}
	</div>
{/if}

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
		onfocusin={onfocus}
		{placeholder}
	/>
</div>

{#if hint}
	<!-- Under the box on its own line: as placeholder text it was cut off by the
	     input's width, which is exactly where a hint is no use. -->
	<p class="hint">{hint}</p>
{/if}

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

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 5px;
	}

	.boxlabel {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.count {
		min-width: 17px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--surface-3);
		color: var(--text-dim);
		font-size: 10px;
		font-weight: 700;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.clear {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-faint);
		font-size: 10.5px;
		font-weight: 600;
		transition: color 0.14s, border-color 0.14s;
	}

	.clear:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
	}

	.clear:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.hint {
		margin: 5px 0 0;
		font-size: 10.5px;
		line-height: 1.4;
		color: var(--text-faint);
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
