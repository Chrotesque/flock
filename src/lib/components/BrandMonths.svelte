<script lang="ts">
	import Modal from './Modal.svelte';
	import MonthsGraph from './MonthsGraph.svelte';
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
		brandMonths,
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
		type PlatformMonths,
		type ReadRow
	} from '$lib/brandmonths';

	/**
	 * One brand's month over month, opened from its button's right-click on the
	 * Dashboard: views, likes and comments in each whole month of the last year
	 * against the month before (brandmonths.ts), every platform together and
	 * each one under it, as "vs usual" draws them, with the month still running
	 * on top at its pace so far; or, in the graph view, each metric as a line
	 * over every month flock has (MonthsGraph).
	 */
	let { brand: brandId, onclose }: { brand: string; onclose: () => void } = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	const brand = $derived(brands.byId(brandId));
	const now = Date.now();

	type View = 'list' | 'graph';
	const VIEWS: [View, string][] = [
		['list', 'List'],
		['graph', 'Graph']
	];
	const VIEW_KEY = 'flock.dashboard.months.view';
	let view = $state<View>(readView());

	function readView(): View {
		try {
			return localStorage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'list';
		} catch {
			return 'list';
		}
	}

	function setView(next: View) {
		view = next;
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {
			// Remembering the view is a convenience; private windows throw.
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
			const months = monthsFromReads(rows, now);
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
	const rows = $derived(brandMonths(sources.map((s) => s.source)));
	/** Every month flock has, oldest first, for the graphs. */
	const allRows = $derived(brandMonths(sources.map((s) => s.source), Infinity).reverse());
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
			? 'Each month of the last year against the one before, the month still running at its pace so far — a fifth up or down counts, as for vs usual.'
			: 'Every month flock has, the platforms added up, the month still running at its pace so far (dashed). Each axis runs from the lowest month to the highest.'}
		width="760px"
	>
		<div class="views" role="tablist" aria-label="Show as">
			{#each VIEWS as [id, name] (id)}
				<button role="tab" aria-selected={view === id} class:active={view === id} onclick={() => setView(id)}>{name}</button>
			{/each}
		</div>

		<ul class="sources" aria-label="Where the numbers come from">
			{#each sources as s (s.source.platform)}
				<li><i style:background={PLATFORM_COLOURS[s.source.platform]}></i><strong>{label(s.source.platform)}</strong> {s.note}</li>
			{/each}
		</ul>

		{#if sources.length === 0}
			<p class="none">This brand has no account chosen on any platform flock reads.</p>
		{:else if rows.length === 0}
			<p class="none">No month yet. A month shows once flock has it from its first day.</p>
		{:else if view === 'graph'}
			<div class="graphs">
				{#each MONTH_METRICS as metric (metric)}
					<MonthsGraph rows={allRows} {metric} label={LABELS[metric]} bind:hover />
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
	.views {
		display: inline-flex;
		gap: 4px;
		margin: 0 0 12px;
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

	.graphs {
		display: grid;
		gap: 18px;
	}

	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		margin: 0 0 14px;
		padding: 0;
		list-style: none;
		font-size: 12px;
		color: var(--text-faint);
	}

	.sources li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.sources strong {
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
