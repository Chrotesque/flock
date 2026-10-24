<script lang="ts">
	import { PLATFORMS } from '$lib/platforms';
	import { PLATFORM_COLOURS, type StatPlatform } from '$lib/releases';
	import { shortCount } from '$lib/format';
	import { TREND, changeWords } from '$lib/trend';
	import {
		SHORT_MONTHS,
		changeStrength,
		monthIndex,
		monthName,
		prevMonth,
		runningWords,
		type MonthMetric,
		type MonthRow
	} from '$lib/brandmonths';

	/**
	 * One metric of a brand's months as a single line, oldest month on the left
	 * (BrandMonths' graph view): every month flock has, the brand's platforms
	 * added up, and the month still running at its pace so far, dashed on the
	 * end. Each stretch is green where the month rose on the one before and red
	 * where it fell, mixed into the neutral line by how much (changeStrength:
	 * a 2 % fall is barely red, halving is all red). The axis runs from the
	 * lowest month to the highest, not from nothing. `hover` is shared by the panel's three graphs, so a month is marked on
	 * all of them; its tooltip shows in the one under the pointer.
	 */
	let {
		rows,
		metric,
		label,
		hover = $bindable(null)
	}: {
		/** Oldest first. */
		rows: MonthRow[];
		metric: MonthMetric;
		label: string;
		hover?: { month: string; metric: MonthMetric } | null;
	} = $props();

	let width = $state(680);
	const H = 170;
	const M = { top: 14, right: 56, bottom: 36, left: 50 };
	const W = $derived(Math.max(300, width));
	const plotW = $derived(W - M.left - M.right);
	const plotH = H - M.top - M.bottom;

	const points = $derived(rows.map((row) => ({ row, value: row.cells[metric].pace, running: row.running.length > 0 })));
	const first = $derived(points.length > 0 ? monthIndex(points[0].row.month) : 0);
	const span = $derived(points.length > 1 ? monthIndex(points[points.length - 1].row.month) - first : 1);
	const lo = $derived(Math.min(...points.map((p) => p.value)));
	const hi = $derived(Math.max(...points.map((p) => p.value)));

	const sx = (month: string) => M.left + ((monthIndex(month) - first) / span) * plotW;
	// A line that never moved sits in the middle.
	const sy = (v: number) => (hi === lo ? M.top + plotH / 2 : M.top + plotH - ((v - lo) / (hi - lo)) * plotH);
	const at = (p: { row: MonthRow; value: number }) => `${sx(p.row.month).toFixed(1)},${sy(p.value).toFixed(1)}`;
	const next = (a: MonthRow, b: MonthRow) => monthIndex(b.month) - monthIndex(a.month) === 1;

	// Validated as a pair on the dark surface (deutan ΔE 13.8); the slope says the same.
	const UP = '#34d399';
	const DOWN = '#ef4444';

	/** A stretch's colour: the neutral line with green or red mixed in, the square root of the strength so small changes still show faintly. */
	function stretchColour(from: number, to: number): string {
		const s = changeStrength(from, to);
		if (s === 0) return 'var(--text-dim)';
		return `color-mix(in oklab, ${s > 0 ? UP : DOWN} ${Math.round(Math.sqrt(Math.abs(s)) * 100)}%, var(--text-dim))`;
	}

	/** One stroke from each month to the next; into a month still running it is a guess, so dashed. */
	const stretches = $derived(
		points.flatMap((p, i) => {
			const prev = points[i - 1];
			if (!prev || !next(prev.row, p.row)) return [];
			return [{ month: p.row.month, d: `M${at(prev)}L${at(p)}`, guess: p.running || prev.running, colour: stretchColour(prev.value, p.value) }];
		})
	);

	function niceStep(raw: number): number {
		const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
		const lead = raw / power;
		return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power;
	}

	/** The lowest and the highest month, and round numbers between that keep clear of them. */
	const yTicks = $derived.by(() => {
		if (points.length === 0) return [];
		if (hi === lo) return [lo];
		const out = [lo, hi];
		const step = niceStep((hi - lo) / 3);
		for (let v = Math.ceil(lo / step) * step; v < hi; v += step) {
			if (sy(lo) - sy(v) >= 18 && sy(v) - sy(hi) >= 18) out.push(v);
		}
		return out;
	});

	/** Every month while they fit, else every second or third; the year under the first and the first of each year after. */
	const xTicks = $derived.by(() => {
		const stride = Math.max(1, Math.ceil(34 / (plotW / span)));
		let year = 0;
		return points
			.filter((_, i) => i % stride === 0)
			.map((p) => {
				const [y, m] = p.row.month.split('-').map(Number);
				const tick = { month: p.row.month, name: SHORT_MONTHS[m - 1], year: y !== year ? String(y) : '' };
				year = y;
				return tick;
			});
	});

	const last = $derived(points.at(-1));
	/** Months closer than this leave no room for a dot each: only the hovered one and the last then. */
	const dense = $derived(plotW / span < 14);
	const hovered = $derived(hover ? points.find((p) => p.row.month === hover?.month) : undefined);
	const mine = $derived(hover?.metric === metric);

	function onMove(event: PointerEvent) {
		if (points.length === 0) return;
		const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
		const x = ((event.clientX - box.left) / box.width) * W;
		let best = points[0];
		for (const p of points) if (Math.abs(sx(p.row.month) - x) < Math.abs(sx(best.row.month) - x)) best = p;
		hover = { month: best.row.month, metric };
	}

	const whole = new Intl.NumberFormat();
	const VERDICT_WORDS = { ahead: 'up', usual: 'about the same', behind: 'down' };
	const platformLabel = (p: StatPlatform) => PLATFORMS[p].label;
</script>

<figure class="graph">
	<figcaption>{label}</figcaption>
	{#if points.length < 2}
		<p class="none">Not enough months to draw a line yet.</p>
	{:else}
		<div class="chart" bind:clientWidth={width}>
			<svg
				viewBox="0 0 {W} {H}"
				width={W}
				height={H}
				role="img"
				aria-label="{label} per month, {monthName(points[0].row.month, 'long')} to {monthName(points[points.length - 1].row.month, 'long')}, from {whole.format(lo)} to {whole.format(hi)}"
				onpointermove={onMove}
				onpointerleave={() => (hover = null)}
			>
				{#each yTicks as v (v)}
					<line class="grid" x1={M.left} x2={M.left + plotW} y1={sy(v)} y2={sy(v)} />
					<text class="tick" x={M.left - 8} y={sy(v)} text-anchor="end" dominant-baseline="middle">{shortCount(v)}</text>
				{/each}
				{#each xTicks as t (t.month)}
					<text class="tick" x={sx(t.month)} y={H - M.bottom + 16} text-anchor="middle">{t.name}</text>
					{#if t.year}<text class="tick year" x={sx(t.month)} y={H - M.bottom + 29} text-anchor="middle">{t.year}</text>{/if}
				{/each}

				{#if hovered}
					<line class="crosshair" x1={sx(hovered.row.month)} x2={sx(hovered.row.month)} y1={M.top} y2={M.top + plotH} />
				{/if}

				{#each stretches as st (st.month)}
					<path class="line" class:guess={st.guess} d={st.d} style:stroke={st.colour} />
				{/each}
				{#each points as p (p.row.month)}
					{#if !dense || hovered === p || p === last}
						<circle
							class="pt"
							class:running={p.running}
							class:hot={hovered === p}
							cx={sx(p.row.month)}
							cy={sy(p.value)}
							r={hovered === p ? 5 : 4}
						/>
					{/if}
				{/each}
				{#if last}
					<text class="end" x={sx(last.row.month) + 10} y={sy(last.value)} dominant-baseline="middle">
						{last.running ? '≈' : ''}{shortCount(last.value)}
					</text>
				{/if}
			</svg>

			{#if hovered && mine}
				{@const c = hovered.row.cells[metric]}
				{@const x = sx(hovered.row.month)}
				<div class="tip" class:left={x > W / 2} style:left="{x}px" style:top="{M.top}px">
					<strong>{monthName(hovered.row.month, 'long')}</strong>
					{#if hovered.running}
						<span><b>≈ {whole.format(c.pace)}</b> {label.toLowerCase()} at this pace</span>
						<span class="dim">{whole.format(c.value)} so far, {runningWords(hovered.row)}</span>
					{:else}
						<span><b>{whole.format(c.value)}</b> {label.toLowerCase()}</span>
					{/if}
					{#if c.ratio !== null && c.verdict !== null}
						<span class="judged {c.verdict}">
							<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d={TREND[c.verdict]} /></svg>
							{changeWords(c.ratio)} on {monthName(prevMonth(hovered.row.month))}, {VERDICT_WORDS[c.verdict]}
						</span>
					{/if}
					{#if c.parts.length > 1}
						{#each c.parts as p (p.platform)}
							<span class="part">
								<i style:background={PLATFORM_COLOURS[p.platform]}></i>{platformLabel(p.platform)}
								<span class="num">{p.days === null ? '' : '≈ '}{whole.format(p.pace)}</span>
							</span>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</figure>

<style>
	.graph {
		margin: 0;
	}

	figcaption {
		margin: 0 0 2px;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.chart {
		position: relative;
		width: 100%;
		min-width: 0;
	}

	svg {
		display: block;
		overflow: visible;
	}

	.grid {
		stroke: var(--border);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}

	.crosshair {
		stroke: var(--border-strong);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}

	.tick {
		fill: var(--text-faint);
		font-size: 10.5px;
		font-variant-numeric: tabular-nums;
	}

	.tick.year {
		font-size: 10px;
		opacity: 0.8;
	}

	/* The brand's platforms added up are no platform: a light neutral line, not one of their colours. */
	.line {
		fill: none;
		stroke: var(--text-dim);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.line.guess {
		stroke-dasharray: 4 4;
	}

	.pt {
		fill: var(--text-dim);
		stroke: var(--surface);
		stroke-width: 2;
	}

	.pt.running {
		fill: var(--surface);
		stroke: var(--text-dim);
	}

	.pt.hot {
		fill: var(--text);
	}

	.pt.running.hot {
		fill: var(--surface);
		stroke: var(--text);
	}

	.end {
		fill: var(--text-dim);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.tip {
		position: absolute;
		z-index: 2;
		display: grid;
		gap: 3px;
		min-width: 170px;
		max-width: 260px;
		padding: 8px 11px;
		margin-left: 12px;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow);
		font-size: 11.5px;
		color: var(--text-dim);
		pointer-events: none;
	}

	.tip.left {
		margin-left: -12px;
		transform: translateX(-100%);
	}

	.tip strong {
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
	}

	.tip b {
		font-weight: 600;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.dim {
		font-weight: 500;
		color: var(--text-faint);
	}

	.judged {
		display: inline-flex;
		align-items: center;
		gap: 5px;
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

	.part {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.part i {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	.part .num {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.none {
		margin: 6px 0 0;
		font-size: 13px;
		color: var(--text-faint);
	}
</style>
