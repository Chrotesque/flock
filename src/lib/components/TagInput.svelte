<script lang="ts">
	// Controlled: the parent owns the array and is told about every change.
	// Two-way binding would not survive the values object being replaced.
	let {
		value = [],
		placeholder = 'Add and press Enter',
		onchange
	}: { value?: string[]; placeholder?: string; onchange?: (next: string[]) => void } = $props();

	let entry = $state('');

	function commit() {
		const next = entry.trim().replace(/,+$/, '');
		entry = '';
		if (!next || value.includes(next)) return;
		onchange?.([...value, next]);
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
	<input bind:value={entry} onkeydown={onKeydown} onblur={commit} {placeholder} />
</div>

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
