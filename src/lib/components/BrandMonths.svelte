<script lang="ts">
	import Modal from './Modal.svelte';
	import { portal } from '$lib/portal';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dashData } from '$lib/stores/dashdata.svelte';
	import { accountFor } from '$lib/accounts';
	import { stateOf } from '$lib/followers';
	import { onTikTokAccount } from '$lib/tiktokaccount';
	import { PLATFORMS } from '$lib/platforms';
	import { PLATFORM_COLOURS, STAT_PLATFORMS, type StatPlatform } from '$lib/releases';
	import { shortCount } from '$lib/format';
	import { TREND, changeWords } from '$lib/trend';
	import {
		MONTH_METRICS,
		brandMonths,
		monthsFromReads,
		prevMonth,
		readSince,
		type MonthMetric,
		type MonthRow,
		type PlatformMonths
	} from '$lib/brandmonths';

	/**
	 * One brand's month over month, opened from its button's right-click on the
	 * Dashboard: views, likes and comments in each whole month of the last year
	 * against the month before (brandmonths.ts), every platform together and
	 * each one under it, as "vs usual" draws them.
	 */
	let { brand: brandId, onclose }: { brand: string; onclose: () => void } = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	const brand = $derived(brands.byId(brandId));
	const now = Date.now();

	/** Each platform the brand posts on: its whole months, and where they come from or why there are none. */
	const sources = $derived(
		STAT_PLATFORMS.flatMap((platform): { source: PlatformMonths; note: string }[] => {
			const account = accountFor(brand, platform, accounts.list, brands.list.length);
			if (!account) return [];
			if (platform === 'youtube' || platform === 'instagram') {
				const months = stateOf(dashData.followers, platform, account.account_id)?.monthly ?? null;
				const from = platform === 'youtube' ? 'YouTube Analytics' : "Instagram's account insights";
				const note = months
					? from
					: `${from} — not read yet: the worker reads them ${platform === 'youtube' ? 'every 6 hours (with the Analytics grant)' : 'once a day'}`;
				return [{ source: { platform, months: months ?? {} }, note }];
			}
			const rows = dashData.reels.filter((r) =>
				r.platform === platform && (platform === 'tiktok' ? onTikTokAccount(r, account) : r.account === account.account_id)
			);
			const months = monthsFromReads(rows, now);
			const { first, firstWhole } = readSince(rows);
			const note =
				first === null
					? "flock's own reads — none yet"
					: Object.keys(months).length > 0
						? `flock's own reads since ${day(first)}`
						: `flock's own reads since ${day(first)} — the first whole month is ${monthName(firstWhole ?? '', 'long')}`;
			return [{ source: { platform, months }, note }];
		})
	);
	const rows = $derived(brandMonths(sources.map((s) => s.source)));

	const LABELS: Record<MonthMetric, string> = { views: 'Views', likes: 'Likes', comments: 'Comments' };
	const VERDICT_WORDS = { ahead: 'up', usual: 'about the same', behind: 'down' };
	const whole = new Intl.NumberFormat();

	function day(t: number): string {
		return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	}

	// Three letters each: the browser's own short names have "Sept".
	const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	function monthName(month: string, style: 'short' | 'long' = 'short'): string {
		if (!month) return '';
		const [y, m] = month.split('-').map(Number);
		if (style === 'short') return `${SHORT_MONTHS[m - 1]} ${y}`;
		return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
	}

	const label = (p: StatPlatform) => PLATFORMS[p].label;

	function cellTitle(row: MonthRow, metric: MonthMetric): string {
		const c = row.cells[metric];
		const word = LABELS[metric].toLowerCase();
		const before = monthName(prevMonth(row.month), 'long');
		const lines = [
			`${LABELS[metric]} in ${monthName(row.month, 'long')}: ${whole.format(c.value)}` +
				(c.parts.length > 1 ? ` — ${c.parts.map((p) => `${label(p.platform)} ${whole.format(p.value)}`).join(', ')}` : '')
		];
		if (c.previous === null || c.ratio === null || c.verdict === null) {
			lines.push(`No whole ${before} to compare with.`);
		} else {
			const over = c.parts.filter((p) => p.previous !== null).map((p) => label(p.platform));
			lines.push(
				`Against ${before}: ${whole.format(c.compared)} ${word} where there were ${whole.format(c.previous)} (${changeWords(c.ratio)}), ${VERDICT_WORDS[c.verdict]}` +
					(over.length < c.parts.length ? ` — ${over.join(', ')} only, the others have no whole ${before}` : '')
			);
		}
		if (c.parts.length > 1) {
			for (const p of c.parts) {
				lines.push(
					p.previous === null || p.ratio === null
						? `${label(p.platform)}: ${whole.format(p.value)}, no whole ${before}`
						: `${label(p.platform)}: ${whole.format(p.value)} against ${whole.format(p.previous)} (${changeWords(p.ratio)})`
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
		subtitle="Each whole month of the last year against the one before — a fifth up or down counts, as for vs usual."
		width="760px"
	>
		<ul class="sources" aria-label="Where the numbers come from">
			{#each sources as s (s.source.platform)}
				<li><i style:background={PLATFORM_COLOURS[s.source.platform]}></i><strong>{label(s.source.platform)}</strong> {s.note}</li>
			{/each}
		</ul>

		{#if sources.length === 0}
			<p class="none">This brand has no account chosen on any platform flock reads.</p>
		{:else if rows.length === 0}
			<p class="none">No whole month yet. A month shows once every day of it was read.</p>
		{:else}
			<div class="table" role="table" aria-label="Month over month">
				<div class="tr head" role="row">
					<span role="columnheader">Month</span>
					{#each MONTH_METRICS as metric (metric)}<span role="columnheader" class="num">{LABELS[metric]}</span>{/each}
				</div>
				{#each rows as row (row.month)}
					<div class="tr" role="row">
						<span class="month" role="cell">{monthName(row.month)}</span>
						{#each MONTH_METRICS as metric (metric)}
							{@const c = row.cells[metric]}
							<span class="cell num" role="cell" title={cellTitle(row, metric)}>
								<span class="top">
									<span class="value">{shortCount(c.value)}</span>
									<span class="judged {c.verdict ?? 'none'}">
										<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d={TREND[c.verdict ?? 'none']} /></svg>
										{#if c.ratio !== null}<span class="against">{changeWords(c.ratio)}</span>{/if}
									</span>
								</span>
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

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.month {
		font-size: 13px;
		color: var(--text);
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
