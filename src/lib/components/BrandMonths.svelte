<script lang="ts">
	import Modal from './Modal.svelte';
	import MonthsGraph from './MonthsGraph.svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import { portal } from '$lib/portal';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dashData } from '$lib/stores/dashdata.svelte';
	import { accountFor } from '$lib/accounts';
	import { stateOf } from '$lib/followers';
	import { onTikTokAccount, tiktokReportOf } from '$lib/tiktokaccount';
	import { PLATFORMS } from '$lib/platforms';
	import { PLATFORM_COLOURS, STAT_PLATFORMS, type StatPlatform } from '$lib/releases';
	import { shortCount } from '$lib/format';
	import { TREND, changeWords } from '$lib/trend';
	import {
		MONTH_METRICS,
		MONTH_SPANS,
		brandMonths,
		inSpan,
		monthName,
		monthStart,
		monthsFromReads,
		partFromReads,
		prevMonth,
		readSince,
		runningWords,
		storedPart,
		type MonthMetric,
		type MonthRow,
		type MonthSpan,
		type PlatformMonths,
		type ReadRow
	} from '$lib/brandmonths';

	/**
	 * One brand's month over month, opened from its button's right-click on the
	 * Dashboard: views, likes and comments in each whole month of the last year
	 * against the month before (brandmonths.ts), every platform together and
	 * each one under it, as "vs usual" draws them, with the month still running
	 * on top at its pace so far; or, in the graph view (the default), each
	 * metric as a line (MonthsGraph). Both over the months of the timeframe.
	 */
	let { brand: brandId, onclose }: { brand: string; onclose: () => void } = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	const brand = $derived(brands.byId(brandId));
	const now = Date.now();

	type View = 'graph' | 'list';
	const VIEWS: [View, string][] = [
		['graph', 'Graph'],
		['list', 'List']
	];
	/** The view, per browser: { view }. The timeframe is not kept: the panel always opens on OPEN_SPAN. */
	const PREF_KEY = 'flock.dashboard.months';
	const OPEN_SPAN: MonthSpan = 180;
	let view = $state<View>(readView());
	let span = $state<MonthSpan>(OPEN_SPAN);

	function readView(): View {
		try {
			return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}')?.view === 'list' ? 'list' : 'graph';
		} catch {
			return 'graph';
		}
	}

	function choose(next: { view?: View; span?: MonthSpan }) {
		if (next.span !== undefined) span = next.span;
		if (next.view === undefined) return;
		view = next.view;
		try {
			localStorage.setItem(PREF_KEY, JSON.stringify({ view }));
		} catch {
			// Remembering it is a convenience; private windows throw.
		}
	}

	/** The account's last read by flock: what a running month worked out from its reads runs to. */
	function lastRead(platform: StatPlatform, account: { account_id: string; handle?: string }, rows: ReadRow[]): number {
		const polled =
			platform === 'facebook'
				? dashData.fbStatus?.pages?.[account.account_id]?.polledAt
				: tiktokReportOf(dashData.ttStatus?.accounts, account)?.polledAt;
		const t = Date.parse(String(polled ?? ''));
		if (Number.isFinite(t)) return Math.min(t, now);
		let latest = -Infinity;
		for (const row of rows) for (const s of row.history ?? []) latest = Math.max(latest, Date.parse(String(s[0]).replace(' ', 'T')));
		return Number.isFinite(latest) ? Math.min(latest, now) : now;
	}

	/** Each platform the brand posts on: its whole months and the month still running, and where they come from or why there are none. */
	const sources = $derived(
		STAT_PLATFORMS.flatMap((platform): { source: PlatformMonths; note: string }[] => {
			const account = accountFor(brand, platform, accounts.list, brands.list.length);
			if (!account) return [];
			if (platform === 'youtube' || platform === 'instagram') {
				const state = stateOf(dashData.followers, platform, account.account_id);
				const months = state?.monthly ?? null;
				const from = platform === 'youtube' ? 'YouTube Analytics' : "Instagram's account insights";
				const note = months
					? from
					: `${from} — not read yet: the worker reads them ${platform === 'youtube' ? 'every 6 hours (with the Analytics grant)' : 'once a day'}`;
				return [{ source: { platform, months: months ?? {}, part: storedPart(state?.monthPart) }, note }];
			}
			const rows = dashData.reels.filter((r) =>
				r.platform === platform && (platform === 'tiktok' ? onTikTokAccount(r, account) : r.account === account.account_id)
			);
			const months = monthsFromReads(rows, now, Infinity);
			const part = partFromReads(rows, lastRead(platform, account, rows));
			const { first, firstWhole } = readSince(rows);
			const note =
				first === null
					? "flock's own reads — none yet"
					: Object.keys(months).length > 0 || part
						? `flock's own reads since ${day(first)}`
						: `flock's own reads since ${day(first)} — the first whole month is ${monthName(firstWhole ?? '', 'long')}`;
			return [{ source: { platform, months, part }, note }];
		})
	);
	/** Every month flock has, newest first; the timeframe's for the list, oldest first for the graphs. */
	const allRows = $derived(brandMonths(sources.map((s) => s.source), Infinity));
	const rows = $derived(inSpan(allRows, span, now));
	const graphRows = $derived([...rows].reverse());
	let hover = $state<{ month: string; metric: MonthMetric } | null>(null);

	const LABELS: Record<MonthMetric, string> = { views: 'Views', likes: 'Likes', comments: 'Comments' };
	const VERDICT_WORDS = { ahead: 'up', usual: 'about the same', behind: 'down' };
	const whole = new Intl.NumberFormat();

	function day(t: number): string {
		return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	const label = (p: StatPlatform) => PLATFORMS[p].label;

	/** The last day a running month's count covers, from the days it covers. */
	function coveredTo(month: string, days: number): string {
		return day(monthStart(month) + days * 86_400_000 - 1);
	}

	function monthTitle(row: MonthRow): string {
		if (row.running.length === 0) return `${monthName(row.month, 'long')}: every day of it`;
		return [
			`${monthName(row.month, 'long')}, still running: ${runningWords(row)} so far`,
			...row.running.map((r) => `${label(r.platform)}: to ${coveredTo(row.month, r.days)}`),
			...row.platforms.filter((p) => !row.running.some((r) => r.platform === p)).map((p) => `${label(p)}: all of it`),
			'Its numbers are what the days so far come to over the whole month.'
		].join('\n');
	}

	function cellTitle(row: MonthRow, metric: MonthMetric): string {
		const c = row.cells[metric];
		const word = LABELS[metric].toLowerCase();
		const before = monthName(prevMonth(row.month), 'long');
		const running = row.running.length > 0;
		// A platform's count, with its pace when the month is still running for it.
		const count = (value: number, pace: number, days: number | null) =>
			days === null ? whole.format(value) : `${whole.format(value)} in ${Math.floor(days)} days, on pace for ${whole.format(pace)}`;
		const lines = [
			(running
				? `${LABELS[metric]} in ${monthName(row.month, 'long')} so far (${runningWords(row)}): ${whole.format(c.value)}, on pace for ${whole.format(c.pace)} over the whole month`
				: `${LABELS[metric]} in ${monthName(row.month, 'long')}: ${whole.format(c.value)}`) +
				(c.parts.length > 1 ? ` — ${c.parts.map((p) => `${label(p.platform)} ${whole.format(p.value)}`).join(', ')}` : '')
		];
		if (c.previous === null || c.ratio === null || c.verdict === null) {
			lines.push(`No whole ${before} to compare with.`);
		} else {
			const over = c.parts.filter((p) => p.previous !== null).map((p) => label(p.platform));
			lines.push(
				`Against ${before}: ${running ? 'on pace for ' : ''}${whole.format(c.compared)} ${word} where there were ${whole.format(c.previous)} (${changeWords(c.ratio)}), ${VERDICT_WORDS[c.verdict]}` +
					(over.length < c.parts.length ? ` — ${over.join(', ')} only, the others have no whole ${before}` : '')
			);
		}
		if (c.parts.length > 1) {
			for (const p of c.parts) {
				lines.push(
					p.previous === null || p.ratio === null
						? `${label(p.platform)}: ${count(p.value, p.pace, p.days)}, no whole ${before}`
						: `${label(p.platform)}: ${count(p.value, p.pace, p.days)} against ${whole.format(p.previous)} (${changeWords(p.ratio)})`
				);
			}
		}
		lines.push('A fifth up or down is up or down; anything between is about the same.');
		return lines.join('\n');
	}
</script>

<div use:portal>
	<Modal
		bind:open
		title="{brand?.name ?? 'Brand'} · month over month"
		subtitle={view === 'list'
			? 'Each month against the one before, the month still running at its pace so far — a fifth up or down counts, as for vs usual.'
			: 'The platforms added up, the month still running at its pace so far (dashed); green where a month rose on the one before, red where it fell, the stronger the bigger the change. Each axis runs from the lowest month to the highest.'}
		width="900px"
		maxHeight="min(94vh, 1000px)"
	>
		<div class="bar">
			<div class="views" role="tablist" aria-label="Show as">
				{#each VIEWS as [id, name] (id)}
					<button role="tab" aria-selected={view === id} class:active={view === id} onclick={() => choose({ view: id })}>{name}</button>
				{/each}
			</div>
			<div class="span" role="radiogroup" aria-label="Timeframe">
				{#each MONTH_SPANS as d (d)}
					<button class:on={span === d} role="radio" aria-checked={span === d} title="The months of the last {d} days" onclick={() => choose({ span: d })}
						>{d}</button
					>
				{/each}
				<span class="spanunit">days</span>
				<button class:on={span === null} role="radio" aria-checked={span === null} title="Every month flock has" onclick={() => choose({ span: null })}
					>Lifetime</button
				>
			</div>
			{#if sources.length > 0}
				<!-- Where each platform's numbers come from, on hover or focus. -->
				<div class="hold">
					<button class="sourcebtn" aria-label="Where the numbers come from" aria-describedby="month-sources">
						{#each sources as s (s.source.platform)}<PlatformIcon platform={s.source.platform} size={16} />{/each}
					</button>
					<div class="ppop" id="month-sources" role="tooltip">
						{#each sources as s (s.source.platform)}
							<p class="pline">
								<i style:background={PLATFORM_COLOURS[s.source.platform]}></i>
								<span><strong>{label(s.source.platform)}</strong> {s.note}</span>
							</p>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if sources.length === 0}
			<p class="none">This brand has no account chosen on any platform flock reads.</p>
		{:else if allRows.length === 0}
			<p class="none">No month yet. A month shows once flock has it from its first day.</p>
		{:else if view === 'graph'}
			<div class="graphs">
				{#each MONTH_METRICS as metric (metric)}
					<MonthsGraph rows={graphRows} {metric} label={LABELS[metric]} bind:hover />
				{/each}
			</div>
		{:else}
			<div class="table" role="table" aria-label="Month over month">
				<div class="tr head" role="row">
					<span role="columnheader">Month</span>
					{#each MONTH_METRICS as metric (metric)}<span role="columnheader" class="num">{LABELS[metric]}</span>{/each}
				</div>
				{#each rows as row (row.month)}
					{@const running = row.running.length > 0}
					<div class="tr" class:running role="row">
						<span class="month" role="cell" title={monthTitle(row)}>
							{monthName(row.month)}
							{#if running}<span class="sofar">{runningWords(row)}</span>{/if}
						</span>
						{#each MONTH_METRICS as metric (metric)}
							{@const c = row.cells[metric]}
							<span class="cell num" role="cell" title={cellTitle(row, metric)}>
								<span class="top">
									<span class="value">{running ? '≈ ' : ''}{shortCount(c.pace)}</span>
									<span class="judged {c.verdict ?? 'none'}">
										<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d={TREND[c.verdict ?? 'none']} /></svg>
										{#if c.ratio !== null}<span class="against">{changeWords(c.ratio)}</span>{/if}
									</span>
								</span>
								{#if running}<span class="sofar">{shortCount(c.value)} so far</span>{/if}
								{#if c.parts.length > 1}
									<span class="parts">
										{#each c.parts as p (p.platform)}
											<span class="judged {p.verdict ?? 'none'}">
												<i style:background={PLATFORM_COLOURS[p.platform]}></i>
												<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d={TREND[p.verdict ?? 'none']} /></svg>
											</span>
										{/each}
									</span>
								{/if}
							</span>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</Modal>
</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		margin: 0 0 12px;
	}

	.views {
		display: inline-flex;
		gap: 4px;
		padding: 3px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 10px;
	}

	.views button {
		padding: 5px 14px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text-dim);
		transition:
			background 0.15s,
			color 0.15s;
	}

	.views button:hover {
		color: var(--text);
	}

	.views button.active {
		background: var(--surface-3);
		color: var(--text);
	}

	/* The timeframe, as the Dashboard's filter draws it. */
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
		padding: 0 8px 0 4px;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.graphs {
		display: grid;
		gap: 18px;
	}

	/* The platforms' marks, right of the timeframe; where each one's numbers come from opens under it. */
	.hold {
		position: relative;
		margin-left: auto;
	}

	.sourcebtn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 11px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg-elev);
		cursor: default;
		transition: border-color 0.14s;
	}

	.hold:hover .sourcebtn,
	.sourcebtn:focus-visible {
		border-color: var(--border-strong);
	}

	.ppop {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 30;
		display: grid;
		gap: 6px;
		width: max-content;
		max-width: min(420px, calc(100vw - 40px));
		margin: 0;
		padding: 11px 13px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		font-size: 12px;
		color: var(--text-faint);
		opacity: 0;
		visibility: hidden;
		transform: translateY(-4px);
		transition:
			opacity 0.14s,
			transform 0.14s,
			visibility 0s 0.14s;
	}

	/* Bridges the gap to the button, so the pointer can move onto the popup. */
	.ppop::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -9px;
		height: 9px;
	}

	.hold:hover .ppop,
	.hold:focus-within .ppop {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition:
			opacity 0.14s,
			transform 0.14s;
	}

	.pline {
		display: flex;
		align-items: baseline;
		gap: 7px;
		margin: 0;
	}

	.pline i {
		position: relative;
		top: -1px;
	}

	.pline strong {
		font-weight: 600;
		color: var(--text-dim);
	}

	i {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	.none {
		margin: 0;
		font-size: 13px;
		color: var(--text-faint);
	}

	.tr {
		display: grid;
		grid-template-columns: 96px repeat(3, minmax(0, 1fr));
		align-items: center;
		gap: 12px;
		padding: 7px 4px;
		border-top: 1px solid var(--border);
	}

	.tr.head {
		border-top: 0;
		padding-top: 0;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	/* The month still running, on top: its numbers its pace, what is in so far under them. */
	.tr.running {
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}

	.tr.running + .tr {
		border-top-color: transparent;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.month {
		display: flex;
		flex-direction: column;
		font-size: 13px;
		color: var(--text);
	}

	.sofar {
		font-size: 11px;
		color: var(--text-faint);
	}

	/* A month's count and how it moved, every platform together; each platform's arrow under it. */
	.cell {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		font-size: 12.5px;
	}

	.top {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}

	.value {
		color: var(--text-dim);
	}

	.judged {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-dim);
	}

	.top .judged {
		min-width: 78px;
		justify-content: flex-end;
		font-weight: 600;
	}

	.judged svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.judged.ahead {
		color: var(--ok);
	}

	.judged.behind {
		color: var(--warn);
	}

	.judged.none {
		color: var(--text-faint);
		opacity: 0.7;
	}

	.parts {
		display: inline-flex;
		gap: 7px;
	}

	.parts i {
		width: 6px;
		height: 6px;
	}
</style>
