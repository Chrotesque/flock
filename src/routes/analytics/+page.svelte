<script lang="ts">
	import { onMount } from 'svelte';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import { PLATFORMS, isPlatformId } from '$lib/platforms';
	import {
		listJobs,
		listTargets,
		deleteJob,
		listVideoStats,
		getStatsStatus,
		subscribeStats
	} from '$lib/repo';
	import { formatBytes, formatDuration, relativeTo } from '$lib/format';
	import { KIND_LABELS, KIND_ORDER, kindOfVideo, type VideoKind } from '$lib/videokind';
	import { base } from '$app/paths';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { accountLabel } from '$lib/accounts';
	import type { StatsStatus, UploadJob, UploadTarget, VideoStats, YouTubeVideo } from '$lib/types';

	// The brand picks the channel shown, and names each upload's brand.
	brands.load();
	accounts.load();

	// The live half: the newest videos on the channel as the worker reads them.
	// Loaded once, then kept current by PocketBase realtime — the worker polls
	// YouTube, the browser polls nothing.
	let videos = $state<VideoStats[]>([]);
	let status = $state<StatsStatus | null>(null);
	let statsError = $state<string | null>(null);
	let open = $state<string | null>(null);
	// Which kinds are shown, any combination, and whether unlisted videos are
	// hidden. Both remembered per browser; localStorage is wrapped because
	// private windows and blocked site data throw rather than returning null.
	const KINDS_KEY = 'flock.analytics.kinds';
	const UNLISTED_KEY = 'flock.analytics.hideUnlisted';
	const PRIVATE_KEY = 'flock.analytics.hidePrivate';

	function remembered<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
		try {
			const raw = localStorage.getItem(key);
			return raw == null ? fallback : (parse(raw) ?? fallback);
		} catch {
			return fallback;
		}
	}

	let kinds = $state<Record<VideoKind, boolean>>(
		remembered(KINDS_KEY, { short: true, long: true, live: true, other: true }, (raw) => {
			const on: unknown = JSON.parse(raw);
			if (!Array.isArray(on)) return null;
			return Object.fromEntries(KIND_ORDER.map((k) => [k, on.includes(k)])) as Record<
				VideoKind,
				boolean
			>;
		})
	);
	let hideUnlisted = $state(
		remembered(UNLISTED_KEY, true, (raw) => (raw === '1' ? true : raw === '0' ? false : null))
	);
	// On by default, which also hides a scheduled upload until its slot: it is
	// private until then. The count beside the box is what says it is there.
	let hidePrivate = $state(
		remembered(PRIVATE_KEY, true, (raw) => (raw === '1' ? true : raw === '0' ? false : null))
	);

	$effect(() => {
		const on = KIND_ORDER.filter((k) => kinds[k]);
		try {
			localStorage.setItem(KINDS_KEY, JSON.stringify(on));
		} catch {
			// The choice just will not survive a reload.
		}
	});
	$effect(() => {
		try {
			localStorage.setItem(UNLISTED_KEY, hideUnlisted ? '1' : '0');
		} catch {
			// As above.
		}
	});
	$effect(() => {
		try {
			localStorage.setItem(PRIVATE_KEY, hidePrivate ? '1' : '0');
		} catch {
			// As above.
		}
	});

	// The counters as they stood when the page was opened (or last refreshed),
	// so a row that moves since can show how far. Reset by Refresh.
	type Counters = { views: number | null; likes: number | null; comments: number | null };
	let baseline = $state<Record<string, Counters>>({});

	function counters(row: VideoStats): Counters {
		return { views: row.views, likes: row.likes, comments: row.comments };
	}

	function delta(row: VideoStats, key: keyof Counters): number {
		const before = baseline[row.id]?.[key];
		const after = row[key];
		return before == null || after == null ? 0 : after - before;
	}
	// Ticks once a second so "12 s ago" keeps counting between events.
	let now = $state(Date.now());

	// The NAS half: what is stored, which is also how you check an upload landed.
	let jobs = $state<UploadJob[]>([]);
	let targets = $state<UploadTarget[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state<string | null>(null);

	/**
	 * One channel at a time: the one the brand in view uploads to. YouTube's
	 * rules forbid adding up figures across channels, so videos of several
	 * channels are never listed (or totalled) together — with more than one
	 * channel and none chosen, nothing is shown until one is. A row's channel
	 * is in YouTube's own item for it.
	 */
	const channel = $derived(accounts.for('youtube'));
	const channelCount = $derived(accounts.forPlatform('youtube').length);
	const unscoped = $derived(!channel && !brands.multiple && channelCount <= 1);
	const channelVideos = $derived(
		channel
			? videos.filter((row) => row.data?.snippet?.channelId === channel.account_id)
			: unscoped
				? videos
				: []
	);
	// The heartbeat for that channel: its own read, the pass's quota and errors.
	const beat = $derived.by(() => {
		if (!status) return null;
		const own = channel ? status.channels?.[channel.account_id] : undefined;
		return {
			...status,
			polledAt: own?.polledAt ?? status.polledAt,
			videos: own?.videos ?? status.videos,
			error: own?.error || status.error
		};
	});

	const sorted = $derived(
		[...channelVideos].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
	);
	// Counts beside the kind boxes respect the unlisted toggle, so they add up
	// to what the total row shows.
	const listed = $derived(
		sorted.filter(
			(row) =>
				!(hideUnlisted && row.privacy === 'unlisted') &&
				!(hidePrivate && row.privacy === 'private')
		)
	);
	const unlistedCount = $derived(sorted.filter((row) => row.privacy === 'unlisted').length);
	const privateCount = $derived(sorted.filter((row) => row.privacy === 'private').length);
	const counts = $derived.by(() => {
		const tally: Record<VideoKind, number> = { short: 0, long: 0, live: 0, other: 0 };
		for (const row of listed) tally[kindOfVideo(row)] += 1;
		return tally;
	});
	const shown = $derived(listed.filter((row) => kinds[kindOfVideo(row)]));
	const totals = $derived.by(() => {
		const sum = { views: 0, likes: 0, comments: 0, dViews: 0, dLikes: 0, dComments: 0 };
		for (const row of shown) {
			sum.views += row.views ?? 0;
			sum.likes += row.likes ?? 0;
			sum.comments += row.comments ?? 0;
			sum.dViews += delta(row, 'views');
			sum.dLikes += delta(row, 'likes');
			sum.dComments += delta(row, 'comments');
		}
		return sum;
	});

	async function load() {
		loading = true;
		error = null;
		try {
			[jobs, targets] = await Promise.all([listJobs(), listTargets()]);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	async function loadStats() {
		statsError = null;
		try {
			[videos, status] = await Promise.all([listVideoStats(), getStatsStatus()]);
			baseline = Object.fromEntries(videos.map((row) => [row.id, counters(row)]));
		} catch (err) {
			statsError = err instanceof Error ? err.message : String(err);
		}
	}

	$effect(() => {
		void load();
		void loadStats();
	});

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 1000);
		const unsubscribe = subscribeStats({
			onVideo: (row, action) => {
				if (action === 'delete') {
					videos = videos.filter((v) => v.id !== row.id);
					return;
				}
				const known = videos.some((v) => v.id === row.id);
				videos = known ? videos.map((v) => (v.id === row.id ? row : v)) : [...videos, row];
				// A video first seen now has nothing to be measured against yet.
				if (!known) baseline = { ...baseline, [row.id]: counters(row) };
			},
			onStatus: (next) => (status = next)
		});
		return () => {
			clearInterval(clock);
			unsubscribe();
		};
	});

	function targetsOf(jobId: string): UploadTarget[] {
		return targets.filter((t) => t.job === jobId);
	}

	function whenOf(target: UploadTarget): { date: string; time: string } {
		const d = new Date(target.scheduled_at);
		if (Number.isNaN(d.getTime())) return { date: '', time: '' };
		const pad = (n: number) => String(n).padStart(2, '0');
		return {
			date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
			time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
		};
	}

	async function remove(job: UploadJob) {
		busy = job.id;
		try {
			await deleteJob(job.id);
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = null;
		}
	}

	function ago(iso: string | undefined): string {
		if (!iso) return 'never';
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return 'never';
		const s = Math.max(0, Math.round((now - t) / 1000));
		if (s < 60) return `${s} s ago`;
		const m = Math.round(s / 60);
		if (m < 60) return `${m} min ago`;
		const h = Math.round(m / 60);
		if (h < 48) return `${h} h ago`;
		const d = Math.round(h / 24);
		if (d < 90) return `${d} d ago`;
		if (d < 730) return `${Math.round(d / 30)} mo ago`;
		return `${Math.round(d / 365)} y ago`;
	}

	function num(n: number | null | undefined): string {
		return n == null ? '—' : n.toLocaleString();
	}

	function thumb(row: VideoStats): string {
		const t = row.data?.snippet?.thumbnails ?? {};
		return t.medium?.url ?? t.default?.url ?? t.high?.url ?? '';
	}

	/** Whether this video went out through flock — its target holds the watch URL. */
	function viaFlock(row: VideoStats): boolean {
		return targets.some((t) => (t.remote_url ?? '').includes(row.video_id));
	}

	type Fact = [string, string];
	interface FactGroup {
		title: string;
		rows: Fact[];
	}

	const CATEGORIES: Record<string, string> = {
		'1': 'Film & Animation',
		'2': 'Autos & Vehicles',
		'10': 'Music',
		'15': 'Pets & Animals',
		'17': 'Sports',
		'19': 'Travel & Events',
		'20': 'Gaming',
		'22': 'People & Blogs',
		'23': 'Comedy',
		'24': 'Entertainment',
		'25': 'News & Politics',
		'26': 'Howto & Style',
		'27': 'Education',
		'28': 'Science & Technology',
		'29': 'Nonprofits & Activism'
	};

	function pairs(list: [string, string | undefined | null][]): Fact[] {
		return list.filter((p): p is Fact => p[1] != null && p[1] !== '');
	}

	function yes(v: boolean | undefined): string | undefined {
		return v === undefined ? undefined : v ? 'yes' : 'no';
	}

	function when(iso: string | undefined): string | undefined {
		return iso ? new Date(iso).toLocaleString() : undefined;
	}

	function mbps(bps: string | undefined): string | undefined {
		return bps ? `${(Number(bps) / 1e6).toFixed(1)} Mbit/s` : undefined;
	}

	/** Everything the API returned, grouped for reading. Empty fields are dropped. */
	function facts(row: VideoStats): FactGroup[] {
		const d = row.data ?? ({} as YouTubeVideo);
		const s = d.snippet ?? {};
		const st = d.status ?? {};
		const c = d.contentDetails ?? {};
		const stats = d.statistics ?? {};
		const f = d.fileDetails;
		const p = d.processingDetails;
		const sg = d.suggestions;
		const video = f?.videoStreams?.[0];
		const audio = f?.audioStreams?.[0];
		const last = row.history?.[row.history.length - 1];

		const groups: FactGroup[] = [
			{
				title: 'Listing',
				rows: pairs([
					['Published', when(s.publishedAt)],
					['Goes public', when(st.publishAt)],
					['Privacy', st.privacyStatus],
					['Upload status', st.uploadStatus],
					['Category', s.categoryId ? (CATEGORIES[s.categoryId] ?? s.categoryId) : undefined],
					['Tags', s.tags?.length ? `${s.tags.length} — ${s.tags.join(', ')}` : 'none'],
					[
						'Topics',
						d.topicDetails?.topicCategories
							?.map((u) => decodeURIComponent(u.split('/').pop() ?? '').replace(/_/g, ' '))
							.join(', ')
					],
					['Language', s.defaultLanguage],
					['Audio language', s.defaultAudioLanguage],
					['License', st.license],
					['Embeddable', yes(st.embeddable)],
					['Public stats', yes(st.publicStatsViewable)],
					['Made for kids', yes(st.madeForKids)],
					['Synthetic media', yes(st.containsSyntheticMedia)],
					['Paid promotion', yes(d.paidProductPlacementDetails?.hasPaidProductPlacement)],
					['Live', s.liveBroadcastContent !== 'none' ? s.liveBroadcastContent : undefined]
				])
			},
			{
				title: 'Counters',
				rows: pairs([
					['Views', stats.viewCount != null ? Number(stats.viewCount).toLocaleString() : undefined],
					['Likes', stats.likeCount != null ? Number(stats.likeCount).toLocaleString() : 'hidden'],
					[
						'Comments',
						stats.commentCount != null ? Number(stats.commentCount).toLocaleString() : 'off'
					],
					['Favourites', stats.favoriteCount],
					['Samples kept', String(row.history?.length ?? 0)],
					['Last movement', last ? ago(last[0]) : undefined],
					['Last changed', ago(row.fetched_at)]
				])
			},
			{
				title: 'Media',
				rows: pairs([
					['Duration', formatDuration(row.duration)],
					['Definition', c.definition],
					['Dimension', c.dimension],
					['Captions', c.caption],
					['Licensed content', yes(c.licensedContent)],
					['Projection', c.projection],
					['File', f?.fileName],
					['Size', f?.fileSize ? formatBytes(Number(f.fileSize)) : undefined],
					['Container', f?.container],
					[
						'Video stream',
						video
							? [
									video.widthPixels && video.heightPixels
										? `${video.widthPixels}×${video.heightPixels}`
										: '',
									video.frameRateFps ? `${video.frameRateFps} fps` : '',
									video.codec,
									mbps(video.bitrateBps)
								]
									.filter(Boolean)
									.join(' · ')
							: undefined
					],
					[
						'Audio stream',
						audio
							? [
									audio.codec,
									audio.channelCount ? `${audio.channelCount} ch` : '',
									audio.bitrateBps ? `${Math.round(Number(audio.bitrateBps) / 1000)} kbit/s` : ''
								]
									.filter(Boolean)
									.join(' · ')
							: undefined
					]
				])
			},
			{
				title: 'Processing',
				rows: pairs([
					['Status', p?.processingStatus],
					[
						'Progress',
						p?.processingProgress?.partsTotal
							? `${p.processingProgress.partsProcessed ?? 0} of ${p.processingProgress.partsTotal}`
							: undefined
					],
					['Failure', p?.processingFailureReason],
					['Errors', sg?.processingErrors?.join(', ')],
					['Warnings', sg?.processingWarnings?.join(', ')],
					['Hints', sg?.processingHints?.join(', ')],
					['Suggested tags', sg?.tagSuggestions?.map((t) => t.tag).join(', ')],
					['Editor suggestions', sg?.editorSuggestions?.join(', ')]
				])
			},
			{
				title: 'Live stream',
				rows: pairs(Object.entries(d.liveStreamingDetails ?? {}).map(([k, v]) => [k, String(v)]))
			}
		];
		return groups.filter((g) => g.rows.length > 0);
	}
</script>

{#snippet counter(value: number | null, change: number)}
	<span class="cell num" class:up={change > 0} class:down={change < 0}>
		{num(value)}{#if change}<span class="delta"
				>({change > 0 ? '+' : ''}{change.toLocaleString()})</span
			>{/if}
	</span>
{/snippet}

<div class="page">
	<header class="head">
		<div>
			<h1>Analytics</h1>
			<p>
				The newest videos on {channel ? channel.name || accountLabel(channel) : 'the channel'}, as
				YouTube reports them. The worker reads them every {status?.intervalSeconds ?? 30} seconds;
				this page updates as it writes, and a counter that has moved since you opened it turns green
				with the change.
			</p>
			{#if brands.multiple}
				<!-- The same choice as on the upload screen and in Settings. -->
				<div class="brands" role="radiogroup" aria-labelledby="analyticsbrand">
					<span class="brandlabel" id="analyticsbrand">Brand</span>
					{#each brands.ordered as brand (brand.id)}
						<button
							class="brandchip"
							class:on={brand.id === brands.currentId}
							role="radio"
							aria-checked={brand.id === brands.currentId}
							onclick={() => brands.select(brand.id)}
						>
							{brand.name}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<button
			class="btn sm"
			title="Reload, and reset the change markers"
			onclick={() => {
				void load();
				void loadStats();
			}}
			disabled={loading}>Refresh</button
		>
	</header>

	<div class="livehead">
		<h3 class="section">Live from YouTube</h3>
		<!-- Only for a channel in view: another channel's read would mislead. -->
		{#if channel || unscoped}
			<p class="beat" class:bad={Boolean(beat?.error)}>
				{#if beat?.error}
					{beat.error}
				{:else if beat}
					{channel ? `${channel.name || accountLabel(channel)} · ` : ''}Read {ago(beat.polledAt)} ·
					{beat.videos} videos · {num(beat.unitsToday)} of {num(beat.budget)} units today
				{:else}
					The worker has not read the channel yet.
				{/if}
			</p>
		{/if}
	</div>

	{#if statsError}
		<p class="banner error">{statsError}</p>
	{:else if !channel && !unscoped && accounts.loaded}
		<p class="banner">
			{brands.multiple ? `${brands.current?.name ?? 'This brand'} has` : 'There is'} no YouTube channel
			chosen, so there is nothing to show.
			<a href="{base}/settings?section=brands">Choose one in Settings → Brands</a>.
		</p>
	{:else if sorted.length === 0}
		<p class="banner">
			No videos yet. Run the worker (<code>pnpm worker</code>): the newest fifty videos on the
			channel appear here and refresh every 30 seconds.
		</p>
	{:else}
		<div class="live">
			<nav class="kinds" aria-label="Which videos to show">
				{#each KIND_ORDER as k (k)}
					{#if k !== 'other' || counts.other > 0}
						<label class="kind" class:active={kinds[k]}>
							<input type="checkbox" bind:checked={kinds[k]} />
							<span class="name">{KIND_LABELS[k]}</span>
							<span class="count">{counts[k]}</span>
						</label>
					{/if}
				{/each}
				<label class="kind toggle" class:active={hideUnlisted}>
					<input type="checkbox" bind:checked={hideUnlisted} />
					<span class="name">Hide unlisted</span>
					<span class="count">{unlistedCount}</span>
				</label>
				<label class="kind toggle" class:active={hidePrivate}>
					<input type="checkbox" bind:checked={hidePrivate} />
					<span class="name">Hide private</span>
					<span class="count">{privateCount}</span>
				</label>
				<p class="rule">Shorts are under three minutes. Long form is over, and not live.</p>
			</nav>

			<div class="table card">
				<div class="row cols" class:noprivacy={hideUnlisted}>
					<span></span>
					<span>Video</span>
					<span>Published</span>
					<span class="num">Length</span>
					<span class="num">Views</span>
					<span class="num">Likes</span>
					<span class="num">Comments</span>
					{#if !hideUnlisted}<span></span>{/if}
				</div>
				<div class="row total" class:noprivacy={hideUnlisted}>
					<span></span>
					<span class="vid">
						<span class="vtitle">Total</span>
						<span class="vmeta">{shown.length} {shown.length === 1 ? 'video' : 'videos'}</span>
					</span>
					<span></span>
					<span></span>
					{@render counter(totals.views, totals.dViews)}
					{@render counter(totals.likes, totals.dLikes)}
					{@render counter(totals.comments, totals.dComments)}
					{#if !hideUnlisted}<span></span>{/if}
				</div>
				{#each shown as row (row.id)}
					{@const dViews = delta(row, 'views')}
					{@const dLikes = delta(row, 'likes')}
					{@const dComments = delta(row, 'comments')}
					<button
						class="row"
						class:open={open === row.id}
						class:noprivacy={hideUnlisted}
						onclick={() => (open = open === row.id ? null : row.id)}
					>
						{#if thumb(row)}
							<img class="thumb" src={thumb(row)} alt="" loading="lazy" />
						{:else}
							<span class="thumb"></span>
						{/if}
						<span class="vid">
							<span class="vtitle">{row.title || '(untitled)'}</span>
							<span class="vmeta">
								{row.video_id}
								{#if viaFlock(row)}<span class="dot">·</span><span class="via">flock</span>{/if}
								{#if hideUnlisted && row.privacy && row.privacy !== 'public'}
									<span class="dot">·</span><span class="priv {row.privacy}">{row.privacy}</span>
								{/if}
								<span class="dot">·</span>changed {ago(row.fetched_at)}
							</span>
						</span>
						<span class="cell">{ago(row.published_at)}</span>
						<span class="cell num">{formatDuration(row.duration)}</span>
						{@render counter(row.views, dViews)}
						{@render counter(row.likes, dLikes)}
						{@render counter(row.comments, dComments)}
						{#if !hideUnlisted}
							<span class="pill privacy {row.privacy}">{row.privacy || '?'}</span>
						{/if}
					</button>
					{#if open === row.id}
						<div class="details">
							{#each facts(row) as group (group.title)}
								<section class="group">
									<h4>{group.title}</h4>
									<dl>
										{#each group.rows as [label, value] (label)}
											<dt>{label}</dt>
											<dd>{value}</dd>
										{/each}
									</dl>
								</section>
							{/each}
							<details class="raw">
								<summary>Everything the API returned</summary>
								<pre>{JSON.stringify(row.data, null, 2)}</pre>
							</details>
						</div>
					{/if}
				{/each}
				{#if shown.length === 0}
					<p class="empty">Nothing to show with these boxes ticked.</p>
				{/if}
			</div>
		</div>
	{/if}

	<h3 class="section">On the NAS</h3>

	{#if error}
		<p class="banner error">{error}</p>
	{:else if loading}
		<p class="banner">Loading…</p>
	{:else if jobs.length === 0}
		<p class="banner">
			No uploads stored yet. Anything you confirm on the Upload screen shows up here.
		</p>
	{:else}
		<ul class="jobs">
			{#each jobs as job (job.id)}
				<li class="card">
					<div class="jobhead">
						<div class="ident">
							<p class="title">{job.title || '(untitled)'}</p>
							<p class="meta">
								{#if brands.multiple && (job.brand || job.brand_name)}
									<!-- Current name while the brand exists; the snapshot once deleted. -->
									<span class="brand">{brands.byId(job.brand ?? '')?.name ?? job.brand_name}</span><span
										class="dot">·</span
									>
								{/if}
								{job.video_name || 'no file'}
								{#if job.video_size}
									<span class="dot">·</span>{formatBytes(job.video_size)}
								{/if}
								{#if job.video_duration}
									<span class="dot">·</span>{formatDuration(job.video_duration)}
								{/if}
							</p>
						</div>
						<span class="pill status {job.status}">{job.status}</span>
						<button
							class="del"
							onclick={() => remove(job)}
							disabled={busy === job.id}
							aria-label="Delete this upload"
						>
							<svg viewBox="0 0 16 16" width="13" height="13"
								><path
									d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
									fill="none"
									stroke="currentColor"
									stroke-width="1.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</button>
					</div>

					<ul class="targets">
						{#each targetsOf(job.id) as target (target.id)}
							{@const when = whenOf(target)}
							<li>
								{#if isPlatformId(target.platform)}
									<PlatformIcon platform={target.platform} size={15} />
									<span class="who">{PLATFORMS[target.platform].label}</span>
								{:else}
									<span class="who">{target.platform}</span>
								{/if}
								<span class="ttitle">{target.title || '(no title)'}</span>
								<span class="when">{relativeTo(when.date, when.time)}</span>
								<span class="tstatus {target.status}">{target.status}</span>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
	}

	.brandlabel {
		margin-right: 4px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
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

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.section {
		margin: 30px 0 12px;
		font-size: 14px;
	}

	.livehead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	.livehead .section {
		margin: 0 0 12px;
	}

	.beat {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.beat.bad {
		color: var(--danger);
	}

	.banner {
		margin: 0;
		padding: 13px 15px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.error {
		border-color: rgba(248, 113, 113, 0.4);
		color: var(--danger);
	}

	.banner code {
		font-family: var(--mono);
		font-size: 11.5px;
	}

	/* ---- the live table ---- */

	.live {
		display: grid;
		grid-template-columns: 148px minmax(0, 1fr);
		gap: 14px;
		align-items: start;
	}

	.kinds {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.kind {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 9px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		font-weight: 570;
		text-align: left;
		cursor: pointer;
		user-select: none;
	}

	.kind input {
		flex: none;
		width: 14px;
		height: 14px;
		margin: 0;
		accent-color: var(--pink);
		cursor: pointer;
	}

	.kind .name {
		flex: 1;
	}

	.kind.toggle {
		margin-top: 10px;
	}

	.kind.toggle + .kind.toggle {
		margin-top: 0;
	}

	.kind:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}

	.kind.active {
		border-color: var(--pink);
		background: rgba(255, 77, 158, 0.12);
		color: var(--text);
	}

	.count {
		font-size: 11px;
		font-weight: 650;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.kind.active .count {
		color: var(--pink-soft);
	}

	.rule {
		margin: 4px 2px 0;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.empty {
		margin: 0;
		padding: 16px 14px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-faint);
	}

	.table {
		overflow: hidden;
	}

	.row {
		display: grid;
		grid-template-columns: 72px minmax(0, 1fr) 68px 56px 96px 80px 96px 74px;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 14px;
		text-align: left;
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		border-top: 1px solid var(--border);
		cursor: pointer;
	}

	.row.noprivacy {
		grid-template-columns: 72px minmax(0, 1fr) 68px 56px 96px 80px 96px;
	}

	.row.total {
		cursor: default;
		background: var(--surface-2);
	}

	.row.total .cell {
		color: var(--text);
		font-weight: 600;
	}

	.row.cols {
		padding: 10px 14px;
		border-top: 0;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
		cursor: default;
	}

	.row:not(.cols):not(.total):hover,
	.row.open {
		background: var(--surface-2);
	}

	.thumb {
		display: block;
		width: 72px;
		height: 40px;
		object-fit: cover;
		border-radius: 6px;
		background: var(--surface-3);
	}

	.vid {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 2px;
	}

	.vtitle {
		font-size: 13px;
		font-weight: 570;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vmeta {
		font-size: 11px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.via {
		color: var(--pink-soft);
		font-weight: 650;
	}

	.priv {
		text-transform: capitalize;
	}

	.priv.private {
		color: var(--danger);
	}

	.cell {
		font-size: 12.5px;
		color: var(--text-dim);
		white-space: nowrap;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.cell.up {
		color: var(--ok);
		font-weight: 600;
	}

	.cell.down {
		color: var(--danger);
	}

	.delta {
		margin-left: 4px;
		font-size: 11px;
		font-weight: 600;
		opacity: 0.9;
	}

	.privacy {
		justify-self: end;
		text-transform: capitalize;
	}

	.privacy.public {
		background: rgba(52, 211, 153, 0.15);
		color: var(--ok);
	}

	.privacy.unlisted {
		background: rgba(168, 85, 247, 0.16);
		color: #cfa8fb;
	}

	.privacy.private {
		background: rgba(248, 113, 113, 0.15);
		color: var(--danger);
	}

	.details {
		padding: 6px 14px 16px 98px;
		border-top: 1px dashed var(--border);
		background: var(--surface-2);
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 14px 28px;
	}

	.group h4 {
		margin: 10px 0 6px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.group dl {
		margin: 0;
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 4px 12px;
		font-size: 12px;
	}

	.group dt {
		color: var(--text-dim);
		white-space: nowrap;
	}

	.group dd {
		margin: 0;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.raw {
		grid-column: 1 / -1;
		font-size: 12px;
		color: var(--text-dim);
	}

	.raw summary {
		cursor: pointer;
	}

	.raw pre {
		margin: 8px 0 0;
		padding: 12px;
		max-height: 420px;
		overflow: auto;
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.45;
	}

	/* ---- the NAS list ---- */

	.jobs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}

	.jobs > li {
		padding: 14px 16px;
	}

	.jobhead {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.ident {
		flex: 1;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 13.5px;
		font-weight: 570;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.dot {
		margin: 0 6px;
		opacity: 0.5;
	}

	.meta .brand {
		font-weight: 620;
		color: var(--text-dim);
	}

	.status {
		flex: none;
		text-transform: capitalize;
	}

	.status.stored {
		background: rgba(52, 211, 153, 0.15);
		color: var(--ok);
	}

	.status.done {
		background: rgba(168, 85, 247, 0.16);
		color: #cfa8fb;
	}

	.status.failed {
		background: rgba(248, 113, 113, 0.15);
		color: var(--danger);
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
	}

	.del:hover:not(:disabled) {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.targets {
		list-style: none;
		margin: 12px 0 0;
		padding: 12px 0 0;
		border-top: 1px solid var(--border);
		display: grid;
		gap: 7px;
	}

	.targets li {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12px;
	}

	.who {
		flex: none;
		width: 74px;
		color: var(--text-dim);
	}

	.ttitle {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}

	.when {
		flex: none;
		font-size: 11px;
		color: var(--text-faint);
	}

	.tstatus {
		flex: none;
		width: 66px;
		text-align: right;
		font-size: 10.5px;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}

	.tstatus.published {
		color: var(--ok);
	}

	.tstatus.failed {
		color: var(--danger);
	}

	@media (max-width: 900px) {
		.live {
			grid-template-columns: 1fr;
		}
		.kinds {
			flex-direction: row;
			flex-wrap: wrap;
		}
		.rule {
			flex-basis: 100%;
		}
		.row {
			grid-template-columns: 56px minmax(0, 1fr) 100px 72px;
		}
		.row.noprivacy {
			grid-template-columns: 56px minmax(0, 1fr) 100px;
		}
		.row > :nth-child(3),
		.row > :nth-child(4),
		.row > :nth-child(6),
		.row > :nth-child(7) {
			display: none;
		}
		.details {
			padding-left: 14px;
		}
		.thumb {
			width: 56px;
			height: 32px;
		}
		.who {
			width: auto;
		}
	}
</style>
