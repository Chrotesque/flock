<script lang="ts">
	import type { Snippet } from 'svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { averageCount, shortCount } from '$lib/format';
	import type { FollowerGain, FollowerState } from '$lib/followers';
	import {
		PLATFORM_COLOURS,
		periodAverage,
		periodStart,
		statsOfPeriod,
		videoAverage,
		type PeriodAverage,
		type PeriodKey,
		type PeriodStats,
		type Release,
		type StatPlatform
	} from '$lib/releases';
	import {
		boxFilter,
		boxName,
		boxPeriod,
		boxReleases,
		boxSummary,
		timeframeLabel,
		type BoxMetric,
		type StatBox
	} from '$lib/statbox';

	/**
	 * One stat box (statbox.ts): its name over its numbers, each with a popup of
	 * how it is made and each platform's part. It counts the releases it is
	 * given — the brand in view's, all of them — through its own filter.
	 * `sample` draws the box with dashes (Settings' preview, which has no
	 * numbers); `head` adds controls beside the name (Edit mode).
	 */
	let {
		box,
		releases = [],
		followers = [],
		now,
		leftward = false,
		sample = false,
		head
	}: {
		box: StatBox;
		releases?: Release[];
		followers?: FollowerState[];
		now: Date;
		leftward?: boolean;
		sample?: boolean;
		head?: Snippet;
	} = $props();

	const filter = $derived(boxFilter(box, now));
	const key = $derived(boxPeriod(box));
	const ranged = $derived(box.timeframe.kind !== 'period');
	const counted = $derived(sample ? [] : boxReleases(releases, filter));
	const total = $derived(box.how === 'total' ? statsOfPeriod(counted, filter, key, now, followers) : null);
	const average = $derived(
		box.how === 'video'
			? videoAverage(counted, filter, key, now, followers)
			: box.how === 'average'
				? periodAverage(counted, filter, key, now, followers)
				: null
	);
	// A platform whose views are read for none of the videos (Facebook without
	// read_insights) says so, rather than +0.
	const viewsUnread = $derived(
		new Set(box.platforms.filter((p) => !counted.some((r) => typeof r.posts[p]?.views === 'number')))
	);

	const whole = new Intl.NumberFormat();
	const avgExact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
	const short = (n: number) => shortCount(n);
	const avg = (n: number) => averageCount(n);
	const signed = (n: number) => (n > 0 ? `+${whole.format(n)}` : n < 0 ? `−${whole.format(-n)}` : '0');
	const signedShort = (n: number) => (n > 0 ? `+${short(n)}` : n < 0 ? `−${short(-n)}` : '0');
	const signedAvg = (n: number) => (avg(n) === '0' ? '0' : n > 0 ? `+${avg(n)}` : `−${avg(-n)}`);
	const signedAvgExact = (n: number) => {
		const text = avgExact.format(Math.abs(n));
		return text === '0' ? '0' : n > 0 ? `+${text}` : `−${text}`;
	};

	const FOLLOWER_WORDS: Record<StatPlatform, [string, string]> = {
		youtube: ['subscriber', 'subscribers'],
		instagram: ['follower', 'followers'],
		tiktok: ['follower', 'followers'],
		facebook: ['follower', 'followers']
	};
	const onDay = (iso: string) =>
		new Date(Date.parse(String(iso ?? '').replace(' ', 'T'))).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

	function gainWords(gain: FollowerGain | null, p: StatPlatform): string {
		if (!gain) return 'not read yet';
		const state = followers.find((s) => s.platform === p);
		const word = FOLLOWER_WORDS[p][Math.abs(gain.gained) === 1 ? 0 : 1];
		return `${signed(gain.gained)} ${word}${gain.partly && state ? ` since ${onDay(state.since)}` : ''}`;
	}

	const PER: Record<PeriodKey, string> = {
		today: 'a day',
		week: 'a week',
		month: 'a month',
		quarter: 'a quarter',
		year: 'a year',
		lifetime: 'a video'
	};

	const PERIOD_UNIT: Record<PeriodKey, [string, string]> = {
		today: ['day', 'days'],
		week: ['week', 'weeks'],
		month: ['month', 'months'],
		quarter: ['quarter', 'quarters'],
		year: ['year', 'years'],
		lifetime: ['video', 'videos']
	};

	/** The timeframe inside a sentence: "the last 30 days", "Nov 1 – Today". */
	const label = $derived(
		box.timeframe.kind === 'days'
			? box.timeframe.days === 1
				? 'the last day'
				: `the last ${box.timeframe.days} days`
			: timeframeLabel(box.timeframe)
	);

	/** What an average box's numbers are over; `perVideo` shares them over the videos. */
	function averageNote(a: PeriodAverage, perVideo: boolean): string {
		const [one, many] = PERIOD_UNIT[a.key];
		const videos = (n: number) => `${whole.format(n)} ${n === 1 ? 'video' : 'videos'}`;
		const where = ranged ? ` in ${label}` : '';
		if (a.key === 'lifetime') return a.periods ? `Over the ${videos(a.periods)} out${where}, shared over them.` : `No video out${where || ' yet'}.`;
		const running = a.key === 'today' ? 'today is' : `this ${one} is`;
		const tail = a.to.getTime() === periodStart(a.key, now).getTime() ? `; ${running} left out until it is over.` : '.';
		if (!a.periods || !a.from) return `Not a whole ${one} since the first video yet: ${running} left out until it is over.`;
		const day = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
		const span = `the ${whole.format(a.periods)} whole ${a.periods === 1 ? one : many} since ${day(a.from)}`;
		if (perVideo) return a.released ? `Over the ${videos(a.released)} out in ${span}, shared over them${tail}` : `No video went out in ${span}.`;
		return `Over ${span}${tail}`;
	}

	interface Head {
		strong?: string;
		tone?: 'exact' | 'down' | 'up';
		text: string;
	}
	interface Line {
		platform: StatPlatform;
		text: string;
		plus?: string;
	}
	interface Cell {
		metric: BoxMetric;
		big: string;
		faint: boolean;
		accent: boolean;
		unit: string;
		heads: Head[];
		note: string;
		lines: Line[];
	}

	const span = $derived(ranged ? `in ${label}` : key === 'lifetime' ? 'ever' : 'in the period');

	function totalCell(m: BoxMetric, s: PeriodStats): Cell {
		const base = { metric: m, faint: false, accent: false, heads: [] as Head[], note: '', lines: [] as Line[] };
		const each = (text: (p: StatPlatform) => string, plus?: (p: StatPlatform) => string) =>
			box.platforms.map((p) => ({ platform: p, text: text(p), plus: plus?.(p) }));
		if (m === 'videos')
			return {
				...base,
				big: short(s.released),
				accent: true,
				unit: s.released === 1 ? 'video' : 'videos',
				note: `The public videos that went out ${span}.`
			};
		if (m === 'views')
			return {
				...base,
				big: short(s.views),
				unit: 'views',
				heads: [
					{ strong: whole.format(s.views), tone: 'exact', text: ' views on the videos out' },
					{ strong: `+${whole.format(s.gained)}`, tone: 'up', text: ` views gained${s.partly ? ' (at least)' : ''}` }
				],
				note:
					key === 'lifetime' && !ranged
						? 'Every view of every video, since each went out.'
						: `Views every video gained ${ranged ? `in ${label}` : 'since the start of the period'}${
								s.partly ? '. Some were not read yet at its start, so they count from when flock first read them.' : '.'
							}`,
				lines: each(
					(p) => (viewsUnread.has(p) ? 'views not read yet' : `${whole.format(s.byPlatform[p].views)} on the videos out`),
					(p) => (viewsUnread.has(p) ? '' : `+${whole.format(s.byPlatform[p].gained)}`)
				)
			};
		if (m === 'likes' || m === 'comments')
			return {
				...base,
				big: short(s[m]),
				unit: m,
				heads: [{ strong: whole.format(s[m]), tone: 'exact', text: ` ${m} on the videos out` }],
				note: `The ${m} the videos that went out ${span} have now.`,
				lines: each((p) => whole.format(s.byPlatform[p][m]))
			};
		return {
			...base,
			big: s.followers ? signedShort(s.followers.gained) : '—',
			faint: !s.followers,
			unit: 'follows',
			heads: [
				s.followers
					? {
							strong: signed(s.followers.gained),
							tone: s.followers.gained < 0 ? 'down' : 'up',
							text: ` followers and subscribers${s.followers.partly ? ' (since flock began reading them)' : ''}`
						}
					: { text: 'No follower counts read yet' }
			],
			note:
				key === 'lifetime' && !ranged
					? "The accounts' counts now: everyone who follows them."
					: `How far the accounts' counts moved ${ranged ? `in ${label}` : 'since the start of the period'}: followers won less followers lost.`,
			lines: each((p) => gainWords(s.byPlatform[p].followers, p))
		};
	}

	function averageCell(m: BoxMetric, a: PeriodAverage): Cell {
		const perVideo = box.how === 'video';
		const per = perVideo ? 'a video' : PER[a.key];
		const empty = !a.periods || (perVideo && a.released === 0);
		const note = averageNote(a, perVideo);
		const base = { metric: m, faint: empty, accent: false, heads: [] as Head[], note, lines: [] as Line[] };
		const each = (text: (p: StatPlatform) => string) =>
			empty ? [] : box.platforms.map((p) => ({ platform: p, text: text(p) }));
		if (m === 'videos')
			return {
				...base,
				big: empty ? '—' : avg(a.released),
				accent: true,
				unit: avg(a.released) === '1' ? 'video' : 'videos',
				heads: empty ? [] : [{ strong: avgExact.format(a.released), tone: 'exact', text: ` videos ${per}` }]
			};
		if (m === 'views' || m === 'likes' || m === 'comments')
			return {
				...base,
				big: empty ? '—' : avg(a[m]),
				unit: m,
				heads: empty ? [] : [{ strong: avgExact.format(a[m]), tone: 'exact', text: ` ${m} ${per}` }],
				lines: each((p) =>
					m === 'views' && viewsUnread.has(p) ? 'views not read yet' : `${avgExact.format(a.byPlatform[p][m])} ${per}`
				)
			};
		const f = a.followers;
		return {
			...base,
			big: f && !empty ? signedAvg(f.gained) : '—',
			faint: !f || empty,
			unit: 'follows',
			heads: [
				f && !empty
					? {
							strong: signedAvgExact(f.gained),
							tone: f.gained < 0 ? 'down' : 'up',
							text: ` followers and subscribers ${per}${f.partly ? ' (over the stretch flock read them)' : ''}`
						}
					: { text: 'No follower counts read for it yet' }
			],
			note:
				a.key === 'lifetime' && ranged
					? `How far the accounts' counts moved in ${label}, shared over the videos out in it.`
					: a.key === 'lifetime'
						? "The accounts' counts now, shared over the videos out."
						: perVideo
							? "How far the accounts' counts moved over the same whole periods, shared over the videos that went out in them. A count flock began reading later is scaled up from what it read."
							: `How far the accounts' counts moved ${per}, on average over the same whole periods: followers won less followers lost. A count flock began reading later is scaled up from what it read.`,
			lines: empty
				? []
				: box.platforms.map((p) => {
						const gain = a.byPlatform[p].followers;
						return {
							platform: p,
							text: gain ? `${signedAvgExact(gain.gained)} ${per}${gain.partly ? ' (scaled from what flock read)' : ''}` : 'not read yet'
						};
					})
		};
	}

	const cells = $derived(
		box.metrics.map((m): Cell => {
			if (sample) return { metric: m, big: '—', faint: true, accent: false, unit: m, heads: [], note: '', lines: [] };
			if (total) return totalCell(m, total);
			return averageCell(m, average!);
		})
	);
	const uid = $props.id();
</script>

<div class="period" class:leftward data-box={box.id} style:--n={box.metrics.length}>
	<div class="phead">
		<h2 title={boxSummary(box)}>{boxName(box)}</h2>
		{@render head?.()}
	</div>
	<div class="trio">
		{#each cells as cell (cell.metric)}
			{#if sample || (cell.heads.length === 0 && !cell.note)}
				<div>
					<span class="bignum" class:accent={cell.accent && !sample} class:faint={cell.faint}>{cell.big}</span>
					<span class="unit">{cell.unit}</span>
				</div>
			{:else}
				<div class="hold">
					<button class="holdnum" type="button" aria-describedby="{uid}-{cell.metric}">
						<span class="bignum" class:accent={cell.accent} class:faint={cell.faint}>{cell.big}</span>
						<span class="unit">{cell.unit}</span>
					</button>
					<div class="ppop" id="{uid}-{cell.metric}" role="tooltip">
						{#each cell.heads as h, i (i)}
							<p class="gained">
								{#if h.strong}<strong class={h.tone}>{h.strong}</strong>{/if}{h.text}
							</p>
						{/each}
						{#if cell.note}<p class="pnote">{cell.note}</p>{/if}
						{#each cell.lines as line (line.platform)}
							<p class="pline">
								<i style:background={PLATFORM_COLOURS[line.platform]}></i>
								<span class="pname">{PLATFORMS[line.platform].label}</span>
								<span class="pval">{line.text}</span>
								{#if line.plus}<strong>{line.plus}</strong>{/if}
							</p>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	</div>
</div>

<style>
	/* Each box sizes its numbers to itself; it grows with the numbers it holds. */
	.period {
		flex: var(--n) 1 calc(36px + var(--n) * 62px);
		min-width: 0;
		padding: 0 18px;
		container-type: inline-size;
	}

	.period:not(:first-child) {
		border-left: 1px solid var(--border);
	}

	.phead {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 6px;
		min-height: 20px;
		margin-bottom: 8px;
	}

	h2 {
		flex: 1;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		line-height: 1.6;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--text-faint);
	}

	/* Each number as wide as it is, spread over the box: equal shares let
	   "166.2k" run into the number beside it. */
	.trio {
		display: grid;
		grid-auto-columns: auto;
		grid-auto-flow: column;
		justify-content: space-between;
		gap: 8px;
	}

	.bignum {
		display: block;
		font-size: clamp(16px, calc(34cqi / var(--n)), 25px);
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.bignum.faint {
		color: var(--text-faint);
	}

	.bignum.accent {
		background: var(--accent-grad);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.unit {
		display: block;
		margin-top: 3px;
		font-size: 10.5px;
		color: var(--text-dim);
	}

	/* A number whose details open on hover or focus. */
	.hold {
		position: relative;
	}

	.holdnum {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: default;
		outline-offset: 3px;
	}

	.hold:hover .bignum,
	.holdnum:focus-visible .bignum {
		text-decoration: underline dotted var(--text-faint);
		text-underline-offset: 5px;
		text-decoration-thickness: 1px;
	}

	.ppop {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 30;
		display: grid;
		gap: 5px;
		width: max-content;
		min-width: 230px;
		max-width: min(340px, calc(100vw - 40px));
		padding: 11px 13px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		font-size: 12px;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
		opacity: 0;
		visibility: hidden;
		transform: translateY(-4px);
		transition:
			opacity 0.14s,
			transform 0.14s,
			visibility 0s 0.14s;
	}

	/* Bridges the gap to the number, so the pointer can move onto the popup. */
	.ppop::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -9px;
		height: 9px;
	}

	/* The last boxes open theirs leftwards, so they stay on screen. */
	.leftward .ppop {
		left: auto;
		right: 0;
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

	.ppop p {
		margin: 0;
	}

	.gained {
		font-size: 12.5px;
		color: var(--text);
	}

	.pnote {
		margin-bottom: 4px !important;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.pline {
		display: grid;
		grid-template-columns: 8px auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 7px;
	}

	.pline i {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	.pname {
		color: var(--text);
	}

	.pval {
		color: var(--text-faint);
	}

	.pline strong,
	.gained strong.up {
		color: var(--ok);
		font-weight: 650;
	}

	.gained strong.exact {
		color: var(--text);
		font-weight: 650;
	}

	.gained strong.down {
		color: var(--warn);
		font-weight: 650;
	}

	@media (max-width: 760px) {
		.period:not(:first-child) {
			border-left: 0;
			border-top: 1px solid var(--border);
			padding-top: 12px;
		}
	}
</style>
