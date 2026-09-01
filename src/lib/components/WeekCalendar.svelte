<script lang="ts" generics="T extends { id: string; date: string; time: string }">
	import { untrack, type Snippet } from 'svelte';
	import { isoDate, startOfWeek, addDays, weekLabel, hourOf, dayLabel } from '$lib/format';

	// The week time-grid, shared by the upload wizard's schedule step and the
	// standalone Calendar so the two cannot drift apart visually.
	//
	// Placement and drag plumbing live here; what a card *looks* like is the
	// caller's `card` snippet (in practice always PostCard).
	let {
		items,
		weekStart = $bindable(startOfWeek(new Date())),
		card,
		toolbar,
		candrag,
		ondropitem
	}: {
		items: T[];
		weekStart?: Date;
		card: Snippet<[T]>;
		toolbar?: Snippet;
		/**
		 * Per item, so a grid can be partly editable — the Calendar allows
		 * upcoming releases to be moved while released ones stay put. Omitted
		 * means nothing is draggable.
		 */
		candrag?: (item: T) => boolean;
		/** Fires with the dragged item's id and the cell it was dropped on. */
		ondropitem?: (id: string, date: string, hour: number) => void;
	} = $props();

	const HOURS = Array.from({ length: 24 }, (_, i) => i);
	const ROW_PX = 56;

	const today = isoDate(new Date());

	let scroller = $state<HTMLDivElement | null>(null);

	let days = $derived(
		Array.from({ length: 7 }, (_, i) => {
			const date = addDays(weekStart, i);
			return { date, iso: isoDate(date), day: date.getDay() };
		})
	);

	let inThisWeek = $derived(new Set(days.map((d) => d.iso)));
	let isCurrentWeek = $derived(inThisWeek.has(today));

	function cardsAt(iso: string, hour: number): T[] {
		return items.filter((item) => item.date === iso && hourOf(item.time) === hour);
	}

	let dragging = $state<string | null>(null);
	let over = $state<string | null>(null);

	function key(iso: string, hour: number) {
		return `${iso}#${hour}`;
	}

	function onDrop(event: DragEvent, iso: string, hour: number) {
		event.preventDefault();
		const id = event.dataTransfer?.getData('text/plain') || dragging;
		dragging = null;
		over = null;
		if (id) ondropitem?.(id, iso, hour);
	}

	export function goTo(iso: string) {
		const [y, m, d] = iso.split('-').map(Number);
		weekStart = startOfWeek(new Date(y, m - 1, d));
	}

	// Opens on the earliest scheduled hour rather than midnight. Depends on the
	// element alone — reading `items` as a dependency re-ran this on every
	// change and snapped the scroll position back, making the grid unscrollable.
	$effect(() => {
		const el = scroller;
		if (!el) return;
		untrack(() => {
			const hours = items.map((item) => hourOf(item.time));
			const earliest = hours.length ? Math.min(...hours) : 8;
			el.scrollTop = Math.max(0, (earliest - 1) * ROW_PX);
		});
	});
</script>

<header class="bar">
	<div class="nav">
		<button
			class="nav-btn"
			onclick={() => (weekStart = addDays(weekStart, -7))}
			aria-label="Previous week"
		>
			<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
				><path
					d="M15 6l-6 6 6 6"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg
			>
		</button>
		<span class="label">{weekLabel(weekStart, addDays(weekStart, 6))}</span>
		<button
			class="nav-btn"
			onclick={() => (weekStart = addDays(weekStart, 7))}
			aria-label="Next week"
		>
			<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
				><path
					d="M9 6l6 6-6 6"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
				/></svg
			>
		</button>
	</div>

	<button
		class="btn sm"
		onclick={() => (weekStart = startOfWeek(new Date()))}
		disabled={isCurrentWeek}
	>
		This week
	</button>

	<span class="spacer"></span>

	{@render toolbar?.()}
</header>

<div class="calendar card">
	<div class="head">
		<div class="corner"></div>
		{#each days as day (day.iso)}
			<div class="dayhead" class:today={day.iso === today}>
				<span class="dow">{dayLabel(day.day)}</span>
				<span class="dom">{String(day.date.getDate()).padStart(2, '0')}</span>
			</div>
		{/each}
	</div>

	<div class="scroller scroll" bind:this={scroller}>
		<div class="grid" style="--row: {ROW_PX}px">
			{#each HOURS as hour (hour)}
				<div class="timelabel"><span>{String(hour).padStart(2, '0')}:00</span></div>

				{#each days as day (day.iso)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="cell"
						class:today={day.iso === today}
						class:over={over === key(day.iso, hour)}
						ondragover={(e) => {
							if (!ondropitem) return;
							e.preventDefault();
							over = key(day.iso, hour);
						}}
						ondragleave={() => {
							if (over === key(day.iso, hour)) over = null;
						}}
						ondrop={(e) => onDrop(e, day.iso, hour)}
					>
						{#each cardsAt(day.iso, hour) as item (item.id)}
							{#if candrag?.(item)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="slot grab"
									draggable="true"
									ondragstart={(e) => {
										dragging = item.id;
										e.dataTransfer?.setData('text/plain', item.id);
										if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
									}}
									ondragend={() => {
										dragging = null;
										over = null;
									}}
								>
									{@render card(item)}
								</div>
							{:else}
								<div class="slot">{@render card(item)}</div>
							{/if}
						{/each}
					</div>
				{/each}
			{/each}
		</div>
	</div>
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 14px;
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
	}

	.nav-btn {
		width: 26px;
		height: 26px;
		border-radius: 7px;
		display: grid;
		place-items: center;
		color: var(--text-dim);
	}

	.nav-btn:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	.label {
		min-width: 108px;
		text-align: center;
		font-size: 12.5px;
		font-weight: 600;
	}

	.sm {
		padding: 6px 12px;
		font-size: 12px;
	}

	.spacer {
		flex: 1;
	}

	.calendar {
		overflow: hidden;
	}

	.head,
	.grid {
		display: grid;
		grid-template-columns: 62px repeat(7, minmax(0, 1fr));
	}

	.head {
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}

	.corner {
		border-right: 1px solid var(--border);
	}

	.dayhead {
		padding: 9px 10px;
		border-right: 1px solid var(--border);
	}

	.dayhead:last-child {
		border-right: none;
	}

	.dayhead.today {
		background: var(--accent-grad-soft);
	}

	.dow {
		display: block;
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.dayhead.today .dow {
		color: var(--pink-soft);
	}

	.dom {
		display: block;
		font-size: 17px;
		font-weight: 620;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}

	.dayhead.today .dom {
		color: var(--pink);
	}

	.scroller {
		max-height: 52vh;
		min-height: 300px;
		overflow-y: auto;
	}

	.grid {
		grid-auto-rows: minmax(var(--row), auto);
	}

	.timelabel {
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		padding: 5px 8px 0 0;
		text-align: right;
	}

	.timelabel span {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.cell {
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		padding: 4px;
		display: grid;
		gap: 4px;
		align-content: start;
		transition: background 0.12s;
	}

	.cell.today {
		background: rgba(255, 77, 158, 0.035);
	}

	.cell.over {
		background: var(--accent-grad-soft);
		box-shadow: inset 0 0 0 1px var(--pink);
	}

	.grab {
		cursor: grab;
	}

	.grab:active {
		cursor: grabbing;
	}

	.slot:hover {
		transform: translateY(-1px);
	}

	@media (max-width: 900px) {
		.head,
		.grid {
			grid-template-columns: 48px repeat(7, minmax(78px, 1fr));
		}

		.calendar {
			overflow-x: auto;
		}
	}
</style>
