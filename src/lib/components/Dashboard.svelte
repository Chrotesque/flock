<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import PlatformIcon from './PlatformIcon.svelte';
	import DashFilter from './DashFilter.svelte';
	import ViewsCurve from './ViewsCurve.svelte';
	import ComingUp from './ComingUp.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dashData } from '$lib/stores/dashdata.svelte';
	import { devtestDashboardScopes } from '$lib/devtest';
	import { general } from '$lib/stores/general.svelte';
	import { jestrCampaigns } from '$lib/stores/jestrcampaigns.svelte';
	import { flaggedPosts, isCampaign, type CampaignPosts } from '$lib/jestrcampaign';
	import { accountLabel, postAllowance } from '$lib/accounts';
	import { PLATFORMS, isPlatformId } from '$lib/platforms';
	import {
		deleteJob,
		listJobs,
		listTargets,
		loadVideoStat,
		subscribeReels,
		subscribeStats,
		subscribeTargets,
		toDashboardVideo
	} from '$lib/repo';
	import { formatBytes, formatDuration } from '$lib/format';
	import { KIND_LABELS } from '$lib/videokind';
	import { reelFacts, youtubeFacts, type FactGroup } from '$lib/videofacts';
	import type { PlatformId, UploadJob, UploadTarget, VideoStats } from '$lib/types';
	import {
		ALL_PLATFORMS,
		PLATFORM_COLOURS,
		buildReleases,
		curve,
		filterCounts,
		inView,
		isCombined,
		isStatPlatform,
		judge,
		peerGroups,
		periodStats,
		ratioOf,
		readFilter,
		sortRows,
		storedFilter,
		sumOf,
		visibilityOf,
		type Counter,
		type Curve,
		type DashFilter as Filter,
		type Judgement,
		type Post,
		type Release,
		type SortKey,
		type StatPlatform
	} from '$lib/releases';

	/**
	 * The dashboard: every video and the numbers around them, opened over
	 * the content area (DashboardOverlay). One element says what is looked at
	 * (platforms — all of them is the combined view — kinds and visibility);
	 * the period numbers and the list of every video follow it. Each video
	 * carries its curve from release and how it stands against the usual for
	 * its kind. The brand in view picks the channel, the Instagram account and
	 * the Facebook Page, one of each — never added up across channels
	 * (YouTube's rule). The
	 * arithmetic is releases.ts; the data `dashData`, kept between openings.
	 */

	brands.load();
	accounts.load();

	/* ---- per-browser choices ---- */

	const FILTER_KEY = 'flock.dashboard.filter';
	const SORT_KEY = 'flock.dashboard.sort';

	function readPref(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}

	function writePref(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Private window or blocked storage: the choice lasts the visit.
		}
	}

	function parsed(raw: string | null): unknown {
		try {
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	const SORTS: SortKey[] = ['date', 'views', 'likes', 'comments', 'usual'];
	let filter = $state<Filter>(readFilter(parsed(readPref(FILTER_KEY))));
	let sort = $state<SortKey>(SORTS.find((s) => s === readPref(SORT_KEY)) ?? 'date');
	$effect(() => writePref(FILTER_KEY, JSON.stringify(storedFilter(filter))));
	$effect(() => writePref(SORT_KEY, sort));

	/* ---- the data ---- */

	let now = $state(Date.now());
	const videos = $derived(dashData.videos);
	const reels = $derived(dashData.reels);
	const igReels = $derived(reels.filter((r) => r.platform === 'instagram'));
	const fbReels = $derived(reels.filter((r) => r.platform === 'facebook'));
	const status = $derived(dashData.status);
	const igStatus = $derived(dashData.igStatus);
	const fbStatus = $derived(dashData.fbStatus);
	const loaded = $derived(dashData.loaded);
	const loading = $derived(dashData.loading);
	const error = $derived(dashData.error);

	/* The counters as they stood when the dashboard was opened (or Refresh was
	 * pressed), so a row that moves since shows by how much. Taken once this
	 * opening's first read is in, not from the numbers kept from last time. */
	type Counters = Record<Counter, number | null>;
	let baseline = $state<Record<string, Counters>>({});
	let based = false;
	const baseKey = (post: Post) => `${post.platform}:${post.record}`;
	const countersOf = (row: { views: number | null; likes: number | null; comments: number | null }): Counters => ({
		views: row.views,
		likes: row.likes,
		comments: row.comments
	});

	function rebase() {
		baseline = Object.fromEntries([
			...dashData.videos.map((v) => [`youtube:${v.id}`, countersOf(v)]),
			...dashData.reels.map((r) => [`${r.platform}:${r.id}`, countersOf(r)])
		]);
		based = true;
	}

	/** A row first seen now has nothing to be measured against yet. */
	function baseIfNew(key: string, row: { views: number | null; likes: number | null; comments: number | null }) {
		if (based && !baseline[key]) baseline = { ...baseline, [key]: countersOf(row) };
	}

	async function load(reset = false) {
		await dashData.refresh();
		if (reset || !based) rebase();
		now = Date.now();
	}

	let targetTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		void load();
		const clock = setInterval(() => (now = Date.now()), 30_000);
		const timer = setInterval(() => void load(), 120_000);
		const onFocus = () => void load();
		window.addEventListener('focus', onFocus);
		// The counters as the worker writes them.
		const stopStats = subscribeStats({
			onVideo: (row, action) => {
				const video = toDashboardVideo(row);
				dashData.putVideo(video, action);
				if (action !== 'delete') baseIfNew(`youtube:${video.id}`, video);
			},
			onStatus: (next) => (dashData.status = next)
		});
		void jestrCampaigns.load().catch(() => {});
		const stopMarks = jestrCampaigns.subscribe();
		const stopReels = subscribeReels((reel, action) => {
			dashData.putReel(reel, action);
			if (action !== 'delete') baseIfNew(`${reel.platform}:${reel.id}`, reel);
		});
		// Posts change in bursts (a confirm writes several): read them once it settles.
		const stopTargets = subscribeTargets(() => {
			clearTimeout(targetTimer);
			targetTimer = setTimeout(() => void dashData.refreshTargets(), 600);
		});
		return () => {
			clearInterval(clock);
			clearInterval(timer);
			clearTimeout(targetTimer);
			window.removeEventListener('focus', onFocus);
			stopStats();
			stopMarks();
			stopReels();
			stopTargets();
		};
	});

	/* ---- the brand in view: one channel, one Instagram account, one Facebook Page ---- */

	const channel = $derived(accounts.for('youtube'));
	const igAccount = $derived(accounts.for('instagram'));
	const fbPage = $derived(accounts.for('facebook'));
	// One brand and at most one account: nothing to choose between, so all of it.
	const loneYT = $derived(!channel && !brands.multiple && accounts.forPlatform('youtube').length <= 1);
	const loneIG = $derived(!igAccount && !brands.multiple && accounts.forPlatform('instagram').length <= 1);
	const loneFB = $derived(!fbPage && !brands.multiple && accounts.forPlatform('facebook').length <= 1);
	const myVideos = $derived(
		channel ? videos.filter((v) => v.channelId === channel.account_id) : loneYT ? videos : []
	);
	const myReels = $derived(igAccount ? igReels.filter((r) => r.account === igAccount.account_id) : loneIG ? igReels : []);
	const myFbReels = $derived(fbPage ? fbReels.filter((r) => r.account === fbPage.account_id) : loneFB ? fbReels : []);
	const myTargets = $derived(
		brands.multiple ? dashData.targets.filter((t) => t.brand === brands.currentId) : dashData.targets
	);
	// A local module's scope (devtest.ts) replaces the brand in view while chosen.
	const scope = $derived(devtestDashboardScopes.find((s) => s.active()));
	const sets = $derived(
		scope
			? scope.groups().map((g) => ({
					label: g.label,
					colour: g.colour,
					videos: g.channel ? videos.filter((v) => v.channelId === g.channel) : [],
					reels: g.instagram ? igReels.filter((r) => r.account === g.instagram) : [],
					fbReels: g.facebook ? fbReels.filter((r) => r.account === g.facebook) : [],
					posts: dashData.targets.filter((t) => t.brand === g.brand)
				}))
			: [{ label: '', colour: undefined, videos: myVideos, reels: myReels, fbReels: myFbReels, posts: myTargets }]
	);
	const postsInView = $derived(sets.flatMap((set) => set.posts));
	const noChannel = $derived(!scope && accounts.loaded && !channel && !loneYT);

	// Each set's videos and reels pair only among themselves.
	const releases = $derived(
		sets.flatMap((set) =>
			buildReleases(set.videos, set.reels, set.posts, set.fbReels).map((r) =>
				sets.length > 1 ? { ...r, group: set.label, tint: set.colour } : r
			)
		)
	);
	const groups = $derived(peerGroups(releases));
	const counts = $derived(filterCounts(releases, filter));
	const inViewList = $derived(releases.filter((r) => inView(r, filter)));
	const combined = $derived(isCombined(filter));
	const multi = $derived(filter.platforms.length > 1);

	/* ---- the list ---- */

	interface Row {
		release: Release;
		posts: Post[];
		views: number | null;
		likes: number | null;
		comments: number | null;
		delta: Record<Counter, number>;
		judgements: Judgement[];
		ratio: number | null;
		curves: Curve[];
	}

	function deltaOf(posts: Post[], counter: Counter): number {
		let sum = 0;
		for (const post of posts) {
			const before = baseline[baseKey(post)]?.[counter];
			const after = post[counter];
			if (before != null && after != null) sum += after - before;
		}
		return sum;
	}

	const rows = $derived.by(() => {
		const list: Row[] = inViewList.map((release) => {
			const posts = filter.platforms.map((p) => release.posts[p]).filter((p): p is Post => Boolean(p));
			const peersOf = (post: Post) => groups.get(`${post.platform}:${release.kind}`) ?? [];
			const judgements = posts.map((post) => judge(post, peersOf(post), now));
			return {
				release,
				posts,
				views: sumOf(release, filter.platforms, 'views'),
				likes: sumOf(release, filter.platforms, 'likes'),
				comments: sumOf(release, filter.platforms, 'comments'),
				delta: { views: deltaOf(posts, 'views'), likes: deltaOf(posts, 'likes'), comments: deltaOf(posts, 'comments') },
				judgements,
				ratio: ratioOf(judgements),
				curves: posts.map((post) => curve(post, peersOf(post), now))
			};
		});
		return sortRows(list, sort);
	});

	/* ---- Jestr campaigns (jestrcampaign.ts): a column and an Edit mode, with the integration on ---- */

	const jestrOn = $derived(general.value.jestrIntegration);
	const flagged = $derived(flaggedPosts(dashData.targets));

	function campaignPosts(r: Release): CampaignPosts {
		const yt = r.posts.youtube;
		const ig = r.posts.instagram;
		return {
			youtube: yt ? { id: yt.id } : undefined,
			instagram: ig ? { id: ig.id, url: ig.url } : undefined
		};
	}

	// Apart from the rows, so a mark redraws a tick rather than every curve.
	const campaigns = $derived(
		new Set(inViewList.filter((r) => isCampaign(campaignPosts(r), jestrCampaigns.marks, flagged)).map((r) => r.key))
	);
	const campaignCount = $derived(rows.filter((row) => campaigns.has(row.release.key)).length);

	let editing = $state(false);
	$effect(() => {
		if (!jestrOn) editing = false;
	});

	/** Whether a video can be a Jestr submission: it has a YouTube or Instagram post (Facebook is not one). */
	function markable(r: Release): boolean {
		return Boolean(r.posts.youtube || r.posts.instagram);
	}

	function toggleCampaign(r: Release) {
		if (!markable(r)) return;
		void jestrCampaigns.set(campaignPosts(r), !campaigns.has(r.key), r.title);
	}

	const totals = $derived.by(() => {
		const sum = { views: 0, likes: 0, comments: 0, dViews: 0, dLikes: 0, dComments: 0 };
		for (const row of rows) {
			sum.views += row.views ?? 0;
			sum.likes += row.likes ?? 0;
			sum.comments += row.comments ?? 0;
			sum.dViews += row.delta.views;
			sum.dLikes += row.delta.likes;
			sum.dComments += row.delta.comments;
		}
		return sum;
	});

	let openKey = $state<string | null>(null);

	/** A brand's menu from the chosen scope, where it was right-clicked. */
	let brandMenu = $state<{ brand: string; x: number; y: number } | null>(null);
	let fullRows = $state<Record<string, VideoStats | 'loading' | 'failed'>>({});

	function fullRow(post: Post): VideoStats | null {
		const row = fullRows[post.record];
		return typeof row === 'object' ? row : null;
	}

	/** An opened row's facts: YouTube's once its whole item is read, a reel's at once. */
	function factsFor(post: Post): FactGroup[] | null {
		if (post.platform === 'youtube') {
			const full = fullRow(post);
			return full ? youtubeFacts(full, ago) : null;
		}
		const reel = reels.find((x) => x.id === post.record);
		return reel ? reelFacts(reel, ago) : null;
	}

	async function toggle(release: Release) {
		if (editing) {
			toggleCampaign(release);
			return;
		}
		openKey = openKey === release.key ? null : release.key;
		const yt = release.posts.youtube;
		if (openKey && yt && !fullRows[yt.record]) {
			fullRows = { ...fullRows, [yt.record]: 'loading' };
			try {
				const row = await loadVideoStat(yt.record);
				fullRows = { ...fullRows, [yt.record]: row };
			} catch {
				fullRows = { ...fullRows, [yt.record]: 'failed' };
			}
		}
	}

	/* ---- the period numbers and what is coming ---- */

	const nowDate = $derived(new Date(now));
	const periods = $derived(periodStats(inViewList, filter, nowDate));
	// A platform whose views are read for none of the videos (Facebook without
	// read_insights) says so, rather than +0.
	const viewsUnread = $derived(
		new Set(filter.platforms.filter((p) => !inViewList.some((r) => typeof r.posts[p]?.views === 'number')))
	);

	/* ---- side notes: when each platform was read, and what is left of the day ---- */

	// A scope is no one brand: the pass's own read, and no account named.
	const noteChannel = $derived(scope ? null : channel);
	const noteInstagram = $derived(scope ? null : igAccount);
	const noteFacebook = $derived(scope ? null : fbPage);

	const ytBeat = $derived.by(() => {
		if (!status) return null;
		const own = noteChannel ? status.channels?.[noteChannel.account_id] : undefined;
		return {
			polledAt: own?.polledAt ?? status.polledAt,
			error: own?.error || status.error,
			units: status.unitsToday,
			budget: status.budget
		};
	});
	const igBeat = $derived(noteInstagram ? igStatus?.accounts?.[noteInstagram.account_id] : undefined);
	const fbBeat = $derived(noteFacebook ? fbStatus?.pages?.[noteFacebook.account_id] : undefined);
	const allowance = $derived(postAllowance(noteInstagram));

	/** The account a platform's numbers are read from, for the legend: YouTube by channel name, a Page by its name, Instagram by handle. */
	function accountOf(p: StatPlatform): string {
		const account = p === 'youtube' ? noteChannel : p === 'facebook' ? noteFacebook : noteInstagram;
		if (!account) return '';
		return p === 'instagram' ? accountLabel(account) : account.name || accountLabel(account);
	}

	/* ---- words and numbers ---- */

	const whole = new Intl.NumberFormat();
	const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
	const num = (n: number | null | undefined) => (n == null ? '—' : whole.format(n));
	/** Big, but readable: 12,345 up to five digits, 123.4K past them. */
	const big = (n: number) => (n >= 100_000 ? compact.format(n) : whole.format(n));

	function ago(iso: string | undefined | null): string {
		const t = Date.parse(String(iso ?? '').replace(' ', 'T'));
		if (!Number.isFinite(t)) return 'never';
		return `${span(now - t)} ago`;
	}

	function span(ms: number): string {
		const s = Math.max(0, Math.round(ms / 1000));
		if (s < 60) return `${s} s`;
		const m = Math.round(s / 60);
		if (m < 60) return `${m} min`;
		const h = Math.round(m / 60);
		if (h < 48) return `${h} h`;
		const d = Math.round(h / 24);
		if (d < 90) return `${d} days`;
		if (d < 730) return `${Math.round(d / 30)} months`;
		return `${Math.round(d / 365)} years`;
	}

	function ageWords(ms: number): string {
		if (ms >= 7 * 86_400_000 - 60_000) return 'in its first week';
		return `${span(ms)} after release`;
	}

	function released(at: number): string {
		const date = new Date(at);
		const sameYear = date.getFullYear() === nowDate.getFullYear();
		return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
	}

	const KIND_ONE: Record<string, string> = { short: 'Short', long: 'Long form', live: 'Live stream', other: 'Other' };
	/** The performance marks: rising, level, falling — and a dash where there is nothing to compare with. */
	const TREND = {
		ahead: 'M2.5 11.5l4-4 2.5 2.5 4.5-4.5M9.5 5.5h4v4',
		usual: 'M2 8h11.5M10.5 5l3 3-3 3',
		behind: 'M2.5 4.5l4 4 2.5-2.5 4.5 4.5M9.5 10.5h4v-4',
		none: 'M5 8h6'
	};

	function judgementTitle(j: Judgement, release: Release): string {
		const kind = release.kind;
		const label = PLATFORMS[j.platform].label;
		const plural = kind === 'short' ? 'Shorts' : (KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? 'videos').toLowerCase();
		const post = release.posts[j.platform];
		// Never read at all: Facebook's views before read_insights is granted.
		if (j.views === null && post && post.views === null && post.samples.length === 0)
			return `${label}: its views are not read yet.`;
		if (j.views === null) return `${label}: flock was not reading this video ${ageWords(j.age)}.`;
		if (j.usual === null)
			return `${label}: ${num(j.views)} views ${ageWords(j.age)}. Too few other ${plural} were read at that age to say what is usual (${j.peers} of 3).`;
		return `${label}: ${num(j.views)} views ${ageWords(j.age)}. The ${plural} on ${label} usually had ${num(Math.round(j.usual))} by then (the middle of ${j.peers}).`;
	}

	function linkTitle(p: PlatformId): string {
		if (isStatPlatform(p)) return `Open on ${PLATFORMS[p].label}`;
		return `Open on ${PLATFORMS[p].label} — flock posted it there but does not read its views yet`;
	}

	function matchWords(release: Release): string {
		if (release.matched === 'job') return 'Same flock upload';
		if (release.matched === 'time') return 'Paired by time: posted within two hours of each other';
		return '';
	}

	function sortBy(key: SortKey) {
		sort = key;
	}

	/* ---- stored on the NAS ---- */

	let nasOpen = $state(false);
	let jobs = $state<UploadJob[]>([]);
	let jobTargets = $state<UploadTarget[]>([]);
	let nasLoading = $state(false);
	let nasError = $state('');
	let armed = $state<string | null>(null);
	let armTimer: ReturnType<typeof setTimeout> | undefined;
	let deleting = $state<string | null>(null);

	async function loadNas() {
		nasLoading = true;
		try {
			[jobs, jobTargets] = await Promise.all([listJobs(), listTargets()]);
			nasError = '';
		} catch (err) {
			nasError = err instanceof Error ? err.message : String(err);
		} finally {
			nasLoading = false;
		}
	}

	function onNasToggle(event: Event) {
		nasOpen = (event.currentTarget as HTMLDetailsElement).open;
		if (nasOpen) void loadNas();
	}

	const nasBytes = $derived(jobs.reduce((sum, job) => sum + (job.video_size ?? 0), 0));

	/** Two presses within two seconds, like the upload's confirm tick. */
	async function remove(job: UploadJob) {
		if (armed !== job.id) {
			armed = job.id;
			clearTimeout(armTimer);
			armTimer = setTimeout(() => (armed = null), 2000);
			return;
		}
		armed = null;
		deleting = job.id;
		try {
			await deleteJob(job.id);
			await loadNas();
		} catch (err) {
			nasError = err instanceof Error ? err.message : String(err);
		} finally {
			deleting = null;
		}
	}
</script>

{#snippet counter(value: number | null, change: number)}
	<span class="num cell" class:up={change > 0} class:down={change < 0}>
		{num(value)}{#if change}<span class="delta">{change > 0 ? '+' : ''}{whole.format(change)}</span>{/if}
	</span>
{/snippet}

<!-- A counter over the platforms in view, and each platform's own under it. -->
{#snippet stacked(row: Row, key: Counter, main = false)}
	{@const change = row.delta[key]}
	<span class="num cell stack" class:main class:up={change > 0} class:down={change < 0}>
		<span>{num(row[key])}{#if change}<span class="delta">{change > 0 ? '+' : ''}{whole.format(change)}</span>{/if}</span>
		{#if multi && row.posts.length > 1}
			<span class="parts">
				{#each row.posts as post (post.platform)}
					<span title={PLATFORMS[post.platform].label}><i style:background={PLATFORM_COLOURS[post.platform]}></i>{num(post[key])}</span>
				{/each}
			</span>
		{:else if main && multi && row.posts.length === 1}
			<span class="parts only">{PLATFORMS[row.posts[0].platform].label} only</span>
		{/if}
	</span>
{/snippet}

{#snippet sortHead(key: SortKey, label: string, cls = '')}
	<button class="colhead {cls}" class:on={sort === key} onclick={() => sortBy(key)} title="Sort by {label.toLowerCase()}">
		{label}{#if sort === key}<span class="arrow" aria-hidden="true">↓</span>{/if}
	</button>
{/snippet}

<div class="page">
	<!-- One row: what is looked at, for which brand, as which accounts — and when each was read. -->
	<h1 class="hidden">Dashboard</h1>
	<div class="toolbar">
		<DashFilter bind:filter {counts} />
		{#if brands.multiple}
			<div class="brands" role="radiogroup" aria-label="Brand in view">
				{#each devtestDashboardScopes as s (s.label)}
					<button
						class="brandchip"
						class:on={s === scope}
						role="radio"
						aria-checked={s === scope}
						title={s.title}
						onclick={() => {
							for (const other of devtestDashboardScopes) if (other !== s) other.release();
							s.select();
						}}>{s.label}</button
					>
				{/each}
				{#each brands.ordered as brand (brand.id)}
					<button
						class="brandchip"
						class:on={!scope && brand.id === brands.currentId}
						role="radio"
						aria-checked={!scope && brand.id === brands.currentId}
						style:--chip={scope ? sets.find((set) => set.label === brand.name)?.colour : undefined}
						class:tinted={Boolean(scope && sets.find((set) => set.label === brand.name)?.colour)}
						onclick={() => {
							for (const s of devtestDashboardScopes) s.release();
							brands.select(brand.id);
						}}
						oncontextmenu={(e) => {
							if (!scope?.BrandMenu) return;
							e.preventDefault();
							brandMenu = { brand: brand.id, x: e.clientX, y: e.clientY };
						}}>{brand.name}</button
					>
				{/each}
			</div>
			{#if scope?.BrandMenu && brandMenu}
				<scope.BrandMenu brand={brandMenu.brand} x={brandMenu.x} y={brandMenu.y} close={() => (brandMenu = null)} />
			{/if}
		{/if}
		<span class="legend">
			{#each filter.platforms as p (p)}
				{@const account = accountOf(p)}
				<span><i style:background={PLATFORM_COLOURS[p]}></i>{PLATFORMS[p].label}{#if account}<em>({account})</em>{/if}</span>
			{/each}
		</span>
		<div class="aside">
			<!-- When each platform was read and what is left of the day: a side note, not a box. -->
			<ul class="notes">
				{#if ytBeat}
					<li class:bad={Boolean(ytBeat.error)} title={ytBeat.error || 'YouTube quota: units spent today of the stats budget'}>
						<PlatformIcon platform="youtube" size={12} />
						{#if ytBeat.error}
							{ytBeat.error}
						{:else}
							read {ago(ytBeat.polledAt)} · {big(ytBeat.units)}/{big(ytBeat.budget)} units
						{/if}
					</li>
				{/if}
				{#if noteInstagram}
					<li class:bad={Boolean(igBeat?.error)} title={igBeat?.error || 'Instagram: posts published in the last 24 h of the 100 allowed'}>
						<PlatformIcon platform="instagram" size={12} />
						{#if igBeat?.error}
							{igBeat.error}
						{:else}
							read {ago(igBeat?.polledAt)}{allowance ? ` · ${allowance.used}/${allowance.total} posts in 24 h` : ''}
						{/if}
					</li>
				{/if}
				{#if noteFacebook}
					<li
						class:bad={Boolean(fbBeat?.error)}
						class:warn={!fbBeat?.error && Boolean(fbBeat?.views)}
						title={fbBeat?.error || fbBeat?.views || "Facebook: when the Page's reels were last read"}
					>
						<PlatformIcon platform="facebook" size={12} />
						{#if fbBeat?.error}
							{fbBeat.error}
						{:else}
							read {ago(fbBeat?.polledAt)}{fbBeat?.views ? ' · views not read' : ''}
						{/if}
					</li>
				{/if}
			</ul>
			{#if jestrOn}
				<button
					class="btn sm"
					class:editing
					aria-pressed={editing}
					onclick={() => (editing = !editing)}
					title={editing ? 'Stop marking Jestr campaigns' : 'Mark videos as Jestr campaigns'}>{editing ? 'Done' : 'Edit'}</button
				>
			{/if}
			<button class="btn sm" onclick={() => load(true)} disabled={loading} title="Read everything again, and reset the change markers"
				>Refresh</button
			>
		</div>
	</div>

	{#if error}
		<p class="banner bad">Could not reach PocketBase — {error}</p>
	{/if}

	<div class="top">
		<section class="card periods" aria-label="Numbers by period">
			{#each periods as period (period.key)}
				<div class="period">
					<h2>{period.label}</h2>
					<div class="pair">
						<div>
							<span class="bignum accent">{big(period.released)}</span>
							<span class="unit">{period.released === 1 ? 'video out' : 'videos out'}</span>
						</div>
						<div>
							<span class="bignum" title={whole.format(period.views)}>{big(period.views)}</span>
							<span class="unit">views on them</span>
						</div>
					</div>
					<p
						class="gained"
						title="Views every video in view gained since the start of the period{period.partly
							? '. Some were not read yet at its start, so they count from when flock first read them.'
							: '.'}"
					>
						<strong>+{whole.format(period.gained)}</strong> views gained{period.partly ? ' (at least)' : ''}
					</p>
					{#if multi}
						<p class="split">
							{#each filter.platforms as p (p)}
								{#if viewsUnread.has(p)}
									<span title="{PLATFORMS[p].label}: views not read yet"><i style:background={PLATFORM_COLOURS[p]}></i>—</span>
								{:else}
									<span title="{PLATFORMS[p].label}: {whole.format(period.byPlatform[p].views)} views on the videos out, +{whole.format(
											period.byPlatform[p].gained
										)} gained"
										><i style:background={PLATFORM_COLOURS[p]}></i>+{big(period.byPlatform[p].gained)}</span
									>
								{/if}
							{/each}
						</p>
					{/if}
				</div>
			{/each}
		</section>

		<ComingUp targets={postsInView} now={nowDate} />
	</div>

	{#if noChannel}
		<p class="banner">
			{brands.multiple ? `${brands.current?.name ?? 'This brand'} has` : 'There is'} no YouTube channel chosen.
			<a href="{base}/settings?section=brands">Choose one in Settings → Brands</a>.
		</p>
	{/if}

	{#if editing}
		<p class="banner editbar">
			Click a video to mark it as a Jestr campaign, or to take the mark off. <strong>Done</strong> when finished.
			{#if jestrCampaigns.error}<span class="bad">Not saved: {jestrCampaigns.error}</span>{/if}
		</p>
	{/if}

	<!-- The Jestr cell is always the third, hidden without the integration, so
	     the narrow layouts can hide the others by their place. -->
	<section class="card list" class:withjestr={jestrOn} class:editing aria-label="Every video">
		<div class="row cols">
			<span></span>
			{@render sortHead('date', 'Video', 'left')}
			<span class="colhead plain jcell" title="Jestr campaign videos">Jestr</span>
			{@render sortHead('views', 'Views')}
			{@render sortHead('likes', 'Likes')}
			{@render sortHead('comments', 'Comments')}
			<span class="colhead plain" title="Views from release, up to its first week; dashed: the usual for its kind">From release</span>
			{@render sortHead('usual', 'vs usual')}
		</div>
		<div class="row total">
			<span></span>
			<span class="vid">
				<span class="vtitle">Total</span>
				<span class="vmeta">{rows.length} {rows.length === 1 ? 'video' : 'videos'}</span>
			</span>
			<span class="jcell num cell" title="Jestr campaign videos among them">{campaignCount}</span>
			{@render counter(totals.views, totals.dViews)}
			{@render counter(totals.likes, totals.dLikes)}
			{@render counter(totals.comments, totals.dComments)}
			<span></span>
			<span></span>
		</div>

		{#each rows as row (row.release.key)}
			{@const r = row.release}
			{@const visibility = visibilityOf(r, filter.platforms)}
			{@const campaign = campaigns.has(r.key)}
			<div class="item" class:open={openKey === r.key} class:tinted={Boolean(r.tint)} style:--tint={r.tint}>
				<button
					class="row"
					onclick={() => toggle(r)}
					aria-expanded={editing ? undefined : openKey === r.key}
					aria-pressed={editing && markable(r) ? campaign : undefined}
					aria-disabled={editing && !markable(r) ? true : undefined}
				>
					{#if r.thumb}
						<img class="thumb" src={r.thumb} alt="" loading="lazy" />
					{:else}
						<span class="thumb blank"
							><PlatformIcon platform={r.posts.instagram ? 'instagram' : r.posts.facebook ? 'facebook' : 'youtube'} size={16} /></span
						>
					{/if}
					<span class="vid">
						<span class="vtitle">{r.title}</span>
						<span class="vmeta">
							<span title={new Date(r.at).toLocaleString()}>{released(r.at)} · {span(now - r.at)} ago</span>
							<span class="dot">·</span>{KIND_ONE[r.kind]}{#if r.duration > 0}&nbsp;{formatDuration(r.duration)}{/if}
							{#if visibility !== 'public'}
								<span class="dot">·</span><span class="priv {visibility}">{visibility}</span>
							{/if}
							<span class="dot">·</span>
							<span class="marks" title={matchWords(r)}>
								{#each ALL_PLATFORMS.filter((p) => r.links[p]) as p (p)}
									<span class="mark" class:unread={!isStatPlatform(p)}><PlatformIcon platform={p} size={11} /></span>
								{/each}
							</span>
							{#if r.job}<span class="via" title="Uploaded through flock">flock</span>{/if}
								{#if r.group}<span class="dot">·</span><span class="group" style:color={r.tint}>{r.group}</span>{/if}
						</span>
					</span>
					<span
						class="jcell"
						class:on={campaign}
						title={campaign ? 'A Jestr campaign video' : editing && !markable(r) ? 'Facebook only: not a Jestr submission' : ''}
					>
						{#if campaign || (editing && markable(r))}
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
								<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" class="box" />
								{#if campaign}<path d="M4.5 8.2 7 10.6l4.6-5" class="tick" />{/if}
							</svg>
						{/if}
					</span>
					{@render stacked(row, 'views', true)}
					{@render stacked(row, 'likes')}
					{@render stacked(row, 'comments')}
					<span class="spark"><ViewsCurve curves={row.curves} /></span>
					<span class="verdicts">
						{#each row.judgements as j (j.platform)}
							<span class="judged {j.verdict ?? 'none'}" title={judgementTitle(j, r)}>
								<PlatformIcon platform={j.platform} size={13} />
								<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
									<path d={TREND[j.verdict ?? 'none']} />
								</svg>
							</span>
						{/each}
					</span>
				</button>

				{#if openKey === r.key}
					<div class="details">
						<div class="chart">
							<h4>
								From release
								<span class="sub">
									{#each row.curves as c (c.platform)}
										<span><i style:background={PLATFORM_COLOURS[c.platform]}></i>{PLATFORMS[c.platform].label}</span>
									{/each}
									<span class="dash">usual for its kind, dashed</span>
								</span>
							</h4>
							<ViewsCurve curves={row.curves} big />
							<p class="links">
								{#each ALL_PLATFORMS.filter((p) => r.links[p]) as p (p)}
									<a href={r.links[p]} target="_blank" rel="noopener" title={linkTitle(p)}
										><PlatformIcon platform={p} size={13} /> {PLATFORMS[p].label}</a
									>
								{/each}
								{#if r.job}
									<a href="{base}/log/upload?job={encodeURIComponent(r.job)}">Upload overview</a>
								{/if}
								{#if r.matched}<span class="match">{matchWords(r)}</span>{/if}
							</p>
						</div>
						{#each filter.platforms as p (p)}
							{@const post = r.posts[p]}
							{#if post}
								{@const facts = factsFor(post)}
								<div class="facts">
									<h4><PlatformIcon platform={p} size={13} /> {PLATFORMS[p].label}</h4>
									{#if facts}
										<div class="groups">
											{#each facts as group (group.title)}
												<section class="group">
													<h5>{group.title}</h5>
													<dl>
														{#each group.rows as [label, value] (label)}
															<dt>{label}</dt>
															<dd>{value}</dd>
														{/each}
													</dl>
												</section>
											{/each}
										</div>
										{@const full = p === 'youtube' ? fullRow(post) : null}
										{#if full}
											<details class="raw">
												<summary>Everything the API returned</summary>
												<pre>{JSON.stringify(full.data, null, 2)}</pre>
											</details>
										{/if}
									{:else}
										<p class="none">{fullRows[post.record] === 'failed' ? 'Could not read it.' : 'Reading…'}</p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/each}

		{#if loaded && rows.length === 0}
			<p class="empty">
				{releases.length === 0 ? 'No videos read yet. They appear once the worker has read the channel.' : 'Nothing to show with these choices.'}
			</p>
		{:else if !loaded}
			<p class="empty">Reading…</p>
		{/if}
	</section>

	<details class="card nas" ontoggle={onNasToggle}>
		<summary>
			<h2>Stored on the NAS</h2>
			{#if nasOpen && jobs.length > 0}
				<span class="sub">{jobs.length} newest uploads · {formatBytes(nasBytes)}</span>
			{:else}
				<span class="sub">The newest uploads and their posts; delete one to free its space</span>
			{/if}
		</summary>
		{#if nasError}
			<p class="banner bad">{nasError}</p>
		{:else if nasLoading && jobs.length === 0}
			<p class="none">Reading…</p>
		{:else if jobs.length === 0}
			<p class="none">No uploads stored yet.</p>
		{:else}
			<ul class="jobs">
				{#each jobs as job (job.id)}
					<li>
						<div class="jobhead">
							<a class="jtitle" href="{base}/log/upload?job={encodeURIComponent(job.id)}">{job.title || '(untitled)'}</a>
							<span class="jmeta">
								{#if brands.multiple && (job.brand || job.brand_name)}
									{brands.byId(job.brand ?? '')?.name ?? job.brand_name}<span class="dot">·</span>
								{/if}
								{job.video_name || 'no file'}{#if job.video_size}<span class="dot">·</span>{formatBytes(job.video_size)}{/if}
							</span>
							<span class="jposts">
								{#each jobTargets.filter((t) => t.job === job.id) as t (t.id)}
									<span class="jpost {t.status}" title="{t.platform}: {t.status}{t.error ? ` — ${t.error}` : ''}"
										>{#if isPlatformId(t.platform)}<PlatformIcon platform={t.platform} size={13} />{:else}{t.platform}{/if}</span
									>
								{/each}
							</span>
							<button
								class="del"
								class:armed={armed === job.id}
								onclick={() => remove(job)}
								disabled={deleting === job.id}
								title={armed === job.id ? 'Press again to delete it' : 'Delete this upload from the NAS (press twice)'}
								aria-label="Delete this upload"
							>
								{#if armed === job.id}Delete?{:else}
									<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
										><path
											d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
											fill="none"
											stroke="currentColor"
											stroke-width="1.4"
											stroke-linecap="round"
											stroke-linejoin="round"
										/></svg
									>
								{/if}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</details>

	<p class="foot">
		Views, likes and comments are YouTube's and Instagram's own counters.
		{combined || multi ? 'Sums across platforms, ' : ''}"usual", the verdicts and the curves are flock's arithmetic over them,
		not figures either platform reports. One channel at a time; nothing is added up across channels.
	</p>
</div>

<style>
	.page {
		width: 100%;
		max-width: 1500px;
		margin: 0 auto;
	}

	/* ---- the one row on top: filter, brands, accounts, read times ---- */

	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 16px;
		margin-bottom: 14px;
		position: relative;
		z-index: 5;
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.brandchip {
		padding: 5px 13px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		font-size: 12px;
		font-weight: 560;
		color: var(--text-dim);
		transition:
			border-color 0.14s,
			background 0.14s,
			color 0.14s;
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

	.legend {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.legend em {
		margin-left: 4px;
		font-style: normal;
		color: var(--text-faint);
	}

	.aside {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-left: auto;
	}

	.notes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		justify-items: end;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.notes li {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 420px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.notes li.bad {
		color: var(--danger);
	}

	.notes li.warn {
		color: var(--warn);
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.banner {
		margin: 0 0 14px;
		padding: 11px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.bad {
		color: var(--danger);
		border-color: rgba(248, 113, 113, 0.4);
	}

	.legend span,
	.split span,
	.parts span,
	.sub span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	i {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	/* ---- the period numbers and coming up ---- */

	.top {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);
		gap: 14px;
		margin-bottom: 14px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.sub {
		margin-left: 6px;
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text-faint);
	}

	.periods {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		padding: 14px 0;
		container-type: inline-size;
	}

	.period {
		min-width: 0;
		padding: 0 18px;
	}

	.period + .period {
		border-left: 1px solid var(--border);
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.bignum {
		display: block;
		font-size: clamp(22px, 3.6cqi, 32px);
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--text);
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
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.gained {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.gained strong {
		color: var(--ok);
		font-weight: 650;
	}

	.split {
		display: flex;
		flex-wrap: wrap;
		gap: 3px 10px;
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.none {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	/* ---- the list ---- */

	.list {
		overflow: hidden;
		padding: 0;
	}

	.row {
		display: grid;
		/* "vs usual" holds four platforms' marks with their verdicts. */
		grid-template-columns: 64px minmax(0, 1fr) 130px 106px 106px 156px 164px;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 7px 16px;
		border: 0;
		border-top: 1px solid var(--border);
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	button.row {
		cursor: pointer;
	}

	button.row:hover,
	.item.open > .row {
		background: var(--surface-2);
	}

	.withjestr .row {
		grid-template-columns: 64px minmax(0, 1fr) 48px 130px 106px 106px 156px 164px;
	}

	.jcell {
		display: none;
	}

	.withjestr .jcell {
		display: flex;
		justify-content: center;
		text-align: center;
	}

	.jcell svg .box {
		fill: none;
		stroke: var(--border-strong);
		stroke-width: 1.4;
	}

	.jcell.on svg .box {
		fill: rgba(52, 211, 153, 0.16);
		stroke: rgba(52, 211, 153, 0.7);
	}

	.jcell svg .tick {
		fill: none;
		stroke: var(--ok);
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.editing button.row:hover .jcell svg .box {
		stroke: var(--pink);
	}

	.btn.editing {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.editbar {
		border-color: rgba(255, 77, 158, 0.4);
	}

	.editbar .bad {
		margin-left: 8px;
		color: var(--danger);
	}

	/* A group's colour (a local scope's, see devtest.ts) washes its rows. */
	.item.tinted > .row {
		background: color-mix(in srgb, var(--tint) 13%, transparent);
	}

	.item.tinted > button.row:hover,
	.item.tinted.open > .row {
		background: color-mix(in srgb, var(--tint) 22%, var(--surface-2));
	}

	.brandchip.tinted:not(.on) {
		border-color: color-mix(in srgb, var(--chip) 70%, transparent);
	}

	.row.cols {
		border-top: 0;
		padding-top: 10px;
		padding-bottom: 8px;
	}

	.colhead {
		padding: 0;
		font: inherit;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
		text-align: right;
		white-space: nowrap;
	}

	.colhead.left,
	.colhead.plain {
		text-align: left;
	}

	button.colhead:hover,
	.colhead.on {
		color: var(--text);
	}

	.arrow {
		margin-left: 3px;
		color: var(--pink-soft);
	}

	.row.total {
		background: var(--surface-2);
	}

	.row.total .cell {
		color: var(--text);
		font-weight: 600;
	}

	.thumb {
		display: block;
		width: 64px;
		height: 36px;
		object-fit: cover;
		border-radius: 6px;
		background: var(--surface-3);
	}

	.thumb.blank {
		display: grid;
		place-items: center;
		color: var(--text-faint);
	}

	.vid {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.vtitle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 570;
	}

	.vmeta {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: 11px;
		color: var(--text-faint);
	}

	.dot {
		margin: 0 5px;
		opacity: 0.5;
	}

	.marks {
		display: inline-flex;
		gap: 3px;
	}

	.mark {
		display: inline-flex;
	}

	.via {
		margin-left: 6px;
		font-weight: 650;
		color: var(--pink-soft);
	}

	.group {
		font-weight: 600;
		color: var(--text-dim);
	}

	.priv {
		text-transform: capitalize;
		color: #cfa8fb;
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
		font-size: 10.5px;
		font-weight: 600;
	}

	.delta::before {
		content: '(';
	}

	.delta::after {
		content: ')';
	}

	.stack {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
	}

	.stack.main {
		color: var(--text);
		font-weight: 600;
	}

	.parts {
		display: inline-flex;
		gap: 7px;
		font-size: 10.5px;
		font-weight: 500;
		color: var(--text-faint);
	}

	.parts i {
		width: 6px;
		height: 6px;
	}

	.spark {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
	}

	.verdicts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 4px 10px;
	}

	/* A platform's mark and, after it, how the video stands there against usual. */
	.judged {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-dim);
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

	.empty {
		margin: 0;
		padding: 16px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-faint);
	}

	/* ---- an opened row ---- */

	.details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 12px 28px;
		padding: 10px 16px 18px 92px;
		border-top: 1px dashed var(--border);
		background: var(--surface-2);
	}

	.chart {
		grid-column: 1 / -1;
		max-width: 980px;
	}

	h4 {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin: 6px 0 8px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	h4 .sub {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.dash {
		font-style: italic;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 14px;
		margin: 10px 0 0;
		font-size: 12px;
	}

	.links a {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text-dim);
	}

	.links a:hover {
		color: var(--pink-soft);
	}

	.match {
		color: var(--text-faint);
		font-size: 11.5px;
	}

	.groups {
		display: grid;
		gap: 6px;
	}

	h5 {
		margin: 6px 0 4px;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 3px 12px;
		margin: 0;
		font-size: 12px;
	}

	dt {
		color: var(--text-dim);
		white-space: nowrap;
	}

	dd {
		margin: 0;
		color: var(--text);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}

	.raw {
		margin-top: 10px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.raw summary {
		cursor: pointer;
	}

	.raw pre {
		max-height: 360px;
		overflow: auto;
		margin: 8px 0 0;
		padding: 12px;
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.45;
	}

	/* ---- stored on the NAS ---- */

	.nas {
		margin-top: 14px;
		padding: 0;
		overflow: hidden;
	}

	.nas summary {
		display: flex;
		align-items: baseline;
		gap: 4px;
		padding: 13px 16px;
		cursor: pointer;
		list-style: none;
	}

	.nas summary::-webkit-details-marker {
		display: none;
	}

	.nas summary::before {
		content: '›';
		margin-right: 6px;
		color: var(--text-faint);
		transition: transform 0.15s;
	}

	.nas[open] summary::before {
		transform: rotate(90deg);
	}

	.nas summary h2 {
		margin: 0;
	}

	.nas > .none,
	.nas > .banner {
		margin: 0 16px 14px;
	}

	.jobs {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.jobhead {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto 64px;
		align-items: center;
		gap: 12px;
		padding: 7px 16px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
	}

	.jtitle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		text-decoration: none;
	}

	.jtitle:hover {
		color: var(--pink-soft);
	}

	.jmeta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.jposts {
		display: inline-flex;
		gap: 6px;
	}

	.jpost {
		display: inline-flex;
		padding: 2px;
		border-radius: 5px;
		box-shadow: inset 0 -2px 0 var(--border-strong);
	}

	.jpost.published,
	.jpost.scheduled {
		box-shadow: inset 0 -2px 0 var(--ok);
	}

	.jpost.failed {
		box-shadow: inset 0 -2px 0 var(--danger);
	}

	.jpost.pending,
	.jpost.publishing {
		box-shadow: inset 0 -2px 0 var(--warn);
	}

	.del {
		justify-self: end;
		display: grid;
		place-items: center;
		min-width: 26px;
		height: 26px;
		padding: 0 6px;
		border-radius: 7px;
		font-size: 11px;
		font-weight: 650;
		color: var(--text-faint);
	}

	.del:hover:not(:disabled),
	.del.armed {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.foot {
		margin: 14px 2px 0;
		font-size: 11px;
		line-height: 1.5;
		color: var(--text-faint);
	}

	/* ---- narrower ---- */

	@media (max-width: 1200px) {
		.top {
			grid-template-columns: minmax(0, 1fr);
		}
		.row {
			grid-template-columns: 56px minmax(0, 1fr) 104px 132px 164px;
		}
		.withjestr .row {
			grid-template-columns: 56px minmax(0, 1fr) 44px 104px 132px 164px;
		}
		.row > :nth-child(5),
		.row > :nth-child(6) {
			display: none;
		}
		.details {
			padding-left: 16px;
		}
	}

	@media (max-width: 760px) {
		.aside {
			margin-left: 0;
		}
		.notes {
			justify-items: start;
		}
		.periods {
			grid-template-columns: minmax(0, 1fr);
			gap: 14px;
		}
		.period + .period {
			border-left: 0;
			border-top: 1px solid var(--border);
			padding-top: 12px;
		}
		.row {
			grid-template-columns: 48px minmax(0, 1fr) 96px 76px;
		}
		.withjestr .row {
			grid-template-columns: 48px minmax(0, 1fr) 40px 96px 76px;
		}
		.row > :nth-child(7) {
			display: none;
		}
		.thumb {
			width: 48px;
			height: 27px;
		}
	}
</style>
