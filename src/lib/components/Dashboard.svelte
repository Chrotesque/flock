<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import PlatformIcon from './PlatformIcon.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { workers } from '$lib/stores/workers.svelte';
	import { projects } from '$lib/stores/projects.svelte';
	import { videoTodo } from '$lib/stores/videotodo.svelte';
	import {
		getStatsStatus,
		isUsed,
		loadDashTargets,
		loadDashVideos,
		loadLocalIndex,
		loadUsedSources,
		loadWatchIndex,
		type DashVideo
	} from '$lib/repo';
	import { allowanceLabel, postAllowance } from '$lib/accounts';
	import { PLATFORMS } from '$lib/platforms';
	import { firstLine } from '$lib/format';
	import { SHORT_MAX_SECONDS } from '$lib/videokind';
	import {
		ago,
		latestReleases,
		periodTotals,
		periods,
		postsPerPlatform,
		targetProblems,
		upcoming,
		type Attention,
		type DashTarget
	} from '$lib/dashboard';
	import type { PlatformId, StatsStatus } from '$lib/types';

	/**
	 * What the dashboard shows, for the brand in view — its YouTube channel
	 * and its posts. YouTube's policies forbid adding figures up across
	 * channels, so switching brand switches every number. The arithmetic is
	 * dashboard.ts; this reads, refreshes every 30 s while open, and lays out.
	 */

	brands.load();
	accounts.load();

	let videos = $state<DashVideo[]>([]);
	let targets = $state<(DashTarget & { brand: string })[]>([]);
	let status = $state<StatsStatus | null>(null);
	let unused = $state<number | null>(null);
	let loadedAt = $state<Date | null>(null);
	let loading = $state(true);
	let error = $state('');
	let now = $state(new Date());

	async function load() {
		loading = true;
		try {
			const [v, t, s] = await Promise.all([
				loadDashVideos(),
				loadDashTargets(),
				getStatsStatus().catch(() => null)
			]);
			videos = v;
			targets = t;
			status = s;
			error = '';
			loadedAt = new Date();
			now = new Date();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
		void countUnused();
	}

	/** Files in the watch folders that no upload has used yet — the same test the Upload page hides them by. */
	async function countUnused() {
		const [nas, local, used] = await Promise.all([
			loadWatchIndex().catch(() => null),
			loadLocalIndex().catch(() => null),
			loadUsedSources().catch(() => null)
		]);
		if (!used) return;
		unused = [...(nas?.files ?? []), ...(local?.files ?? [])].filter((file) => !isUsed(used, file)).length;
	}

	onMount(() => {
		void load();
		const refresh = setInterval(load, 30_000);
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
		channel ? videos.filter((v) => v.channelId === channel.account_id) : unscoped ? videos : []
	);
	let brandTargets = $derived(brands.multiple ? targets.filter((t) => t.brand === brands.currentId) : targets);
	let noChannel = $derived(!channel && !unscoped);

	let channelStatus = $derived.by(() => {
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

	/* ---- needs attention ---- */

	let attention = $derived.by((): Attention[] => {
		const items: Attention[] = targetProblems(brandTargets, now, (p) => PLATFORMS[p].label);
		for (const dot of workers.view.dots) {
			// The PC's worker is often off on purpose; what it holds up shows on its own.
			if (dot.state !== 'down' || dot.role === 'local') continue;
			items.push({
				level: 'error',
				text: dot.role === 'nas' ? 'The NAS worker is not running' : 'The worker is not running',
				detail: 'Nothing is published or filed until it is back.',
				job: ''
			});
		}
		const creator = accounts.tiktok;
		if (creator?.error) {
			items.push({
				level: 'error',
				text: `TikTok says @${creator.username} cannot post right now`,
				detail: firstLine(creator.error),
				job: ''
			});
		}
		const allowance = postAllowance(accounts.for('instagram'));
		if (allowance && allowance.left <= 0) {
			const due = brandTargets.filter(
				(t) =>
					t.platform === 'instagram' &&
					t.status === 'pending' &&
					Date.parse(t.scheduled_at.replace(' ', 'T')) - now.getTime() < 24 * 3_600_000
			).length;
			if (due > 0) {
				items.push({
					level: 'warn',
					text: `Instagram's ${allowance.total} posts in 24 h are used up`,
					detail: `${due} ${due === 1 ? 'post is' : 'posts are'} due within a day; Instagram refuses them unless some age out first.`,
					job: ''
				});
			}
		}
		if (channelStatus?.error) {
			items.push({ level: 'warn', text: 'YouTube stats are not being read', detail: channelStatus.error, job: '' });
		}
		if (status && status.budget > 0 && status.unitsToday >= status.budget * 0.9) {
			items.push({
				level: 'warn',
				text: 'YouTube quota nearly used up',
				detail: `${whole.format(status.unitsToday)} of ${whole.format(status.budget)} units today; the stats pause at the budget.`,
				job: ''
			});
		}
		return items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
	});

	/* ---- coming up and latest ---- */

	let days = $derived(upcoming(brandTargets, now, 7));
	let releases = $derived(latestReleases(channelVideos, now, 5));

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

	let allowance = $derived(postAllowance(accounts.for('instagram')));
</script>

<header class="head">
	<div>
		<h1>Dashboard</h1>
		<p>
			{brands.current?.name ?? 'Everything'}{channel ? ` · YouTube: ${channel.name || channel.handle}` : ''}{loadedAt
				? ` · read ${loadedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
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
	<button class="btn sm" onclick={load} disabled={loading}>Refresh</button>
</header>

{#if error}
	<p class="banner bad">Could not reach PocketBase — {error}</p>
{/if}

<!-- The big numbers: what went out on YouTube in each period, and its views. -->
<section class="numbers" aria-label="Videos and views">
	{#each cards as card (card.key)}
		<article class="card stat">
			<h2>{card.label}</h2>
			{#if noChannel}
				<p class="none">No YouTube channel is connected for this brand.</p>
			{:else}
				<div class="pair">
					<div>
						<span class="big">{big(card.totals.released)}</span>
						<span class="unit">{card.totals.released === 1 ? 'video out' : 'videos out'}</span>
					</div>
					<div>
						<span class="big" title={whole.format(card.totals.viewsOnReleased)}>{big(card.totals.viewsOnReleased)}</span>
						<span class="unit">views on them</span>
					</div>
				</div>
				<p class="gained" title="Views every video flock watches on this channel gained since the start of the period — the newest 50 are read every poll{card.totals.gainedPartly ? '. Some were not watched yet at its start, so they count from when flock first saw them.' : '.'}">
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
		</article>
	{/each}
</section>

<div class="split">
	<section class="card attention" aria-label="Needs attention">
		<h2>Needs attention</h2>
		{#if attention.length === 0}
			<p class="clear">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
					<path d="m3.5 8.5 3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				All clear.
			</p>
		{:else}
			<ul>
				{#each attention as item, i (i)}
					<li class={item.level}>
						<span class="mark" aria-hidden="true"></span>
						<span class="what">
							{#if item.job}
								<a href="{base}/log/upload?job={encodeURIComponent(item.job)}">{item.text}</a>
							{:else}
								<strong>{item.text}</strong>
							{/if}
							{#if item.detail}<span class="detail" title={item.detail}>{item.detail}</span>{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card coming" aria-label="Coming up">
		<h2>Coming up</h2>
		<ol>
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
	</section>
</div>

<section class="card latest" aria-label="Latest releases">
	<h2>Latest releases</h2>
	{#if noChannel}
		<p class="none">No YouTube channel is connected for this brand.</p>
	{:else if releases.length === 0}
		<p class="none">{loading ? 'Loading…' : 'No public videos read yet.'}</p>
	{:else}
		<ul>
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
						<polyline points={sparkPath(release.points)} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
					</svg>
					{#if release.verdict}
						<span
							class="verdict {release.verdict}"
							title="The channel's videos usually had {whole.format(Math.round(release.usual ?? 0))} views {ago(release.age)} after release"
						>
							{VERDICT[release.verdict]}
						</span>
					{:else}
						<span class="verdict" title="Not enough videos watched from release to compare with">—</span>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="note">The line is each video's views over its first two days. "Usual" is the middle of the channel's other videos at the same age.</p>
	{/if}
</section>

<div class="split low">
	<section class="card system" aria-label="System">
		<h2>System</h2>
		<dl>
			<dt>Workers</dt>
			<dd>
				<span class="dots">
					{#each workers.view.dots as dot (dot.role)}
						<span class="dot {dot.state}" title={dot.title}></span>
					{/each}
				</span>
				{workers.view.lines.map((line) => line.text).join(' · ')}
			</dd>
			{#if status}
				<dt>YouTube</dt>
				<dd>
					{channelStatus?.polledAt ? `Stats read ${ago(now.getTime() - Date.parse(channelStatus.polledAt))} ago` : 'Stats not read yet'}
					· {whole.format(status.unitsToday)} of {whole.format(status.budget)} units today
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
	</section>

	<section class="card waiting" aria-label="Waiting to be used">
		<h2>Waiting</h2>
		<ul>
			<li>
				<span class="count">{projects.listed.length}</span>
				<span>{projects.listed.length === 1 ? 'project folder' : 'project folders'} not uploaded yet</span>
			</li>
			<li>
				<span class="count">{unused ?? '…'}</span>
				<span><a href="{base}/upload">{unused === 1 ? 'file' : 'files'} in the watch folders</a> no upload has used</span>
			</li>
			<li>
				<span class="count">{videoTodo.lines.length}</span>
				<span>{videoTodo.lines.length === 1 ? 'video' : 'videos'} on the To finish list</span>
			</li>
		</ul>
	</section>
</div>

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

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
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

	.card {
		padding: 18px 20px;
		min-width: 0;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
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

	.numbers {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin-bottom: 16px;
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.big {
		display: block;
		font-size: 44px;
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		background: var(--accent-grad);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.pair > div + div .big {
		background: none;
		color: var(--text);
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

	/* ---- attention and coming up ---- */

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 16px;
		margin-bottom: 16px;
	}

	.attention ul,
	.coming ol,
	.coming ul,
	.latest ul,
	.waiting ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.clear {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0;
		font-size: 13px;
		color: var(--ok);
	}

	.attention li {
		display: flex;
		gap: 10px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}

	.attention li:last-child {
		border-bottom: none;
	}

	.mark {
		flex: none;
		width: 8px;
		height: 8px;
		margin-top: 5px;
		border-radius: 50%;
		background: var(--warn);
	}

	.attention li.error .mark {
		background: var(--danger);
	}

	.what {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.what a,
	.what strong {
		color: var(--text);
		font-weight: 560;
		text-decoration: none;
	}

	.what a:hover {
		color: var(--pink-soft);
	}

	.detail {
		display: -webkit-box;
		margin-top: 2px;
		font-size: 12px;
		color: var(--text-dim);
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
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

	/* ---- latest releases ---- */

	.latest {
		margin-bottom: 16px;
	}

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

	/* ---- system and waiting ---- */

	.low {
		margin-bottom: 0;
	}

	.system dl {
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

	@media (max-width: 1100px) {
		.numbers {
			grid-template-columns: 1fr;
		}
		.split {
			grid-template-columns: 1fr;
		}
		.latest li {
			grid-template-columns: 64px minmax(0, 1fr) 70px;
		}
		.spark,
		.verdict {
			display: none;
		}
	}
</style>
