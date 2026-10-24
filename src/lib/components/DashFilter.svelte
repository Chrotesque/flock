<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { KIND_LABELS, KIND_ORDER, type VideoKind } from '$lib/videokind';
	import {
		ALL_PLATFORMS,
		DASH_SPANS,
		DEFAULT_FILTER,
		STAT_PLATFORMS,
		isCombined,
		isStatPlatform,
		type DashFilter,
		type FilterCounts,
		type StatPlatform
	} from '$lib/releases';

	/**
	 * Every choice of what the page looks at, in one element: a line saying
	 * what is shown, which opens into the choices — the timeframe, platforms
	 * (all of them together is the combined view), kinds and visibility. The
	 * page's numbers and its list all follow it — but for the platforms while
	 * the Dashboard's Ratio View shows every one side by side (`overridden`):
	 * they stay as chosen, greyed, and cannot be changed until it is off.
	 */
	let {
		filter = $bindable(),
		counts,
		overridden = false
	}: { filter: DashFilter; counts: FilterCounts; overridden?: boolean } = $props();

	const NOT_IN_EFFECT = 'Not in effect: Ratio View shows the platforms picked beside its switch';

	let open = $state(false);
	let root = $state<HTMLElement | null>(null);

	const combined = $derived(isCombined(filter));
	const allKinds = $derived(KIND_ORDER.every((k) => filter.kinds.includes(k)));
	const changed = $derived(JSON.stringify(filter) !== JSON.stringify(DEFAULT_FILTER));

	const kindWords = $derived(
		allKinds ? 'All kinds' : filter.kinds.length === 0 ? 'No kinds' : filter.kinds.map((k) => KIND_LABELS[k]).join(', ')
	);
	const visibilityWords = $derived(
		(filter.unlisted && filter.private
			? 'Any visibility'
			: filter.unlisted
				? 'Public + unlisted'
				: filter.private
					? 'Public + private'
					: filter.hidden
						? 'Public'
						: 'Public only') + (filter.hidden ? ' + hidden' : '')
	);

	function togglePlatform(p: StatPlatform) {
		const on = filter.platforms.includes(p);
		// The last one stays: a page of no platform shows nothing at all.
		if (on && filter.platforms.length === 1) return;
		filter = {
			...filter,
			platforms: on ? filter.platforms.filter((x) => x !== p) : STAT_PLATFORMS.filter((x) => x === p || filter.platforms.includes(x))
		};
	}

	function onlyPlatform(p: StatPlatform) {
		filter = { ...filter, platforms: [p] };
	}

	function combine() {
		filter = { ...filter, platforms: [...STAT_PLATFORMS] };
	}

	function toggleKind(k: VideoKind) {
		const on = filter.kinds.includes(k);
		filter = { ...filter, kinds: on ? filter.kinds.filter((x) => x !== k) : KIND_ORDER.filter((x) => x === k || filter.kinds.includes(x)) };
	}

	function reset() {
		filter = { ...DEFAULT_FILTER, platforms: [...DEFAULT_FILTER.platforms], kinds: [...DEFAULT_FILTER.kinds] };
	}

	function onWindowPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}

	function onKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			open = false;
			root?.querySelector<HTMLElement>('.bar')?.focus();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onKey} />

<div class="filter" class:open bind:this={root}>
	<svg class="funnel" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
		<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
	</svg>
	<button class="bar" aria-expanded={open} aria-controls="dashboard-filter" onclick={() => (open = !open)}>
		<span
			class="part platforms"
			class:unused={overridden}
			title={overridden ? NOT_IN_EFFECT : undefined}
		>
			{#each filter.platforms as p (p)}
				<PlatformIcon platform={p} size={14} dim={overridden} />
			{/each}
			<span class="plabel">{combined ? 'Combined' : PLATFORMS[filter.platforms[0]].label}</span>
		</span>
		<span class="sep keep" aria-hidden="true"></span>
		<span class="part days">Last {filter.days} days</span>
		<span class="sep" aria-hidden="true"></span>
		<span class="part">{kindWords}</span>
		<span class="sep" aria-hidden="true"></span>
		<span class="part">{visibilityWords}</span>
		<svg class="chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
			<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>

	{#if open}
		<div class="panel" id="dashboard-filter" role="group" aria-label="What the page shows">
			<section class="timeframe">
				<h3>Timeframe</h3>
				<div class="span" role="radiogroup" aria-label="Days the page counts">
					{#each DASH_SPANS as d (d)}
						<button
							class:on={filter.days === d}
							role="radio"
							aria-checked={filter.days === d}
							title="Videos out in the last {d} days"
							onclick={() => (filter = { ...filter, days: d })}>{d}</button
						>
					{/each}
					<span class="spanunit">days</span>
				</div>
			</section>

			<section class:unused={overridden}>
				<h3>
					Platforms
					<button class="link" class:on={combined && !overridden} onclick={combine} disabled={combined || overridden}>Combined</button>
				</h3>
				{#if overridden}
					<p class="note">{NOT_IN_EFFECT}. Switch it off to choose here.</p>
				{/if}
				<div class="chips">
					{#each ALL_PLATFORMS as p (p)}
						{@const label = PLATFORMS[p].label}
						{#if isStatPlatform(p)}
							<span class="chipwrap">
								<button
									class="chip"
									class:on={filter.platforms.includes(p)}
									aria-pressed={filter.platforms.includes(p)}
									onclick={() => togglePlatform(p)}
									disabled={overridden}
									title={overridden
										? 'Not in effect while Ratio View is on'
										: filter.platforms.includes(p) && filter.platforms.length === 1
											? 'At least one platform stays chosen'
											: undefined}
								>
									<PlatformIcon platform={p} size={14} dim={overridden} />
									<span class="name">{PLATFORMS[p].label}</span>
									<span class="count">{counts.platforms[p]}</span>
								</button>
								{#if !overridden && !(filter.platforms.length === 1 && filter.platforms[0] === p)}
									<button class="only" onclick={() => onlyPlatform(p)} title="Show {PLATFORMS[p].label} alone">only</button>
								{/if}
							</span>
						{:else}
							<span class="chip off" title="flock posts here but does not read its views yet">
								<PlatformIcon platform={p} size={14} />
								<span class="name">{label}</span>
								<span class="count">not read</span>
							</span>
						{/if}
					{/each}
				</div>
			</section>

			<section>
				<h3>Kinds</h3>
				<div class="chips">
					{#each KIND_ORDER as k (k)}
						{#if k !== 'other' || counts.kinds.other > 0}
							<button class="chip" class:on={filter.kinds.includes(k)} aria-pressed={filter.kinds.includes(k)} onclick={() => toggleKind(k)}>
								<span class="name">{KIND_LABELS[k]}</span>
								<span class="count">{counts.kinds[k]}</span>
							</button>
						{/if}
					{/each}
				</div>
			</section>

			<section>
				<h3>Also show</h3>
				<div class="chips">
					<button
						class="chip"
						class:on={filter.unlisted}
						aria-pressed={filter.unlisted}
						onclick={() => (filter = { ...filter, unlisted: !filter.unlisted })}
					>
						<span class="name">Unlisted</span>
						<span class="count">{counts.unlisted}</span>
					</button>
					<button
						class="chip"
						class:on={filter.private}
						aria-pressed={filter.private}
						onclick={() => (filter = { ...filter, private: !filter.private })}
						title="A scheduled YouTube upload is private until its slot"
					>
						<span class="name">Private</span>
						<span class="count">{counts.private}</span>
					</button>
					<button
						class="chip"
						class:on={filter.hidden}
						aria-pressed={filter.hidden}
						onclick={() => (filter = { ...filter, hidden: !filter.hidden })}
						title="Videos hidden with the eye in Edit mode — shown here without showing them again for good"
					>
						<span class="name">Hidden</span>
						<span class="count">{counts.hidden}</span>
					</button>
				</div>
			</section>

			<footer>
				<p>
					The timeframe counts videos by when they went out, scheduled ones still to come included; every number on the
					page, "usual" too, is over those. Shorts are under three minutes, long form over and not live. A reel with no
					YouTube video beside it counts as a Short. Visibility is YouTube's; reels are public. Hidden videos are those
					hidden in Edit mode; shown, they count like the rest, but never towards "usual".
				</p>
				{#if changed}
					<button class="link" onclick={reset}>Reset</button>
				{/if}
			</footer>
		</div>
	{/if}
</div>

<style>
	.filter {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}

	.bar {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		max-width: 100%;
		padding: 8px 12px 8px 12px;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		font-weight: 560;
		text-align: left;
		transition:
			border-color 0.14s,
			background 0.14s;
	}

	.bar:hover,
	.open .bar {
		border-color: var(--pink);
		background: var(--surface-2);
	}

	.bar:focus-visible {
		outline: 2px solid var(--pink);
		outline-offset: 2px;
	}

	/* Grey, a step brighter than the bar's border. */
	.funnel {
		flex: none;
		color: var(--text-faint);
	}

	.part {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.platforms {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: none;
	}

	/* Set aside by Ratio View: the choice struck through, the marks greyed
	   only where their brands allow it (PlatformIcon's `dim`). */
	.platforms.unused .plabel {
		color: var(--text-faint);
		text-decoration: line-through;
	}

	.sep {
		flex: none;
		width: 1px;
		height: 14px;
		background: var(--border-strong);
	}

	.chev {
		flex: none;
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
		width: min(720px, calc(100vw - 48px));
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 0.9fr);
		gap: 16px 22px;
		padding: 16px 18px 14px;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		box-shadow: var(--shadow);
	}

	/* The timeframe across the top of the panel, one click a choice. */
	.timeframe {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.timeframe h3 {
		margin: 0;
	}

	.span {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface);
	}

	.span button {
		min-width: 38px;
		padding: 4px 9px;
		border: none;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
		transition:
			background 0.14s,
			color 0.14s;
	}

	.span button:hover {
		color: var(--text);
	}

	.span button.on {
		background: rgba(255, 77, 158, 0.12);
		box-shadow: inset 0 0 0 1px var(--pink);
		color: var(--text);
	}

	.spanunit {
		padding: 0 9px 0 4px;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	h3 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin: 0 0 9px;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.chips {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.chipwrap {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.chipwrap .chip {
		flex: 1;
		min-width: 0;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		font-weight: 570;
		text-align: left;
		transition:
			border-color 0.14s,
			background 0.14s,
			color 0.14s;
	}

	button.chip:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}

	.chip.on {
		border-color: var(--pink);
		background: rgba(255, 77, 158, 0.12);
		color: var(--text);
	}

	.chip.off {
		cursor: default;
		opacity: 0.75;
	}

	/* The platforms while Ratio View is on: kept as chosen, greyed, not to be changed. */
	.note {
		margin: -3px 0 9px;
		font-size: 11px;
		line-height: 1.45;
		color: var(--warn);
	}

	.unused .chip,
	.unused button.chip:hover {
		border-style: dashed;
		border-color: var(--border);
		background: none;
		color: var(--text-faint);
		cursor: not-allowed;
	}

	.unused .chip.on {
		border-color: var(--border-strong);
		color: var(--text-dim);
	}

	.unused .chip.on .count {
		color: var(--text-faint);
	}

	.chip .name {
		flex: 1;
		min-width: 0;
	}

	.count {
		font-size: 11px;
		font-weight: 650;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.chip.on .count {
		color: var(--pink-soft);
	}

	.only {
		flex: none;
		padding: 4px 6px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-faint);
		opacity: 0;
		transition: opacity 0.12s;
	}

	.chipwrap:hover .only,
	.only:focus-visible {
		opacity: 1;
	}

	.only:hover {
		color: var(--pink-soft);
	}

	@media (hover: none) {
		.only {
			opacity: 1;
		}
	}

	.link {
		padding: 0;
		font: inherit;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0;
		text-transform: none;
		color: var(--pink-soft);
	}

	.link:disabled {
		color: var(--text-faint);
		cursor: default;
	}

	.link.on {
		color: var(--ok);
	}

	footer {
		grid-column: 1 / -1;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}

	footer p {
		margin: 0;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	footer .link {
		flex: none;
		font-size: 12px;
	}

	@media (max-width: 720px) {
		.panel {
			grid-template-columns: minmax(0, 1fr);
		}
		.bar .part:not(.platforms, .days),
		.bar .sep:not(.keep) {
			display: none;
		}
	}
</style>
