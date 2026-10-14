<script lang="ts">
	import { PLATFORM_COLOURS as COLOURS, type Curve } from '$lib/releases';

	/**
	 * A video's views from release, one line per platform, with the usual
	 * line of the platform's other videos of its kind dashed beside it. Small
	 * in a list row; with `big`, axes and a legend for an opened row.
	 */
	let { curves, big = false }: { curves: Curve[]; big?: boolean } = $props();

	const H = 3600_000;

	let width = $state(600);
	const W = $derived(big ? Math.max(240, width) : 132);
	const HGT = $derived(big ? 180 : 34);
	const M = $derived(big ? { top: 10, right: 14, bottom: 24, left: 46 } : { top: 3, right: 2, bottom: 3, left: 2 });
	const plotW = $derived(W - M.left - M.right);
	const plotH = $derived(HGT - M.top - M.bottom);

	// A usual line beside nothing compares nothing: only videos flock read while new.
	const drawn = $derived(curves.filter((c) => c.line.length > 1));
	const span = $derived(Math.max(1, ...drawn.map((c) => c.span)));
	const top = $derived.by(() => {
		const most = Math.max(1, ...drawn.flatMap((c) => [...c.line, ...c.usual].map((p) => p[1])));
		if (!big) return most;
		const step = niceStep(most / 4);
		return Math.ceil(most / step) * step;
	});

	function niceStep(raw: number): number {
		const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
		const lead = raw / power;
		return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power;
	}

	const sx = (t: number) => M.left + (t / span) * plotW;
	const sy = (v: number) => M.top + plotH - (v / top) * plotH;

	function path(points: [number, number][]): string {
		return points.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`).join('');
	}

	const yTicks = $derived.by(() => {
		if (!big) return [];
		const step = niceStep(top / 4);
		return Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
	});

	/** Hours while the stretch is short, days once it is long. */
	const xTicks = $derived.by(() => {
		if (!big) return [];
		const hours = span / H;
		const stepH = hours <= 6 ? 1 : hours <= 24 ? 4 : hours <= 72 ? 12 : 24;
		const out: number[] = [];
		for (let h = 0; h * H <= span + 1; h += stepH) out.push(h * H);
		return out;
	});

	function xLabel(ms: number): string {
		const hours = Math.round(ms / H);
		if (span / H <= 72) return `${hours} h`;
		return `${Math.round(hours / 24)} d`;
	}

	function yLabel(v: number): string {
		return v >= 10_000 ? `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : v.toLocaleString();
	}
</script>

{#if drawn.length === 0}
	<span class="none" class:big>{big ? 'flock was not reading this video while it was new.' : '—'}</span>
{:else if big}
	<div class="wrap" bind:clientWidth={width}>
		<svg class="bigsvg" viewBox="0 0 {W} {HGT}" role="img" aria-label="Views from release">
			{#each yTicks as v (v)}
				<line class="grid" x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} />
				<text class="tick" x={M.left - 6} y={sy(v) + 3.5} text-anchor="end">{yLabel(v)}</text>
			{/each}
			{#each xTicks as t (t)}
				<text class="tick" x={sx(t)} y={HGT - 6} text-anchor="middle">{xLabel(t)}</text>
			{/each}
			{#each drawn as c (c.platform)}
				{#if c.usual.length > 1}
					<path class="usual" d={path(c.usual)} stroke={COLOURS[c.platform]} />
				{/if}
				<path class="line" d={path(c.line)} stroke={COLOURS[c.platform]} />
			{/each}
		</svg>
	</div>
{:else}
	<svg class="spark" viewBox="0 0 {W} {HGT}" width={W} height={HGT} aria-hidden="true">
		{#each drawn as c (c.platform)}
			{#if c.usual.length > 1}
				<path class="usual" d={path(c.usual)} stroke={COLOURS[c.platform]} />
			{/if}
			<path class="line" d={path(c.line)} stroke={COLOURS[c.platform]} />
		{/each}
	</svg>
{/if}

<style>
	.wrap {
		width: 100%;
		min-width: 0;
	}

	svg {
		display: block;
		overflow: visible;
	}

	/* Its own width once measured; scaled to fit until then, never wider than its box. */
	.bigsvg {
		width: 100%;
		height: auto;
	}

	.line {
		fill: none;
		stroke-width: 1.7;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.usual {
		fill: none;
		stroke-width: 1.2;
		stroke-dasharray: 3 3;
		opacity: 0.5;
	}

	.wrap .line {
		stroke-width: 2;
	}

	.grid {
		stroke: var(--border);
		stroke-width: 1;
	}

	.tick {
		fill: var(--text-faint);
		font-size: 10.5px;
		font-variant-numeric: tabular-nums;
	}

	.none {
		color: var(--text-faint);
		font-size: 12px;
	}

	.none.big {
		display: block;
		padding: 12px 0;
	}
</style>
