<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { base } from '$app/paths';
	import PlatformIcon from './PlatformIcon.svelte';
	import { portal } from '$lib/portal';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { workers } from '$lib/stores/workers.svelte';
	import { projects } from '$lib/stores/projects.svelte';
	import { videoTodo } from '$lib/stores/videotodo.svelte';
	import { dashData } from '$lib/stores/dashdata.svelte';
	import type { DashVideo } from '$lib/repo';
	import { allowanceLabel, postAllowance } from '$lib/accounts';
	import { PLATFORMS } from '$lib/platforms';
	import { SHORT_MAX_SECONDS } from '$lib/videokind';
	import { edgeVelocity } from '$lib/autoscroll';
	import {
		ago,
		latestReleases,
		periodTotals,
		periods,
		postsPerPlatform,
		upcoming,
		type DashTarget,
		type PeriodKey
	} from '$lib/dashboard';
	import {
		DEFAULT_LAYOUT,
		SIZE_LABEL,
		SPAN,
		dropIndex,
		moveTo,
		nextSize,
		readLayout,
		sameLayout,
		titleOf,
		type LayoutItem,
		type WidgetId
	} from '$lib/dashlayout';
	import type { PlatformId } from '$lib/types';

	/**
	 * What the dashboard shows, for the brand in view — its YouTube channel
	 * and its posts. YouTube's policies forbid adding figures up across
	 * channels, so switching brand switches every number. The arithmetic is
	 * dashboard.ts, the data `dashData` (kept between openings, read on every
	 * opening and every 30 s while open), the arrangement dashlayout.ts: each
	 * box is a widget, dragged by its grip, its width changed by its button.
	 */

	brands.load();
	accounts.load();

	let now = $state(new Date());

	onMount(() => {
		// Fresh on every opening; until it lands, the last numbers show.
		void dashData.refresh().then(() => (now = new Date()));
		const refresh = setInterval(() => void dashData.refresh().then(() => (now = new Date())), 30_000);
		const clock = setInterval(() => (now = new Date()), 15_000);
		return () => {
			clearInterval(refresh);
			clearInterval(clock);
		};
	});

	/* ---- the brand in view ---- */

	let channel = $derived(accounts.for('youtube'));
	// One brand and at most one channel: nothing to choose between, so all of it.
	let unscoped = $derived(!channel && !brands.multiple && accounts.forPlatform('youtube').length <= 1);
	let channelVideos = $derived(
		channel ? dashData.videos.filter((v) => v.channelId === channel.account_id) : unscoped ? dashData.videos : []
	);
	let brandTargets = $derived(
		brands.multiple ? dashData.targets.filter((t) => t.brand === brands.currentId) : dashData.targets
	);
	let noChannel = $derived(!channel && !unscoped);

	let channelStatus = $derived.by(() => {
		const status = dashData.status;
		if (!status) return null;
		const own = channel ? status.channels?.[channel.account_id] : undefined;
		return { polledAt: own?.polledAt ?? status.polledAt, error: own?.error || status.error };
	});

	/* ---- the big numbers ---- */

	const OTHERS: PlatformId[] = ['instagram', 'tiktok', 'facebook'];

	let cards = $derived(
		periods(now).map((period) => ({
			...period,
			totals: periodTotals(channelVideos, period.from, now),
			others: postsPerPlatform(brandTargets, period.from, now, OTHERS)
		}))
	);

	const whole = new Intl.NumberFormat();
	const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

	/** Big, but readable: 12,345 up to five digits, 123.4K past them. */
	function big(n: number): string {
		return n >= 100_000 ? compact.format(n) : whole.format(n);
	}

	/* ---- coming up and latest ---- */

	let days = $derived(upcoming(brandTargets, now, 7));
	let releases = $derived(latestReleases(channelVideos, now, 5));
	let allowance = $derived(postAllowance(accounts.for('instagram')));

	/** One line per upload and slot: a video going to three platforms at 08:00 is one line with three icons. */
	function grouped(posts: DashTarget[]): { key: string; first: DashTarget; posts: DashTarget[] }[] {
		const out: { key: string; first: DashTarget; posts: DashTarget[] }[] = [];
		for (const post of posts) {
			const key = `${post.job}|${post.scheduled_at}`;
			const line = out.find((entry) => entry.key === key);
			if (line) line.posts.push(post);
			else out.push({ key, first: post, posts: [post] });
		}
		return out;
	}

	function dayName(date: Date, index: number): string {
		if (index === 0) return 'Today';
		if (index === 1) return 'Tomorrow';
		return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
	}

	function clock(iso: string): string {
		return new Date(iso.replace(' ', 'T')).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	function watchUrl(video: DashVideo): string {
		return video.duration > 0 && video.duration < SHORT_MAX_SECONDS
			? `https://www.youtube.com/shorts/${video.video_id}`
			: `https://www.youtube.com/watch?v=${video.video_id}`;
	}

	/** A sparkline's points in a 120 × 32 box. */
	function sparkPath(points: [number, number][]): string {
		const span = points[points.length - 1]?.[0] || 1;
		const top = Math.max(1, ...points.map((p) => p[1]));
		return points.map(([t, v]) => `${((t / span) * 120).toFixed(1)},${(31 - (v / top) * 28).toFixed(1)}`).join(' ');
	}

	const VERDICT = { ahead: 'Ahead of usual', behind: 'Behind usual', usual: 'About usual' };

	/* ---- the widgets ---- */

	const LAYOUT_KEY = 'flock.dashboard.layout';

	function loadLayout(): LayoutItem[] {
		try {
			return readLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'));
		} catch {
			return readLayout(null);
		}
	}

	function saveLayout() {
		try {
			localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
		} catch {
			// Private windows and blocked site data: the arrangement lasts the visit.
		}
	}

	let layout = $state<LayoutItem[]>(loadLayout());
	let customised = $derived(!sameLayout(layout, DEFAULT_LAYOUT));

	function resize(id: WidgetId) {
		layout = layout.map((item) => (item.id === id ? { ...item, size: nextSize(item.size) } : item));
		saveLayout();
	}

	function resetLayout() {
		layout = DEFAULT_LAYOUT.map((item) => ({ ...item }));
		saveLayout();
	}

	/*
	 * Dragging is pointer events captured on the grip, like the calendar's
	 * cards: the widget moves through the grid live as the pointer crosses
	 * the others (dropIndex: which half of the widget under it), with a
	 * pause the length of the reshuffle so a widget changing the rows under
	 * the pointer cannot flicker back and forth. Near the top or bottom edge
	 * the dashboard scrolls (autoscroll.ts). A title follows the pointer.
	 */
	let grid = $state<HTMLElement | null>(null);
	let dragging = $state<WidgetId | null>(null);
	let pointer = $state({ x: 0, y: 0 });
	let lockUntil = 0;
	let frame = 0;

	function startDrag(event: PointerEvent, id: WidgetId) {
		if (event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// A pointer already gone; its moves still reach the grip while over it.
		}
		dragging = id;
		pointer = { x: event.clientX, y: event.clientY };
		const move = (e: PointerEvent) => {
			pointer = { x: e.clientX, y: e.clientY };
			hitTest();
		};
		const end = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', end);
			handle.removeEventListener('pointercancel', end);
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
			dragging = null;
			saveLayout();
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', end);
		handle.addEventListener('pointercancel', end);
		frame = requestAnimationFrame(edgeScroll);
	}

	function hitTest() {
		if (!dragging || performance.now() < lockUntil) return;
		const under = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('[data-widget]');
		const target = under?.dataset.widget as WidgetId | undefined;
		if (!under || !target || target === dragging) return;
		const next = moveTo(layout, dragging, dropIndex(layout, dragging, target, pointer, under.getBoundingClientRect()));
		if (sameLayout(next, layout)) return;
		layout = next;
		lockUntil = performance.now() + 240;
	}

	function edgeScroll() {
		frame = 0;
		if (!dragging) return;
		const scroller = grid?.closest<HTMLElement>('.dashboard');
		if (scroller) {
			const box = scroller.getBoundingClientRect();
			const step = edgeVelocity(pointer.y, box.top, box.bottom);
			if (step !== 0) {
				scroller.scrollTop += step;
				hitTest();
			}
		}
		frame = requestAnimationFrame(edgeScroll);
	}

	/** Arrow keys on a grip move its widget one place; focus follows it. */
	async function keyMove(event: KeyboardEvent, id: WidgetId) {
		const step =
			event.key === 'ArrowLeft' || event.key === 'ArrowUp'
				? -1
				: event.key === 'ArrowRight' || event.key === 'ArrowDown'
					? 1
					: 0;
		if (!step) return;
		event.preventDefault();
		const from = layout.findIndex((item) => item.id === id);
		layout = moveTo(layout, id, from + step);
		saveLayout();
		await tick();
		grid?.querySelector<HTMLElement>(`[data-grip="${id}"]`)?.focus();
	}
</script>

{#snippet numbers(key: PeriodKey)}
	{@const card = cards.find((c) => c.key === key)}
	{#if noChannel}
		<p class="none">No YouTube channel is connected for this brand.</p>
	{:else if card}
		<div class="pair">
			<div>
				<span class="big accent">{big(card.totals.released)}</span>
				<span class="unit">{card.totals.released === 1 ? 'video out' : 'videos out'}</span>
			</div>
			<div>
				<span class="big" title={whole.format(card.totals.viewsOnReleased)}>{big(card.totals.viewsOnReleased)}</span>
				<span class="unit">views on them</span>
			</div>
		</div>
		<p
			class="gained"
			title="Views every video flock watches on this channel gained since the start of the period — the newest 50 are read every poll{card
				.totals.gainedPartly
				? '. Some were not watched yet at its start, so they count from when flock first saw them.'
				: '.'}"
		>
			<strong>+{whole.format(card.totals.gained)}</strong> views on the channel{card.totals.gainedPartly ? ' (at least)' : ''}
		</p>
		{#if Object.keys(card.others).length > 0}
			<p class="others">
				{#each OTHERS.filter((p) => card.others[p]) as p (p)}
					<span><PlatformIcon platform={p} size={12} /> {card.others[p]} on {PLATFORMS[p].label}</span>
				{/each}
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet comingBody()}
	<ol class="coming">
		{#each days as day, i (day.date.getTime())}
			<li class="day" class:empty={day.posts.length === 0}>
				<span class="dayname">{dayName(day.date, i)}</span>
				{#if day.posts.length === 0}
					<span class="nothing">Nothing scheduled</span>
				{:else}
					<ul>
						{#each grouped(day.posts) as line (line.key)}
							<li>
								<span class="time">{clock(line.first.scheduled_at)}</span>
								<span class="icons">
									{#each line.posts as post (post.id)}
										<span
											title="{PLATFORMS[post.platform].label}{post.status === 'scheduled'
												? ': uploaded, YouTube releases it at its slot'
												: ''}"><PlatformIcon platform={post.platform} size={14} /></span
										>
									{/each}
								</span>
								<a href="{base}/log/upload?job={encodeURIComponent(line.first.job)}"
									>{line.posts.find((p) => p.title)?.title || line.first.jobTitle || 'Untitled'}</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>
{/snippet}

{#snippet latestBody()}
	{#if noChannel}
		<p class="none">No YouTube channel is connected for this brand.</p>
	{:else if releases.length === 0}
		<p class="none">{dashData.loading ? 'Loading…' : 'No public videos read yet.'}</p>
	{:else}
		<ul class="latest">
			{#each releases as release (release.video.video_id)}
				<li>
					{#if release.video.thumb}
						<img src={release.video.thumb} alt="" loading="lazy" />
					{:else}
						<span class="noimg"></span>
					{/if}
					<span class="vid">
						<a href={watchUrl(release.video)} target="_blank" rel="noopener">{release.video.title}</a>
						<span class="age">{ago(release.age)} ago</span>
					</span>
					<span class="views" title="Views now">{whole.format(release.video.views ?? 0)}</span>
					<svg class="spark" viewBox="0 0 120 32" width="120" height="32" aria-hidden="true">
						<polyline
							points={sparkPath(release.points)}
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linejoin="round"
						/>
					</svg>
					{#if release.verdict}
						<span
							class="verdict {release.verdict}"
							title="The channel's videos usually had {whole.format(Math.round(release.usual ?? 0))} views {ago(
								release.age
							)} after release"
						>
							{VERDICT[release.verdict]}
						</span>
					{:else}
						<span class="verdict" title="Not enough videos watched from release to compare with">—</span>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="note">
			The line is each video's views over its first two days. "Usual" is the middle of the channel's other videos at
			the same age.
		</p>
	{/if}
{/snippet}

{#snippet systemBody()}
	<dl class="system">
		<dt>Workers</dt>
		<dd>
			<span class="dots">
				{#each workers.view.dots as dot (dot.role)}
					<span class="dot {dot.state}" title={dot.title}></span>
				{/each}
			</span>
			{workers.view.lines.map((line) => line.text).join(' · ')}
		</dd>
		{#if dashData.status}
			<dt>YouTube</dt>
			<dd>
				{channelStatus?.polledAt
					? `Stats read ${ago(now.getTime() - Date.parse(channelStatus.polledAt))} ago`
					: 'Stats not read yet'}
				· {whole.format(dashData.status.unitsToday)} of {whole.format(dashData.status.budget)} units today
			</dd>
		{/if}
		{#if allowance}
			<dt>Instagram</dt>
			<dd>{allowanceLabel(allowance)}</dd>
		{/if}
		{#if accounts.tiktok}
			<dt>TikTok</dt>
			<dd>
				@{accounts.tiktok.username}{accounts.tiktok.fetchedAt
					? ` · read ${ago(now.getTime() - Date.parse(accounts.tiktok.fetchedAt))} ago`
					: ''}
			</dd>
		{/if}
	</dl>
{/snippet}

{#snippet waitingBody()}
	<ul class="waiting">
		<li>
			<span class="count">{projects.listed.length}</span>
			<span>{projects.listed.length === 1 ? 'project folder' : 'project folders'} not uploaded yet</span>
		</li>
		<li>
			<span class="count">{dashData.unused ?? '…'}</span>
			<span><a href="{base}/upload">{dashData.unused === 1 ? 'file' : 'files'} in the watch folders</a> no upload has used</span>
		</li>
		<li>
			<span class="count">{videoTodo.lines.length}</span>
			<span>{videoTodo.lines.length === 1 ? 'video' : 'videos'} on the To finish list</span>
		</li>
	</ul>
{/snippet}

<header class="head">
	<div>
		<h1>Dashboard</h1>
		<p>
			{brands.current?.name ?? 'Everything'}{channel ? ` · YouTube: ${channel.name || channel.handle}` : ''}{dashData.loading
				? ' · reading…'
				: dashData.loadedAt
					? ` · read ${dashData.loadedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
					: ''}
		</p>
		{#if brands.multiple}
			<div class="brands" role="radiogroup" aria-label="Brand in view">
				{#each brands.ordered as brand (brand.id)}
					<button
						class="brandchip"
						class:on={brand.id === brands.currentId}
						role="radio"
						aria-checked={brand.id === brands.currentId}
						onclick={() => brands.select(brand.id)}>{brand.name}</button
					>
				{/each}
			</div>
		{/if}
	</div>
	<div class="actions">
		{#if customised}
			<button class="btn sm ghostbtn" onclick={resetLayout} title="Put every widget back in its first place and width"
				>Reset layout</button
			>
		{/if}
		<button class="btn sm" onclick={() => dashData.refresh()} disabled={dashData.loading}>Refresh</button>
	</div>
</header>

{#if dashData.error}
	<p class="banner bad">Could not reach PocketBase — {dashData.error}</p>
{/if}

<div class="widgets" bind:this={grid}>
	{#each layout as item (item.id)}
		<section
			class="card widget"
			class:lifted={dragging === item.id}
			style:--span={SPAN[item.size]}
			data-widget={item.id}
			aria-label={titleOf(item.id)}
			animate:flip={{ duration: 200 }}
		>
			<header class="whead">
				<h2>{titleOf(item.id)}</h2>
				<span class="tools">
					<button
						class="tool"
						onclick={() => resize(item.id)}
						title="Width {SIZE_LABEL[item.size]} — click for {SIZE_LABEL[nextSize(item.size)]}"
						aria-label="Change the width of {titleOf(item.id)}, now {SIZE_LABEL[item.size]}"
					>
						{SIZE_LABEL[item.size]}
					</button>
					<button
						class="tool grip"
						data-grip={item.id}
						onpointerdown={(e) => startDrag(e, item.id)}
						onkeydown={(e) => keyMove(e, item.id)}
						title="Drag to move it, or use the arrow keys"
						aria-label="Move {titleOf(item.id)}"
					>
						<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
							<circle cx="5.5" cy="3.5" r="1.3" fill="currentColor" />
							<circle cx="10.5" cy="3.5" r="1.3" fill="currentColor" />
							<circle cx="5.5" cy="8" r="1.3" fill="currentColor" />
							<circle cx="10.5" cy="8" r="1.3" fill="currentColor" />
							<circle cx="5.5" cy="12.5" r="1.3" fill="currentColor" />
							<circle cx="10.5" cy="12.5" r="1.3" fill="currentColor" />
						</svg>
					</button>
				</span>
			</header>
			{#if item.id === 'today' || item.id === 'week' || item.id === 'month'}
				{@render numbers(item.id)}
			{:else if item.id === 'coming'}
				{@render comingBody()}
			{:else if item.id === 'latest'}
				{@render latestBody()}
			{:else if item.id === 'system'}
				{@render systemBody()}
			{:else if item.id === 'waiting'}
				{@render waitingBody()}
			{/if}
		</section>
	{/each}
</div>

{#if dragging}
	<div class="ghost" use:portal style:left="{pointer.x + 14}px" style:top="{pointer.y + 12}px">
		{titleOf(dragging)}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 20px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.actions {
		display: flex;
		gap: 8px;
		flex: none;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.ghostbtn {
		background: transparent;
		border-color: transparent;
		color: var(--text-dim);
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}

	.brandchip {
		padding: 5px 13px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		font-size: 12px;
		font-weight: 560;
		color: var(--text-dim);
		transition: border-color 0.14s, background 0.14s, color 0.14s;
	}

	.brandchip:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.brandchip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.banner {
		margin: 0 0 16px;
		padding: 11px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 13px;
	}

	.banner.bad {
		color: var(--danger);
	}

	/* ---- the grid of widgets ---- */

	.widgets {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		grid-auto-flow: row dense;
		gap: 16px;
	}

	.widget {
		grid-column: span var(--span);
		min-width: 0;
		padding: 16px 20px 18px;
		/* The content answers to the widget's own width, whatever its place. */
		container-type: inline-size;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			opacity 0.15s;
	}

	.widget.lifted {
		border-color: var(--pink);
		box-shadow: var(--glow);
		opacity: 0.8;
	}

	.whead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
		min-height: 24px;
	}

	h2 {
		margin: 0;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.tools {
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.widget:hover .tools,
	.widget:focus-within .tools,
	.widget.lifted .tools {
		opacity: 1;
	}

	@media (hover: none) {
		.tools {
			opacity: 1;
		}
	}

	.tool {
		display: grid;
		place-items: center;
		min-width: 24px;
		height: 24px;
		padding: 0 6px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--bg-elev);
		font-size: 11px;
		font-weight: 650;
		color: var(--text-dim);
		transition:
			border-color 0.14s,
			color 0.14s;
	}

	.tool:hover,
	.tool:focus-visible {
		border-color: var(--pink);
		color: var(--text);
		outline: none;
	}

	.grip {
		cursor: grab;
		touch-action: none;
	}

	.widget.lifted .grip {
		cursor: grabbing;
	}

	.ghost {
		position: fixed;
		z-index: 70;
		padding: 5px 11px;
		border-radius: 999px;
		background: var(--accent-grad);
		color: #fff;
		font-size: 12px;
		font-weight: 650;
		box-shadow: var(--shadow);
		pointer-events: none;
	}

	@media (max-width: 1100px) {
		.widget {
			grid-column: 1 / -1;
		}
	}

	.none,
	.note {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	.note {
		margin-top: 12px;
		font-size: 11.5px;
	}

	/* ---- big numbers ---- */

	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.big {
		display: block;
		font-size: clamp(30px, 11cqi, 60px);
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.big.accent {
		background: var(--accent-grad);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.unit {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.gained {
		margin: 14px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.gained strong {
		color: var(--ok);
		font-weight: 650;
	}

	.others {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.others span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	/* ---- coming up ---- */

	.coming,
	.coming ul,
	.latest,
	.waiting {
		list-style: none;
		margin: 0;
		padding: 0;
	}










	.coming .day {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr);
		gap: 10px;
		padding: 7px 0;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}

	.coming .day:last-child {
		border-bottom: none;
	}

	.dayname {
		font-weight: 600;
		color: var(--text-dim);
	}

	.day.empty .dayname {
		color: var(--text-faint);
		font-weight: 500;
	}

	.nothing {
		color: var(--text-faint);
		font-style: italic;
		font-size: 12px;
	}

	.coming ul li {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		padding: 1px 0;
	}

	.coming ul li a {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		text-decoration: none;
	}

	.coming ul li a:hover {
		color: var(--pink-soft);
	}

	.time {
		flex: none;
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.icons {
		flex: none;
		display: inline-flex;
		gap: 3px;
	}

	.icons span {
		display: inline-flex;
	}

	@container (max-width: 380px) {
		.coming .day {
			grid-template-columns: minmax(0, 1fr);
			gap: 3px;
		}
	}

	/* ---- latest releases ---- */

	.latest li {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr) 80px 120px 120px;
		align-items: center;
		gap: 14px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}

	.latest li:last-child {
		border-bottom: none;
	}

	.latest img,
	.noimg {
		width: 64px;
		height: 36px;
		border-radius: 6px;
		object-fit: cover;
		background: var(--bg-elev);
	}

	.vid {
		min-width: 0;
	}

	.vid a {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 560;
		color: var(--text);
		text-decoration: none;
	}

	.vid a:hover {
		color: var(--pink-soft);
	}

	.age {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.views {
		text-align: right;
		font-size: 15px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.spark {
		color: var(--pink);
	}

	.verdict {
		justify-self: start;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 650;
		white-space: nowrap;
		background: var(--surface-3);
		color: var(--text-dim);
	}

	.verdict.ahead {
		background: rgba(52, 211, 153, 0.14);
		color: var(--ok);
	}

	.verdict.behind {
		background: rgba(251, 191, 36, 0.12);
		color: var(--warn);
	}

	/* Narrower widget: the line goes first, then the verdict. */
	@container (max-width: 760px) {
		.latest li {
			grid-template-columns: 64px minmax(0, 1fr) 64px 110px;
			gap: 10px;
		}
		.spark,
		.note {
			display: none;
		}
	}

	@container (max-width: 470px) {
		.latest li {
			grid-template-columns: 48px minmax(0, 1fr) 56px;
		}
		.latest img,
		.noimg {
			width: 48px;
			height: 27px;
		}
		.verdict {
			display: none;
		}
	}

	/* ---- system and waiting ---- */

	.system {
		display: grid;
		grid-template-columns: 90px minmax(0, 1fr);
		gap: 7px 12px;
		margin: 0;
		font-size: 12.5px;
	}

	.system dt {
		color: var(--text-faint);
	}

	.system dd {
		margin: 0;
		color: var(--text-dim);
	}

	.dots {
		display: inline-flex;
		gap: 4px;
		margin-right: 6px;
		vertical-align: middle;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--danger);
	}

	.dot.up {
		background: var(--ok);
	}

	.dot.covering {
		background: var(--warn);
	}

	.waiting li {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 5px 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.count {
		min-width: 34px;
		font-size: 22px;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.waiting a {
		color: var(--text-dim);
	}

	.waiting a:hover {
		color: var(--pink-soft);
	}
</style>
