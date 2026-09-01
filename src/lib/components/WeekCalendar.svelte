<script lang="ts" generics="T extends { id: string; date: string; time: string }">
	import { untrack, type Snippet } from 'svelte';
	import { isoDate, startOfWeek, addDays, weekLabel, hourOf, dayLabel } from '$lib/format';

	// The week time-grid, shared by the upload wizard's schedule step and the
	// standalone Calendar so the two cannot drift apart visually.
	//
	// Placement, drag plumbing and off-screen tracking live here; what a card
	// *looks* like is the caller's `card` snippet (in practice always PostCard).
	let {
		items,
		weekStart = $bindable(startOfWeek(new Date())),
		card,
		toolbar,
		marker,
		offscreen,
		dense = false,
		candrag,
		ondropitem
	}: {
		items: T[];
		weekStart?: Date;
		card: Snippet<[T]>;
		toolbar?: Snippet;
		/** Rendered in a day's column header, once per item scheduled that day. */
		marker?: Snippet<[T]>;
		/**
		 * Rendered for an item whose card is scrolled out of view, with the
		 * direction it lies in and a callback that scrolls it into the middle.
		 */
		offscreen?: Snippet<[T, 'up' | 'down', () => void]>;
		/**
		 * Cards flow across a cell rather than stacking. For icon-sized cards —
		 * stacking four of them would treble the row height for no gain.
		 */
		dense?: boolean;
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

	function cardsOn(iso: string): T[] {
		return items.filter((item) => item.date === iso);
	}

	/* ---- drag and drop ---- */

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

	/* ---- off-screen tracking ----
	 *
	 * Row heights grow when several cards share a slot, so a card's position
	 * cannot be derived from its hour. The card elements register themselves and
	 * are measured against the scroll viewport instead.
	 */

	const nodes = new Map<string, HTMLElement>();

	function register(node: HTMLElement, id: string) {
		nodes.set(id, node);
		measure();
		return {
			destroy() {
				nodes.delete(id);
			}
		};
	}

	/**
	 * Width the scrollbar steals from the grid. The header is not inside the
	 * scroll container, so without reserving the same space its columns come out
	 * wider than the columns beneath them. Zero on overlay-scrollbar platforms.
	 */
	let gutter = $state(0);

	function measureGutter() {
		const el = scroller;
		if (el) gutter = el.offsetWidth - el.clientWidth;
	}

	let above = $state<T[]>([]);
	let below = $state<T[]>([]);
	let ticking = false;

	/**
	 * Off-screen items bucketed by which day column they belong to, so an arrow
	 * sits over its own day rather than in the middle of the grid. Several items
	 * can share a column, so each bucket renders as one slot.
	 */
	function byDay(list: T[]): { index: number; items: T[] }[] {
		const buckets = new Map<number, T[]>();
		for (const item of list) {
			const index = days.findIndex((day) => day.iso === item.date);
			if (index < 0) continue;
			const bucket = buckets.get(index);
			if (bucket) bucket.push(item);
			else buckets.set(index, [item]);
		}
		return [...buckets.entries()]
			.map(([index, items]) => ({ index, items }))
			.sort((a, b) => a.index - b.index);
	}

	let aboveByDay = $derived(byDay(above));
	let belowByDay = $derived(byDay(below));

	function measure() {
		const el = scroller;
		if (!el) return;
		const box = el.getBoundingClientRect();
		const up: T[] = [];
		const down: T[] = [];

		for (const item of items) {
			const node = nodes.get(item.id);
			if (!node) continue;
			const rect = node.getBoundingClientRect();
			// Fully past the edge, not merely clipped — a card half in view does
			// not need an arrow pointing at it.
			if (rect.bottom <= box.top + 2) up.push(item);
			else if (rect.top >= box.bottom - 2) down.push(item);
		}

		above = up;
		below = down;
	}

	function onScroll() {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			ticking = false;
			measure();
			measureGutter();
		});
	}

	/** Scrolls an item's card to the vertical middle of the grid. */
	function centerOn(item: T) {
		const el = scroller;
		const node = nodes.get(item.id);
		if (!el || !node) return;

		const box = el.getBoundingClientRect();
		const rect = node.getBoundingClientRect();
		const max = el.scrollHeight - el.clientHeight;
		const target = Math.max(
			0,
			Math.min(max, el.scrollTop + (rect.top - box.top) - (el.clientHeight - rect.height) / 2)
		);

		const reduced =
			typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced) {
			el.scrollTop = target;
			measure();
			return;
		}

		// Animated by hand rather than with scrollTo({ behavior: 'smooth' }):
		// that is a silent no-op in some engines and automation contexts, and a
		// jump button that sometimes does nothing is worse than one that never
		// animates.
		const from = el.scrollTop;
		const distance = target - from;
		if (Math.abs(distance) < 1) return;

		const started = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - started) / 320);
			el.scrollTop = from + distance * (1 - Math.pow(1 - t, 3));
			if (t < 1) requestAnimationFrame(step);
			else measure();
		};
		requestAnimationFrame(step);
	}

	// Re-measure whenever the set of cards changes; the effect runs after the DOM
	// is updated, so the freshly rendered nodes are already registered.
	$effect(() => {
		void items;
		void weekStart;
		measure();
		measureGutter();
	});

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
			measure();
		});
	});
</script>

<svelte:window on:resize={onScroll} />

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
	<div class="head" style="padding-right: {gutter}px">
		<div class="corner"></div>
		{#each days as day (day.iso)}
			<div class="dayhead" class:today={day.iso === today}>
				<div class="daymeta">
					<span class="dow">{dayLabel(day.day)}</span>
					<span class="dom">{String(day.date.getDate()).padStart(2, '0')}</span>
				</div>
				{#if marker}
					<div class="markers">
						{#each cardsOn(day.iso) as item (item.id)}
							{@render marker(item)}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="scrollwrap">
		<div class="scroller scroll" bind:this={scroller} onscroll={onScroll}>
			<div class="grid" style="--row: {ROW_PX}px">
				{#each HOURS as hour (hour)}
					<div class="timelabel"><span>{String(hour).padStart(2, '0')}:00</span></div>

					{#each days as day (day.iso)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="cell"
							class:dense
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
										use:register={item.id}
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
									<div class="slot" use:register={item.id}>{@render card(item)}</div>
								{/if}
							{/each}
						</div>
					{/each}
				{/each}
			</div>
		</div>

		{#if offscreen && aboveByDay.length > 0}
			<div class="rail up">
				{#each aboveByDay as group (group.index)}
					<div class="railslot" style="grid-column: {group.index + 1}">
						{#each group.items as item (item.id)}
							{@render offscreen(item, 'up', () => centerOn(item))}
						{/each}
					</div>
				{/each}
			</div>
		{/if}

		{#if offscreen && belowByDay.length > 0}
			<div class="rail down">
				{#each belowByDay as group (group.index)}
					<div class="railslot" style="grid-column: {group.index + 1}">
						{#each group.items as item (item.id)}
							{@render offscreen(item, 'down', () => centerOn(item))}
						{/each}
					</div>
				{/each}
			</div>
		{/if}
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
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
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

	/* Which platforms land on this day, readable without scrolling the grid. */
	.markers {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 3px;
		min-width: 0;
	}

	.scrollwrap {
		position: relative;
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
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 5px;
	}

	.timelabel span {
		font-family: var(--mono);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
		color: var(--text-dim);
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

	.cell.dense {
		display: flex;
		flex-wrap: wrap;
		align-content: start;
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

	/* Floating over the grid's own edges, so an off-screen card is reachable
	   without hunting for it. */
	/* Mirrors the grid's seven day columns exactly, so an arrow lands over the
	   day its card is on. */
	.rail {
		position: absolute;
		left: 62px;
		right: 0;
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		align-items: start;
		padding: 7px 0;
		pointer-events: none;
		z-index: 3;
	}

	.railslot {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px;
		padding: 0 3px;
		min-width: 0;
	}

	.rail.up {
		top: 0;
		background: linear-gradient(var(--surface) 15%, transparent);
	}

	.rail.down {
		bottom: 0;
		background: linear-gradient(transparent, var(--surface) 85%);
	}

	@media (max-width: 900px) {
		.head,
		.grid {
			grid-template-columns: 48px repeat(7, minmax(78px, 1fr));
		}

		.calendar {
			overflow-x: auto;
		}

		.dayhead {
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
		}

		.markers {
			justify-content: flex-start;
		}

		.rail {
			left: 48px;
		}
	}
</style>
