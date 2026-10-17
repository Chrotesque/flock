<script lang="ts">
	import { tick } from 'svelte';
	import type { YouTubePlaylist } from '$lib/types';

	/**
	 * YouTube's playlists for one upload, as tags: the chosen ones sit in the
	 * field, each with an × to take it off, and a click on the field opens the
	 * channel's list, where any number are ticked and unticked without it
	 * closing. Done, Esc or a click elsewhere closes it. Titles are matched
	 * case aside, as the worker matches them; a chosen one the channel does
	 * not have (a paste's typo, a playlist renamed since) stays listed, marked.
	 */
	let {
		chosen,
		items,
		disabled = false,
		onchange
	}: {
		chosen: string[];
		items: YouTubePlaylist[];
		disabled?: boolean;
		onchange: (titles: string[]) => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let root = $state<HTMLElement | null>(null);
	let field = $state<HTMLElement | null>(null);
	let search = $state<HTMLInputElement | null>(null);

	const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
	const isChosen = (title: string) => chosen.some((t) => same(t, title));
	const onChannel = (title: string) => items.some((p) => same(p.title, title));

	// A filter for a long list only; a short one is read at a glance.
	const searchable = $derived(items.length > 8);
	const missing = $derived(chosen.filter((t) => !onChannel(t)));
	const rows = $derived.by(() => {
		const words = query.trim().toLowerCase();
		const listed = [
			...missing.map((title) => ({ id: `missing:${title}`, title, count: null as number | null, missing: true })),
			...items.map((p) => ({ id: p.id, title: p.title, count: p.count as number | null, missing: false }))
		];
		return words ? listed.filter((r) => r.title.toLowerCase().includes(words)) : listed;
	});

	function toggle(title: string) {
		onchange(isChosen(title) ? chosen.filter((t) => !same(t, title)) : [...chosen, title]);
	}

	async function show() {
		if (disabled || open) return;
		open = true;
		query = '';
		await tick();
		search?.focus();
	}

	function close(refocus = true) {
		if (!open) return;
		open = false;
		if (refocus) field?.focus();
	}

	function onWindowPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) close(false);
	}

	function onKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			// The side box's own Esc handling (if any) must not see it too.
			event.stopPropagation();
			close();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointer} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker" class:open bind:this={root} onkeydown={onKey}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="field"
		class:disabled
		role="button"
		tabindex={disabled ? -1 : 0}
		aria-haspopup="true"
		aria-expanded={open}
		aria-label={chosen.length ? `Playlists: ${chosen.join(', ')}. Change them` : 'Choose playlists'}
		bind:this={field}
		onclick={() => (open ? close() : show())}
		onkeydown={(e) => {
			if (e.target === field && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
				e.preventDefault();
				void show();
			}
		}}
	>
		{#each chosen as title (title)}
			<span class="tag" class:missing={items.length > 0 && !onChannel(title)} title={onChannel(title) || items.length === 0 ? title : `${title} — not on the channel`}>
				<span class="tagtext">{title}</span>
				<button
					class="untag"
					aria-label="Take {title} off"
					title="Take it off"
					onclick={(e) => {
						e.stopPropagation();
						toggle(title);
					}}
				>
					<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
				</button>
			</span>
		{/each}
		<span class="placeholder">{chosen.length ? 'Add' : disabled ? 'No playlists listed' : 'Choose playlists…'}</span>
		<svg class="chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
			<path d="M4 6l4 4 4-4" />
		</svg>
	</div>

	{#if open}
		<div class="panel" role="group" aria-label="The channel's playlists">
			{#if searchable}
				<input
					class="search"
					type="text"
					placeholder="Find a playlist"
					aria-label="Find a playlist"
					autocomplete="off"
					bind:value={query}
					bind:this={search}
				/>
			{/if}
			<div class="rows">
				{#each rows as row (row.id)}
					<button
						class="row"
						class:on={isChosen(row.title)}
						role="checkbox"
						aria-checked={isChosen(row.title)}
						onclick={() => toggle(row.title)}
					>
						<span class="box" aria-hidden="true">
							<svg viewBox="0 0 14 14" width="11" height="11"><path d="M3 7.4l2.6 2.6L11 4.4" /></svg>
						</span>
						<span class="rowtitle">{row.title}</span>
						{#if row.missing}
							<span class="note">not on the channel</span>
						{:else}
							<span class="count">{row.count}</span>
						{/if}
					</button>
				{:else}
					<p class="empty">No playlist called that.</p>
				{/each}
			</div>
			<footer>
				<span>{chosen.length === 0 ? 'None chosen' : chosen.length === 1 ? '1 chosen' : `${chosen.length} chosen`}</span>
				{#if chosen.length > 0}
					<button class="link" onclick={() => onchange([])}>Clear</button>
				{/if}
				<button class="done" onclick={() => close()}>Done</button>
			</footer>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}

	.field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		min-height: 38px;
		padding: 5px 30px 5px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elev);
		color: var(--text);
		font-size: 13px;
		cursor: pointer;
		position: relative;
		transition: border-color 0.14s;
	}

	.field:hover,
	.open .field {
		border-color: var(--border-strong);
	}

	.open .field {
		border-color: var(--pink);
	}

	.field:focus-visible {
		outline: 2px solid var(--pink);
		outline-offset: 2px;
	}

	.field.disabled {
		cursor: default;
		opacity: 0.6;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: 100%;
		min-width: 0;
		padding: 3px 3px 3px 9px;
		border-radius: 999px;
		border: 1px solid rgba(255, 77, 158, 0.45);
		background: rgba(255, 77, 158, 0.12);
		font-size: 12px;
		font-weight: 560;
		line-height: 1.3;
	}

	.tag.missing {
		border-color: rgba(251, 191, 36, 0.55);
		background: rgba(251, 191, 36, 0.1);
		color: var(--warn);
	}

	.tagtext {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.untag {
		flex: none;
		display: grid;
		place-items: center;
		width: 17px;
		height: 17px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--text-faint);
	}

	.untag:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--text);
	}

	.untag path,
	.chev path,
	.box path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.placeholder {
		padding: 0 4px;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	.chev {
		position: absolute;
		right: 10px;
		top: 50%;
		margin-top: -6px;
		color: var(--text-faint);
		transition: transform 0.15s;
	}

	.open .chev {
		transform: rotate(180deg);
	}

	.panel {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		display: grid;
		gap: 6px;
		padding: 8px;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		box-shadow: var(--shadow);
	}

	.search {
		width: 100%;
		padding: 7px 9px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elev);
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
	}

	.search:focus {
		outline: none;
		border-color: var(--pink);
	}

	.rows {
		display: grid;
		gap: 2px;
		max-height: 280px;
		overflow-y: auto;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 7px 8px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		text-align: left;
	}

	.row:hover,
	.row:focus-visible {
		background: var(--surface-3);
		color: var(--text);
		outline: none;
	}

	.row.on {
		color: var(--text);
	}

	.box {
		flex: none;
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		border: 1.5px solid var(--border-strong);
		color: transparent;
	}

	.row.on .box {
		border-color: var(--pink);
		background: var(--pink);
		color: #fff;
	}

	.rowtitle {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		flex: none;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}

	.note {
		flex: none;
		font-size: 11px;
		color: var(--warn);
	}

	.empty {
		margin: 6px 8px;
		font-size: 12px;
		color: var(--text-faint);
	}

	footer {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 7px 4px 0;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-faint);
	}

	footer > span {
		flex: 1;
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--pink-soft);
	}

	.done {
		padding: 5px 14px;
		border-radius: 999px;
		border: none;
		background: var(--accent-grad, var(--pink));
		color: #fff;
		font: inherit;
		font-size: 12px;
		font-weight: 650;
	}
</style>
