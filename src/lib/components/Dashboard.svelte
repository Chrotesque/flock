<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import PlatformIcon from './PlatformIcon.svelte';
	import DashFilter from './DashFilter.svelte';
	import ViewsCurve from './ViewsCurve.svelte';
	import RenameDialog from './RenameDialog.svelte';
	import BrandMonths from './BrandMonths.svelte';
	import NasPlayer from './NasPlayer.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dashData } from '$lib/stores/dashdata.svelte';
	import { devtestDashboardScopes } from '$lib/devtest';
	import { general } from '$lib/stores/general.svelte';
	import { jestrCampaigns } from '$lib/stores/jestrcampaigns.svelte';
	import { hiddenVideos } from '$lib/stores/hiddenvideos.svelte';
	import { titleRequests } from '$lib/stores/titlerequests.svelte';
	import { flaggedPosts, isCampaign, type CampaignPosts } from '$lib/jestrcampaign';
	import { releasesWithHidden } from '$lib/hiddenvideos';
	import { newestByPost, renameChoices, renameNotes, type RenameChoice } from '$lib/retitle';
	import { accountLabel, postAllowance } from '$lib/accounts';
	import { LEVEL_WORDS, limitLevel, lineLevel, shortError, worstLevel, type StatusLevel } from '$lib/dashstatus';
	import {
		creditedFollowers,
		engagedOf,
		followerSource,
		stateOf,
		youtubeSkipRate,
		type FollowerGain,
		type FollowerState
	} from '$lib/followers';
	import { onTikTokAccount, tiktokRef, tiktokReportOf, tiktokStateOf } from '$lib/tiktokaccount';
	import { COLUMNS, gridTemplate, shownColumns, type ColumnId } from '$lib/dashcolumns';
	import { PLATFORMS, isPlatformId } from '$lib/platforms';
	import {
		deleteJob,
		listJobs,
		listTargets,
		loadVideoStat,
		requestStatsRefresh,
		subscribeReels,
		subscribeStats,
		subscribeTargets,
		toDashboardVideo
	} from '$lib/repo';
	import { UPLOADS_A_DAY, quotaToday, refreshDue, stopToday, stopWords, type QuotaRow } from '$lib/youtubequota';
	import { formatBytes, formatDuration, shortCount } from '$lib/format';
	import { KIND_LABELS } from '$lib/videokind';
	import { TREND, changeWords } from '$lib/trend';
	import { reelFacts, youtubeFacts, type FactGroup } from '$lib/videofacts';
	import type { PlatformId, UploadJob, UploadTarget, VideoStats } from '$lib/types';
	import {
		ALL_PLATFORMS,
		PLATFORM_COLOURS,
		curve,
		filterCounts,
		inView,
		isCombined,
		isStatPlatform,
		judge,
		peerGroups,
		periodStats,
		overallOf,
		readFilter,
		sortRows,
		storedFilter,
		sumOf,
		visibilityOf,
		type Counter,
		type Curve,
		type DashFilter as Filter,
		type Judgement,
		type Overall,
		type Post,
		type Release,
		type SortKey,
		inSpan,
		pooledSkipRate,
		SKIP_PLATFORMS,
		skipPosts,
		skipRateOf,
		sortWords,
		type StatPlatform
	} from '$lib/releases';

	/**
	 * The dashboard: every video and the numbers around them, opened over
	 * the content area (DashboardOverlay). One element says what is looked at
	 * (platforms — all of them is the combined view — kinds and visibility);
	 * the period numbers and the list of every video follow it. Each video
	 * carries its curve from release and how it stands against the usual for
	 * its kind. The brand in view picks the channel, the Instagram account, the
	 * TikTok account and the Facebook Page, one of each — never added up across channels
	 * (YouTube's rule). The
	 * arithmetic is releases.ts; the data `dashData`, kept between openings.
	 */

	brands.load();
	accounts.load();

	/* ---- per-browser choices ---- */

	const FILTER_KEY = 'flock.dashboard.filter';
	const SORT_KEY = 'flock.dashboard.sort';
	const SORT_REVERSED_KEY = 'flock.dashboard.sortReversed';

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

	const SORTS: SortKey[] = ['date', 'views', 'likes', 'comments', 'followers', 'skip', 'usual'];
	let filter = $state<Filter>(readFilter(parsed(readPref(FILTER_KEY))));
	let sort = $state<SortKey>(SORTS.find((s) => s === readPref(SORT_KEY)) ?? 'date');
	$effect(() => writePref(FILTER_KEY, JSON.stringify(storedFilter(filter))));
	// A second click on the column sorted by turns it round (worst first).
	let reversed = $state(readPref(SORT_REVERSED_KEY) === '1');
	$effect(() => writePref(SORT_KEY, sort));
	$effect(() => writePref(SORT_REVERSED_KEY, reversed ? '1' : '0'));

	/* ---- the data ---- */

	let now = $state(Date.now());
	const followerStates = $derived(dashData.followers);
	const postTime = (iso: string) => Date.parse(String(iso ?? '').replace(' ', 'T'));
	// Each post with the followers it brought: credited by the worker for
	// YouTube, Instagram and TikTok, Facebook's own count for a reel (followers.ts).
	// A YouTube video also gets its skip rate from YouTube Analytics' engaged views.
	const videos = $derived(
		dashData.videos.map((v) => ({
			...v,
			followers: creditedFollowers(stateOf(followerStates, 'youtube', v.channelId), v.video_id, postTime(v.published_at)),
			skipRate: youtubeSkipRate(engagedOf(followerStates, v.video_id), v.views)
		}))
	);
	const reels = $derived(
		dashData.reels.map((r) =>
			r.platform === 'instagram' || r.platform === 'tiktok'
				? { ...r, followers: creditedFollowers(stateOf(followerStates, r.platform, r.account), r.post_id, postTime(r.published_at)) }
				: r
		)
	);
	const igReels = $derived(reels.filter((r) => r.platform === 'instagram'));
	const fbReels = $derived(reels.filter((r) => r.platform === 'facebook'));
	const ttVideos = $derived(reels.filter((r) => r.platform === 'tiktok'));
	const status = $derived(dashData.status);
	const igStatus = $derived(dashData.igStatus);
	const fbStatus = $derived(dashData.fbStatus);
	const ttStatus = $derived(dashData.ttStatus);
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
	type Counted = { views: number | null; likes: number | null; comments: number | null; followers?: number | null };
	const countersOf = (row: Counted): Counters => ({
		views: row.views,
		likes: row.likes,
		comments: row.comments,
		followers: row.followers ?? null
	});

	function rebase() {
		baseline = Object.fromEntries([
			...videos.map((v) => [`youtube:${v.id}`, countersOf(v)]),
			...reels.map((r) => [`${r.platform}:${r.id}`, countersOf(r)])
		]);
		based = true;
	}

	/** A row first seen now has nothing to be measured against yet. */
	function baseIfNew(key: string, row: Counted) {
		if (based && !baseline[key]) baseline = { ...baseline, [key]: countersOf(row) };
	}

	async function load(reset = false) {
		await dashData.refresh();
		if (reset || !based) rebase();
		now = Date.now();
	}

	/* Refresh. Once the day's units stop YouTube's automatic reads (the stats
	 * budget), it also asks the worker to read every channel now, and it turns
	 * red when those numbers are five minutes old (youtubequota.ts). A press
	 * greys it for five minutes, whether or not the read comes. */
	let refreshPressedAt = $state(0);
	let refreshing = $state(false);
	const refreshRed = $derived(refreshDue(status, now, refreshPressedAt));

	async function onRefresh() {
		refreshPressedAt = Date.now();
		if (stopToday(status, Date.now()) === 'auto') {
			refreshing = true;
			try {
				await requestStatsRefresh();
			} catch {
				// No device name, or PocketBase away: the page re-reads anyway.
			} finally {
				refreshing = false;
			}
		}
		await load(true);
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
			onStatus: (next) => (dashData.status = next),
			onFollowers: (state) => dashData.putFollowers(state)
		});
		void jestrCampaigns.load().catch(() => {});
		const stopMarks = jestrCampaigns.subscribe();
		void hiddenVideos.load().catch(() => {});
		const stopHidden = hiddenVideos.subscribe();
		void titleRequests.load();
		const stopRenames = titleRequests.subscribe();
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
			stopHidden();
			stopRenames();
			stopReels();
			stopTargets();
		};
	});

	/* ---- the brand in view: one channel, one Instagram account, one TikTok account, one Facebook Page ---- */

	const channel = $derived(accounts.for('youtube'));
	const igAccount = $derived(accounts.for('instagram'));
	const fbPage = $derived(accounts.for('facebook'));
	const ttAccount = $derived(accounts.for('tiktok'));
	// One brand and at most one account: nothing to choose between, so all of it.
	const loneYT = $derived(!channel && !brands.multiple && accounts.forPlatform('youtube').length <= 1);
	const loneIG = $derived(!igAccount && !brands.multiple && accounts.forPlatform('instagram').length <= 1);
	const loneFB = $derived(!fbPage && !brands.multiple && accounts.forPlatform('facebook').length <= 1);
	const loneTT = $derived(!ttAccount && !brands.multiple && accounts.forPlatform('tiktok').length <= 1);
	const myVideos = $derived(
		channel ? videos.filter((v) => v.channelId === channel.account_id) : loneYT ? videos : []
	);
	const myReels = $derived(igAccount ? igReels.filter((r) => r.account === igAccount.account_id) : loneIG ? igReels : []);
	const myFbReels = $derived(fbPage ? fbReels.filter((r) => r.account === fbPage.account_id) : loneFB ? fbReels : []);
	// By open id, or by handle where the numbers were read under another app key's (tiktokaccount.ts).
	const myTtVideos = $derived(
		ttAccount ? ttVideos.filter((r) => onTikTokAccount(r, ttAccount)) : loneTT ? ttVideos : []
	);
	// The follower records of the brand's accounts, chosen as its videos are.
	const myFollowers = $derived(
		(
			[
				['youtube', channel, loneYT],
				['instagram', igAccount, loneIG],
				['tiktok', ttAccount, loneTT],
				['facebook', fbPage, loneFB]
			] as const
		).flatMap(([p, account, lone]) =>
			account
				? [p === 'tiktok' ? tiktokStateOf(followerStates, account) : stateOf(followerStates, p, account.account_id)].filter(
						(s): s is FollowerState => Boolean(s)
					)
				: lone
					? followerStates.filter((s) => s.platform === p)
					: []
		)
	);
	const myTargets = $derived(
		brands.multiple ? dashData.targets.filter((t) => t.brand === brands.currentId) : dashData.targets
	);
	// A local module's scope (devtest.ts) replaces the brand in view while chosen.
	const scope = $derived(devtestDashboardScopes.find((s) => s.active()));
	const sets = $derived(
		scope
			? scope.groups().map((g) => {
					// By open id, or by handle, as for the brand in view (tiktokaccount.ts).
					const tt = g.tiktok ? tiktokRef(g.tiktok, accounts.list) : null;
					return {
						label: g.label,
						colour: g.colour,
						videos: g.channel ? videos.filter((v) => v.channelId === g.channel) : [],
						reels: g.instagram ? igReels.filter((r) => r.account === g.instagram) : [],
						fbReels: g.facebook ? fbReels.filter((r) => r.account === g.facebook) : [],
						ttVideos: tt ? ttVideos.filter((r) => onTikTokAccount(r, tt)) : [],
						posts: dashData.targets.filter((t) => t.brand === g.brand),
						followers: [
							stateOf(followerStates, 'youtube', g.channel ?? ''),
							stateOf(followerStates, 'instagram', g.instagram ?? ''),
							tt ? tiktokStateOf(followerStates, tt) : undefined,
							stateOf(followerStates, 'facebook', g.facebook ?? '')
						].filter((s): s is FollowerState => Boolean(s))
					};
				})
			: [
					{
						label: '',
						colour: undefined,
						videos: myVideos,
						reels: myReels,
						fbReels: myFbReels,
						ttVideos: myTtVideos,
						posts: myTargets,
						followers: myFollowers
					}
				]
	);
	const followersInView = $derived(sets.flatMap((set) => set.followers));
	const noChannel = $derived(!scope && accounts.loaded && !channel && !loneYT);

	// Each set's videos and reels pair only among themselves, and the hidden
	// ones (hiddenvideos.ts) only with each other.
	const releases = $derived(
		sets.flatMap((set) =>
			releasesWithHidden(set.videos, set.reels, set.posts, set.fbReels, hiddenVideos.marks, set.ttVideos).map((r) =>
				sets.length > 1 ? { ...r, group: set.label, tint: set.colour } : r
			)
		)
	);
	// The timeframe (the filter's days) is cut first, so every number on the
	// page follows it: the list and its totals, the counts in the filter, the
	// periods, and the peers "usual" is the middle of.
	const spanned = $derived(releases.filter((r) => inSpan(r, filter.days, now)));
	const groups = $derived(peerGroups(spanned));
	const counts = $derived(filterCounts(spanned, filter));
	// While editing, the videos hidden with the eye show too (faded), so one
	// can be shown again without the filter's Hidden; the totals and the Jestr
	// count still leave them out then (`onlyWhileEditing`), and the periods
	// read the filter itself.
	const inViewList = $derived(spanned.filter((r) => inView(r, editing ? { ...filter, hidden: true } : filter)));
	const onlyWhileEditing = (r: Release) => Boolean(r.hidden) && !filter.hidden;
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
		/** Every platform in view against usual at once (overallOf); `ratio` is its views over usual. */
		overall: Overall;
		ratio: number | null;
		curves: Curve[];
		/** The skip rate over the platforms in view that give one (skipRateOf). */
		skip: number | null;
		followers: number | null;
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
			const overall = overallOf(judgements);
			return {
				release,
				posts,
				views: sumOf(release, filter.platforms, 'views'),
				likes: sumOf(release, filter.platforms, 'likes'),
				comments: sumOf(release, filter.platforms, 'comments'),
				followers: sumOf(release, filter.platforms, 'followers'),
				delta: {
					views: deltaOf(posts, 'views'),
					likes: deltaOf(posts, 'likes'),
					comments: deltaOf(posts, 'comments'),
					followers: deltaOf(posts, 'followers')
				},
				judgements,
				overall,
				ratio: overall.ratio,
				curves: posts.map((post) => curve(post, peersOf(post), now)),
				skip: skipRateOf(release, filter.platforms)
			};
		});
		return sortRows(list, sort, reversed);
	});

	/* ---- Jestr campaigns (jestrcampaign.ts): a column, and marks made in Edit mode, with the integration on ---- */

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
	// The list's count, without the videos shown only while editing.
	const editOnly = $derived(rows.filter((row) => onlyWhileEditing(row.release)).length);
	const counted = $derived(rows.length - editOnly);
	const campaignCount = $derived(
		rows.filter((row) => campaigns.has(row.release.key) && !onlyWhileEditing(row.release)).length
	);

	/* ---- the list's columns, as Settings → Dashboard arranges them (dashcolumns.ts) ---- */

	const columns = $derived(shownColumns(general.value.dashboardColumns, { jestr: jestrOn }));
	const grids = $derived({
		wide: gridTemplate(columns, 'wide'),
		mid: gridTemplate(columns, 'mid'),
		narrow: gridTemplate(columns, 'narrow')
	});
	/** A cell's classes: its column, whether it is sized to its content, and whether the narrower lists leave it out. */
	function cellOf(col: ColumnId): string {
		const def = COLUMNS[col];
		return `c-${col}${def.width === 'content' ? ' fit' : ''}${def.mid === null ? ' midoff' : ''}${def.narrow === null ? ' narrowoff' : ''}`;
	}

	/* ---- followers (followers.ts) ---- */

	const FOLLOWER_WORDS: Record<StatPlatform, [string, string]> = {
		youtube: ['subscriber', 'subscribers'],
		instagram: ['follower', 'followers'],
		tiktok: ['follower', 'followers'],
		facebook: ['follower', 'followers']
	};
	const followerWord = (p: StatPlatform, n: number) => FOLLOWER_WORDS[p][Math.abs(n) === 1 ? 0 : 1];
	const signed = (n: number) => (n > 0 ? `+${whole.format(n)}` : n < 0 ? `−${whole.format(-n)}` : '0');
	const signedShort = (n: number) => (n > 0 ? `+${short(n)}` : n < 0 ? `−${short(-n)}` : '0');
	const onDay = (iso: string) => new Date(postTime(iso)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

	/** The accounts' counts now, for the column's tooltip. */
	const followerCounts = $derived(
		followersInView
			.filter((s) => filter.platforms.includes(s.platform))
			.map((s) => `${s.name || PLATFORMS[s.platform].label} (${PLATFORMS[s.platform].label}) ${whole.format(s.count)} ${followerWord(s.platform, s.count)}`)
	);
	const followersAbout = $derived(
		'Followers and subscribers each video brought. Facebook counts the follows from a reel itself, and YouTube Analytics the subscribers from a video (gained less lost, about two days late). ' +
			"Instagram and TikTok only say how many an account has, so flock credits each rise in that count to the videos gaining views at the moment — in proportion to those views, or to the newest video when none was — which is flock's estimate, not a platform figure; it also stands in for YouTube's newest days." +
			(followerCounts.length ? `\n\nNow: ${followerCounts.join(' · ')}` : '')
	);

	/** One video's followers in words, a line per platform. */
	function followersTitle(row: Row): string {
		return row.posts
			.map((post) => {
				const label = PLATFORMS[post.platform].label;
				const state = followersInView.find((s) => s.platform === post.platform);
				if (post.platform === 'facebook') {
					return post.followers === null
						? `${label}: not read yet (needs read_insights)`
						: `${label}: ${whole.format(post.followers)}, Facebook's own count of follows from this reel`;
				}
				if (post.platform === 'youtube' && state && post.followers !== null && followerSource(state, post.at) === 'analytics') {
					return `${label}: ${whole.format(post.followers)}, YouTube Analytics' count (gained less lost, through ${onDay(state.analyticsThrough)})`;
				}
				if (post.followers === null) {
					return state
						? `${label}: not known — it came out before flock began reading ${FOLLOWER_WORDS[post.platform][1]} on ${onDay(state.since)}`
						: `${label}: not read yet`;
				}
				const since = state && post.at < postTime(state.since) ? `, counted since ${onDay(state.since)}` : '';
				return `${label}: ${whole.format(post.followers)}, credited from when the count rose${since}`;
			})
			.join('\n');
	}

	/** A period's follower move in one platform, in words for its popup. */
	function gainWords(gain: FollowerGain | null, p: StatPlatform): string {
		if (!gain) return 'not read yet';
		const state = followersInView.find((s) => s.platform === p);
		return `${signed(gain.gained)} ${followerWord(p, gain.gained)}${gain.partly && state ? ` since ${onDay(state.since)}` : ''}`;
	}

	/* ---- Edit mode ----
	 *
	 * The list opens read-only. Editing renames videos on the platforms
	 * (retitle.ts) — and with the integration marks Jestr campaigns — so, as
	 * in the Calendar, the button arms on the first press and only unlocks on
	 * a second within 2s.
	 */
	let editing = $state(false);
	let editArmed = $state(false);
	let editTimer: ReturnType<typeof setTimeout> | undefined;

	function disarmEdit() {
		editArmed = false;
		clearTimeout(editTimer);
	}

	function onEditClick() {
		if (editing) {
			editing = false;
			renaming = null;
			lastHidden = null;
			disarmEdit();
			return;
		}
		if (editArmed) {
			disarmEdit();
			editing = true;
			return;
		}
		editArmed = true;
		clearTimeout(editTimer);
		editTimer = setTimeout(() => (editArmed = false), 2000);
	}

	/** The video being renamed, and what each of its platforms offers — taken when its pencil was pressed. */
	let renaming = $state<{ release: Release; choices: RenameChoice[] } | null>(null);
	const newestRenames = $derived(newestByPost(titleRequests.rows));

	function openRename(r: Release) {
		renaming = { release: r, choices: renameChoices(r, videos, reels) };
	}

	function renameNote(r: Release) {
		const posts = Object.values(r.posts).filter((p): p is Post => Boolean(p));
		return renameNotes(posts, newestRenames, now);
	}

	/** Whether a video can be a Jestr submission: it has a YouTube or Instagram post (Facebook is not one). */
	function markable(r: Release): boolean {
		return Boolean(r.posts.youtube || r.posts.instagram);
	}

	function toggleCampaign(r: Release) {
		if (!markable(r)) return;
		void jestrCampaigns.set(campaignPosts(r), !campaigns.has(r.key), r.title);
	}

	/*
	 * Hiding (hiddenvideos.ts): the eye hides a row's posts on the platforms
	 * in view — every post in the combined view, so the whole video; with
	 * one platform chosen only that platform's, which is how a test reel
	 * paired by time with a real Short comes off it. The row goes unless the
	 * filter shows hidden ones, so the last hide can be undone from the
	 * banner.
	 */
	let lastHidden = $state<{ posts: Post[]; title: string } | null>(null);

	async function toggleHidden(row: Row) {
		const { posts, release } = row;
		const hide = !release.hidden;
		lastHidden = null;
		// Offered only once it is saved: a refused hide puts the row back by itself.
		if ((await hiddenVideos.set(posts, hide, release.title)) && hide) lastHidden = { posts, title: release.title };
	}

	function undoHide() {
		if (!lastHidden) return;
		void hiddenVideos.set(lastHidden.posts, false, lastHidden.title);
		lastHidden = null;
	}

	function eyeTitle(row: Row): string {
		const r = row.release;
		const all = Object.keys(r.posts).length;
		const where = row.posts.map((p) => PLATFORMS[p.platform].label).join(' and ');
		if (r.hidden) return `Hidden — show it on the Dashboard again${row.posts.length < all ? ` (on ${where}, the platforms in view)` : ''}`;
		return row.posts.length < all
			? `Hide its ${where} post from the Dashboard — only the platforms in view; the rest stays`
			: 'Hide this video from the Dashboard: from the list, the totals, the periods and the usual';
	}

	const totals = $derived.by(() => {
		// Followers stay unknown (—) until some video's are known.
		const sum = { views: 0, likes: 0, comments: 0, followers: null as number | null, dViews: 0, dLikes: 0, dComments: 0, dFollowers: 0 };
		for (const row of rows) {
			if (onlyWhileEditing(row.release)) continue;
			sum.views += row.views ?? 0;
			sum.likes += row.likes ?? 0;
			sum.comments += row.comments ?? 0;
			if (row.followers !== null) sum.followers = (sum.followers ?? 0) + row.followers;
			sum.dViews += row.delta.views;
			sum.dLikes += row.delta.likes;
			sum.dComments += row.delta.comments;
			sum.dFollowers += row.delta.followers;
		}
		return sum;
	});

	// Of every view on the videos in the list on a platform that gives a skip
	// rate (SKIP_PLATFORMS), the share skipped: each rate weighted by its views.
	const skipInView = $derived(SKIP_PLATFORMS.filter((p) => filter.platforms.includes(p)));
	const pooledSkip = $derived(
		pooledSkipRate(rows.filter((row) => !onlyWhileEditing(row.release)).flatMap((row) => skipPosts(row.release, filter.platforms)))
	);
	const skipShown = (rate: number) => `${rate.toLocaleString('en-GB', { maximumFractionDigits: 1 })} %`;
	const SKIP_WORDS: Partial<Record<StatPlatform, string>> = {
		instagram: 'of its views skipped within the first 3 seconds (Instagram’s estimate)',
		youtube: 'of its plays never became an engaged view (YouTube Analytics)'
	};
	const SKIP_UNKNOWN: Partial<Record<StatPlatform, string>> = {
		instagram: 'not given yet',
		youtube: 'not known yet — YouTube Analytics runs about two days behind'
	};
	const skipAbout =
		'The share of views dropped at the start. Instagram: skipped within the first 3 seconds, its own estimate. ' +
		'YouTube: plays that never became an engaged view (YouTube Analytics, about two days behind; YouTube does not say where that line is, so it is not quite the same 3 seconds). ' +
		'Facebook and TikTok give none.';

	function skipTitle(r: Release): string {
		if (skipInView.length === 0) return 'Neither YouTube nor Instagram is in view';
		const posts = skipPosts(r, filter.platforms);
		if (posts.length === 0) return `No ${skipInView.map((p) => PLATFORMS[p].label).join(' or ')} post`;
		const lines = posts.map(
			(p) =>
				`${PLATFORMS[p.platform].label}: ${p.skipRate == null ? SKIP_UNKNOWN[p.platform] : `${skipShown(p.skipRate)} ${SKIP_WORDS[p.platform]}`}`
		);
		const pooled = skipRateOf(r, filter.platforms);
		if (posts.filter((p) => p.skipRate != null).length > 1 && pooled != null) {
			lines.push(`Together: ${skipShown(pooled)}, each weighted by its views`);
		}
		return lines.join('\n');
	}

	let openKey = $state<string | null>(null);

	// A TikTok cover's address lives a few hours (worker/ttstats.mjs renews the
	// newest ones), so one that no longer loads shows the platform's mark.
	let deadThumbs = $state(new Set<string>());
	function markDead(url: string) {
		if (!deadThumbs.has(url)) deadThumbs = new Set([...deadThumbs, url]);
	}

	/** A brand's menu from the chosen scope, where it was right-clicked. */
	let brandMenu = $state<{ brand: string; x: number; y: number } | null>(null);
	/** The brand whose month over month is open (BrandMonths), from its button's right-click. */
	let brandPanel = $state<string | null>(null);
	let fullRows = $state<Record<string, VideoStats | 'loading' | 'failed'>>({});

	function fullRow(post: Post): VideoStats | null {
		const row = fullRows[post.record];
		return typeof row === 'object' ? row : null;
	}

	/** An opened row's facts: YouTube's once its whole item is read, a reel's at once. */
	function factsFor(post: Post): FactGroup[] | null {
		if (post.platform === 'youtube') {
			const full = fullRow(post);
			return full ? youtubeFacts(full, ago, engagedOf(followerStates, post.id)) : null;
		}
		const reel = reels.find((x) => x.id === post.record);
		return reel ? reelFacts(reel, ago) : null;
	}

	/**
	 * The opened row's thumbnail at its largest, for the player to stand on
	 * until it is started. Only YouTube's 16:9 sizes (maxres, else the list's
	 * medium): the 4:3 ones carry black bars that an upright crop would show.
	 */
	function posterOf(r: Release): string {
		const yt = r.posts.youtube;
		return (yt && fullRow(yt)?.data?.snippet?.thumbnails?.maxres?.url) || r.thumb;
	}

	/** Where a video with no copy on the NAS can still be watched. */
	function watchOf(r: Release): { label: string; url: string } | null {
		const p = ALL_PLATFORMS.find((x) => r.links[x]);
		return p ? { label: `Watch on ${PLATFORMS[p].label}`, url: r.links[p] ?? '' } : null;
	}

	async function toggle(release: Release) {
		if (editing && jestrOn) {
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
	// The periods run up to a year, past the list's timeframe, so they count
	// every video the filter's other choices keep.
	const periods = $derived(periodStats(releases.filter((r) => inView(r, filter)), filter, nowDate, followersInView));
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
	const noteTikTok = $derived(scope ? null : ttAccount);

	// YouTube's units are the Cloud project's, one pool for every channel, so
	// its line is all brands together: the newest read, any channel's error
	// (named), and what the day's units went on.
	const ytBeat = $derived.by(() => {
		if (!status) return null;
		const quota = quotaToday(status, now);
		if (!quota) return null;
		const failing = Object.values(status.channels ?? {}).filter((c) => c?.error);
		const named = (c: { title: string; error: string }, text: string) => (c.title ? `${c.title}: ${text}` : text);
		return {
			polledAt: status.polledAt,
			error: status.error ? shortError(status.error) : failing[0] ? named(failing[0], shortError(failing[0].error)) : '',
			detail: status.error || failing.map((c) => named(c, c.error)).join('\n'),
			quota,
			stop: stopToday(status, now)
		};
	});
	const igBeat = $derived(noteInstagram ? igStatus?.accounts?.[noteInstagram.account_id] : undefined);
	const fbBeat = $derived(noteFacebook ? fbStatus?.pages?.[noteFacebook.account_id] : undefined);
	const ttBeat = $derived(noteTikTok ? tiktokReportOf(ttStatus?.accounts, noteTikTok) : undefined);
	const allowance = $derived(postAllowance(noteInstagram));

	interface StatusLine {
		platform: StatPlatform;
		/** Whose numbers: the account, or every brand for YouTube's shared units. */
		who: string;
		level: StatusLevel;
		read: string;
		/** The error as one line, and as the worker wrote it (the line's tooltip). */
		error: string;
		detail: string;
		limit: { used: number; total: number; words: string } | null;
		note: string;
		/** YouTube's only: what the day's units went on, and the uploads' own count. */
		costs?: { rows: QuotaRow[]; uploads: number | null };
	}

	/** The status icon's popup: a line per platform read, each with its level. */
	const statusLines = $derived.by(() => {
		const lines: StatusLine[] = [];
		if (ytBeat) {
			const { quota } = ytBeat;
			const limit = { used: quota.units, total: quota.ceiling, words: 'units used today' };
			lines.push({
				platform: 'youtube',
				who: brands.multiple ? 'All Brands' : accountOf('youtube'),
				level: lineLevel({ error: ytBeat.error, ...limit }),
				read: ago(ytBeat.polledAt),
				error: ytBeat.error,
				detail: ytBeat.detail,
				limit,
				note: stopWords(ytBeat.stop, quota, now),
				costs: { rows: quota.rows, uploads: quota.uploads }
			});
		}
		if (noteInstagram) {
			const limit = allowance ? { used: allowance.used, total: allowance.total, words: 'posts in the last 24 h' } : null;
			lines.push({
				platform: 'instagram',
				who: accountOf('instagram'),
				level: lineLevel({ error: igBeat?.error, ...limit }),
				read: ago(igBeat?.polledAt),
				error: shortError(igBeat?.error),
				detail: igBeat?.error ?? '',
				limit,
				note: ''
			});
		}
		if (noteTikTok) {
			const missing = ttBeat?.missing ?? [];
			const counts = ttBeat?.counts;
			lines.push({
				platform: 'tiktok',
				who: accountOf('tiktok'),
				// A sign-in without either reading scope is a choice (the scopes are
				// opt-in), not a fault, so it stays neutral; one of the two missing is
				// half a read and shows as such.
				level: lineLevel({ error: ttBeat?.error, partial: missing.length === 1 }),
				read: ago(ttBeat?.polledAt),
				error: shortError(ttBeat?.error),
				detail: ttBeat?.error ?? '',
				limit: null,
				note: !ttBeat
					? 'Not read yet: the worker reads TikTok once the account is signed in with --with-stats'
					: missing.length === 2
						? 'Not read: its sign-in lacks video.list and user.info.stats (pnpm worker:auth --tiktok --with-stats)'
						: missing.length === 1
							? `Partly read: its sign-in lacks ${missing[0]}`
							: counts
								? [
										counts.followers != null ? `${whole.format(counts.followers)} ${followerWord('tiktok', counts.followers)}` : '',
										counts.likes != null ? `${big(counts.likes)} ${counts.likes === 1 ? 'like' : 'likes'}` : '',
										counts.videos != null ? `${whole.format(counts.videos)} ${counts.videos === 1 ? 'video' : 'videos'}` : ''
									]
										.filter(Boolean)
										.join(' · ')
								: ''
			});
		}
		if (noteFacebook) {
			lines.push({
				platform: 'facebook',
				who: accountOf('facebook'),
				level: lineLevel({ error: fbBeat?.error, partial: Boolean(fbBeat?.views) }),
				read: ago(fbBeat?.polledAt),
				error: shortError(fbBeat?.error),
				detail: fbBeat?.error ?? '',
				limit: null,
				note: fbBeat?.views ? `Views not read: ${shortError(fbBeat.views)}` : ''
			});
		}
		return lines;
	});
	const statusLevel = $derived(worstLevel(statusLines.map((line) => line.level)));

	/** The account a platform's numbers are read from, for the status lines: YouTube by channel name, a Page by its name, Instagram and TikTok by handle. */
	function accountOf(p: StatPlatform): string {
		const account = p === 'youtube' ? noteChannel : p === 'facebook' ? noteFacebook : p === 'tiktok' ? noteTikTok : noteInstagram;
		if (!account) return '';
		return p === 'instagram' || p === 'tiktok' ? accountLabel(account) : account.name || accountLabel(account);
	}

	/* ---- words and numbers ---- */

	const whole = new Intl.NumberFormat();
	const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
	const num = (n: number | null | undefined) => (n == null ? '—' : whole.format(n));
	/** Big, but readable: 12,345 up to five digits, 123.4K past them. */
	const big = (n: number) => (n >= 100_000 ? compact.format(n) : whole.format(n));
	/** The period boxes' numbers: 999, then 1k, 1.2k, 85.8k, 102k (shortCount); the popups have them exact. */
	const short = (n: number) => shortCount(n);
	/** The list's counts, shortened the same way; `exact` puts the whole figure on hover. */
	const count = (n: number | null | undefined) => (n == null ? '—' : shortCount(n));
	const exact = (n: number | null | undefined) => (n != null && Math.abs(n) >= 1000 ? whole.format(n) : undefined);

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

	/** Views over usual as a difference: +34 %, −12 %, ±0 %. */
	const againstUsual = (ratio: number) => changeWords(ratio);

	const VERDICT_WORDS = { ahead: 'Ahead of usual', usual: 'About usual', behind: 'Behind usual' };

	function overallTitle(row: Row): string {
		const o = row.overall;
		const names = (list: StatPlatform[]) => list.map((p) => PLATFORMS[p].label).join(', ');
		if (row.judgements.length === 0) return 'Nothing in view to compare';
		if (o.ratio === null || o.verdict === null) return `Nothing to compare yet: ${names(o.left)} — no usual, or no views at that age`;
		const lines = [
			`${VERDICT_WORDS[o.verdict]}, every platform together: ${num(o.views)} views where the usual adds up to ${num(Math.round(o.usual))} (${againstUsual(o.ratio)}) — ${names(o.counted)}`
		];
		if (o.left.length > 0) lines.push(`Left out, with nothing to compare: ${names(o.left)}`);
		lines.push("Each platform at the video's own age, up to its first week; within a fifth either way is about usual.");
		return lines.join('\n');
	}

	function linkTitle(p: PlatformId): string {
		const label = PLATFORMS[p].label;
		return isStatPlatform(p) ? `Open on ${label}` : `Open on ${label} — flock posted it there but does not read its views yet`;
	}

	function matchWords(release: Release): string {
		if (release.matched === 'job') return 'Same flock upload';
		if (release.matched === 'time') return 'Paired by time: posted within two hours of each other';
		return '';
	}

	/** A new column sorts best first; the one already sorted by turns round. */
	function sortBy(key: SortKey) {
		if (sort === key) reversed = !reversed;
		else {
			sort = key;
			reversed = false;
		}
	}

	function sortTitle(key: SortKey, label: string): string {
		return sort === key
			? `Sorted ${sortWords(key, reversed)} — click for ${sortWords(key, !reversed)}`
			: `Sort by ${label.toLowerCase()}, ${sortWords(key, false)}`;
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

{#snippet counter(value: number | null, change: number, cls: string)}
	<span class="num cell {cls}" class:up={change > 0} class:down={change < 0} title={exact(value)}>
		{count(value)}{#if change}<span class="delta">{change > 0 ? '+' : ''}{count(change)}</span>{/if}
	</span>
{/snippet}

<!-- A counter over the platforms in view, and each platform's own under it. -->
{#snippet stacked(row: Row, key: Counter, cls: string, main = false, title = '')}
	{@const change = row.delta[key]}
	<span class="num cell stack {cls}" class:main class:up={change > 0} class:down={change < 0} title={title || undefined}>
		<span title={exact(row[key])}>{count(row[key])}{#if change}<span class="delta">{change > 0 ? '+' : ''}{count(change)}</span>{/if}</span>
		{#if multi && row.posts.length > 1}
			<span class="parts">
				{#each row.posts as post (post.platform)}
					<span title={post[key] == null ? PLATFORMS[post.platform].label : `${PLATFORMS[post.platform].label}: ${whole.format(post[key])}`}
						><i style:background={PLATFORM_COLOURS[post.platform]}></i>{count(post[key])}</span
					>
				{/each}
			</span>
		{:else if main && multi && row.posts.length === 1}
			<span class="parts only">{PLATFORMS[row.posts[0].platform].label} only</span>
		{/if}
	</span>
{/snippet}

{#snippet sortHead(key: SortKey, label: string, cls = '', about = '')}
	<button
		class="colhead {cls}"
		class:on={sort === key}
		onclick={() => sortBy(key)}
		title={about ? `${about}\n\n${sortTitle(key, label)}` : sortTitle(key, label)}
	>
		{label}{#if sort === key}<span class="arrow" aria-hidden="true">{reversed ? '↑' : '↓'}</span>{/if}
	</button>
{/snippet}

<!-- The list's cells, one snippet per row kind, drawn in the order Settings → Dashboard gives (dashcolumns.ts). -->
{#snippet headCell(col: ColumnId)}
	{#if col === 'thumb'}
		<span class={cellOf(col)}></span>
	{:else if col === 'video'}
		{@render sortHead('date', 'Video', `left ${cellOf(col)}`)}
	{:else if col === 'jestr'}
		<span class="colhead plain jcell {cellOf(col)}" title="Jestr campaign videos">Jestr</span>
	{:else if col === 'followers'}
		{@render sortHead('followers', 'Followers', cellOf(col), followersAbout)}
	{:else if col === 'views'}
		{@render sortHead('views', 'Views', cellOf(col))}
	{:else if col === 'likes'}
		{@render sortHead('likes', 'Likes', cellOf(col))}
	{:else if col === 'comments'}
		{@render sortHead('comments', 'Comments', cellOf(col))}
	{:else if col === 'skip'}
		{@render sortHead('skip', 'Skipped', cellOf(col), skipAbout)}
	{:else if col === 'curve'}
		<span class="colhead {cellOf(col)}" title="Views from release, up to its first week; dashed: the usual for its kind">From release</span>
	{:else if col === 'usual'}
		{@render sortHead(
			'usual',
			'vs usual',
			cellOf(col),
			"Views against the usual for the kind at the same age. On top every platform in view together — their views added up against their usuals added up — and under it each platform's own. Within a fifth either way is about usual."
		)}
	{/if}
{/snippet}

{#snippet totalCell(col: ColumnId)}
	{#if col === 'video'}
		<span class="vid {cellOf(col)}">
			<span class="vtitle">Total</span>
			<span class="vmeta"
				>{counted} {counted === 1 ? 'video' : 'videos'}{#if editOnly}&nbsp;· {editOnly} hidden{/if}</span
			>
		</span>
	{:else if col === 'jestr'}
		<span class="jcell num cell {cellOf(col)}" title="Jestr campaign videos among them">{campaignCount}</span>
	{:else if col === 'followers'}
		{@render counter(totals.followers, totals.dFollowers, cellOf(col))}
	{:else if col === 'views'}
		{@render counter(totals.views, totals.dViews, cellOf(col))}
	{:else if col === 'likes'}
		{@render counter(totals.likes, totals.dLikes, cellOf(col))}
	{:else if col === 'comments'}
		{@render counter(totals.comments, totals.dComments, cellOf(col))}
	{:else if col === 'skip'}
		<span
			class="num cell skip {cellOf(col)}"
			title={pooledSkip === null
				? 'No skip rate among the videos in view'
				: `Of all the ${skipInView.map((p) => PLATFORMS[p].label).join(' and ')} views on these videos, ${skipShown(pooledSkip)} were skipped at the start (each video's rate weighted by its views)`}
			>{#if skipInView.length === 1}<i style:background={PLATFORM_COLOURS[skipInView[0]]}></i>{/if}{pooledSkip === null
				? '—'
				: skipShown(pooledSkip)}</span
		>
	{:else}
		<span class={cellOf(col)}></span>
	{/if}
{/snippet}

{#snippet rowCell(col: ColumnId, row: Row)}
	{@const r = row.release}
	{#if col === 'thumb'}
		{#if r.thumb && !deadThumbs.has(r.thumb)}
			<img class="thumb {cellOf(col)}" src={r.thumb} alt="" loading="lazy" onerror={() => markDead(r.thumb)} />
		{:else}
			<span class="thumb blank {cellOf(col)}"
				><PlatformIcon
					platform={r.posts.youtube ? 'youtube' : r.posts.instagram ? 'instagram' : r.posts.tiktok ? 'tiktok' : r.posts.facebook ? 'facebook' : 'youtube'}
					size={16}
				/></span
			>
		{/if}
	{:else if col === 'video'}
		{@const visibility = visibilityOf(r, filter.platforms)}
		{@const note = renameNote(r)}
		<span class="vid {cellOf(col)}">
			<span class="vtitle">{r.title}</span>
			<span class="vmeta">
				{#if note.waiting.length > 0}
					<span
						class="rnote wait"
						title="Asked: {note.waiting.map((n) => `${PLATFORMS[n.platform]?.label ?? n.platform} “${n.title}”`).join(', ')} — waiting for the worker"
						>renaming…</span
					><span class="dot">·</span>
				{/if}
				{#if note.refused.length > 0}
					<span class="rnote bad" title={note.refused.map((n) => `${PLATFORMS[n.platform]?.label ?? n.platform}: ${n.error}`).join('\n')}
						>not renamed</span
					><span class="dot">·</span>
				{/if}
				<span title={new Date(r.at).toLocaleString()}>{released(r.at)} · {span(now - r.at)} ago</span>
				<span class="dot">·</span>{KIND_ONE[r.kind]}{#if r.duration > 0}&nbsp;{formatDuration(r.duration)}{/if}
				{#if visibility !== 'public'}
					<span class="dot">·</span><span class="priv {visibility}">{visibility}</span>
				{/if}
				{#if r.hidden}
					<span class="dot">·</span><span class="hid" title="Hidden in Edit mode: shown only while the filter's Hidden is on, and never part of the usual">hidden</span>
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
	{:else if col === 'jestr'}
		{@const campaign = campaigns.has(r.key)}
		{@const marking = editing && jestrOn}
		<span
			class="jcell {cellOf(col)}"
			class:on={campaign}
			title={campaign ? 'A Jestr campaign video' : marking && !markable(r) ? 'Facebook only: not a Jestr submission' : ''}
		>
			{#if campaign || (marking && markable(r))}
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
					<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" class="box" />
					{#if campaign}<path d="M4.5 8.2 7 10.6l4.6-5" class="tick" />{/if}
				</svg>
			{/if}
		</span>
	{:else if col === 'followers'}
		{@render stacked(row, 'followers', cellOf(col), false, followersTitle(row))}
	{:else if col === 'views'}
		{@render stacked(row, 'views', cellOf(col), true)}
	{:else if col === 'likes'}
		{@render stacked(row, 'likes', cellOf(col))}
	{:else if col === 'comments'}
		{@render stacked(row, 'comments', cellOf(col))}
	{:else if col === 'skip'}
		<!-- One platform: its rate behind its dot; two: the rate over both, each under it as the counters have. -->
		{@const posts = skipPosts(r, filter.platforms)}
		<span class="num cell stack skip {cellOf(col)}" class:none={row.skip === null} title={skipTitle(r)}>
			{#if posts.length > 1}
				<span>{row.skip === null ? '—' : skipShown(row.skip)}</span>
				<span class="parts">
					{#each posts as post (post.platform)}
						<span><i style:background={PLATFORM_COLOURS[post.platform]}></i>{post.skipRate == null ? '—' : skipShown(post.skipRate)}</span>
					{/each}
				</span>
			{:else}
				<span class="one"
					>{#if posts.length === 1}<i style:background={PLATFORM_COLOURS[posts[0].platform]}></i>{/if}{row.skip === null
						? '—'
						: skipShown(row.skip)}</span
				>
			{/if}
		</span>
	{:else if col === 'curve'}
		<span class="spark {cellOf(col)}"><ViewsCurve curves={row.curves} /></span>
	{:else if col === 'usual'}
		<!-- Every platform together on top, each one under it behind its square, as the counters have. -->
		{@const overall = row.overall}
		<span class="num cell stack verdicts {cellOf(col)}">
			<span class="judged overall {overall.verdict ?? 'none'}" title={overallTitle(row)}>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
					<path d={TREND[overall.verdict ?? 'none']} />
				</svg>
				{#if overall.ratio !== null}<span class="against">{againstUsual(overall.ratio)}</span>{/if}
			</span>
			{#if row.judgements.length > 1}
				<span class="parts">
					{#each row.judgements as j (j.platform)}
						<span class="judged {j.verdict ?? 'none'}" title={judgementTitle(j, r)}>
							<i style:background={PLATFORM_COLOURS[j.platform]}></i>
							<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
								<path d={TREND[j.verdict ?? 'none']} />
							</svg>
						</span>
					{/each}
				</span>
			{/if}
		</span>
	{/if}
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
						class="brandchip hint"
						class:on={!scope && brand.id === brands.currentId}
						role="radio"
						aria-checked={!scope && brand.id === brands.currentId}
						style:--chip={scope ? sets.find((set) => set.label === brand.name)?.colour : undefined}
						class:tinted={Boolean(scope && sets.find((set) => set.label === brand.name)?.colour)}
						title="Right-click for {brand.name}'s month over month"
						onclick={() => {
							for (const s of devtestDashboardScopes) s.release();
							brands.select(brand.id);
						}}
						oncontextmenu={(e) => {
							e.preventDefault();
							// A local scope's own menu, while it is chosen, offers the panel in turn.
							if (scope?.BrandMenu) brandMenu = { brand: brand.id, x: e.clientX, y: e.clientY };
							else brandPanel = brand.id;
						}}
						>{brand.name}<span class="rclick" aria-hidden="true"
							><i></i><svg viewBox="0 0 16 16" width="18" height="18"
								><rect x="3.5" y="1.5" width="9" height="13" rx="4.5" /><path d="M8 1.5V7M3.5 7h9" /><path
									class="lit"
									d="M8.6 2.1a3.9 3.9 0 0 1 3.3 3.9v.4H8.6z"
								/></svg
							></span
						></button
					>
				{/each}
			</div>
			{#if scope?.BrandMenu && brandMenu}
				{@const id = brandMenu.brand}
				<scope.BrandMenu
					brand={id}
					x={brandMenu.x}
					y={brandMenu.y}
					close={() => (brandMenu = null)}
					open={() => {
						brandMenu = null;
						brandPanel = id;
					}}
				/>
			{/if}
			{#if brandPanel}
				<BrandMonths brand={brandPanel} onclose={() => (brandPanel = null)} />
			{/if}
		{/if}
		<div class="aside">
			<!-- When each platform was read and what is left of the day, behind one
			     icon coloured by the worst of it; hover or focus shows the lines. -->
			{#if statusLines.length > 0}
				<div class="status">
					<button
						class="btn icon info {statusLevel}"
						aria-label="Status: {LEVEL_WORDS[statusLevel]}"
						aria-describedby="dash-status"
					>
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
							<circle cx="8" cy="8" r="6.5" />
							<path d="M8 7.2v4.3" />
							<circle class="dot" cx="8" cy="4.9" r="0.95" />
						</svg>
					</button>
					<div class="pop" id="dash-status" role="tooltip">
						{#each statusLines as line (line.platform)}
							{@const account = line.who}
							<div class="sline {line.level}">
								<span class="sicon"><PlatformIcon platform={line.platform} size={13} /></span>
								<div class="sbody">
									<p class="shead">
										<strong>{PLATFORMS[line.platform].label}</strong>{#if account}<em>{account}</em>{/if}
										<span class="sread">read {line.read}</span>
									</p>
									{#if line.error}
										<p class="serror" title={line.detail}>{line.error}</p>
									{/if}
									{#if line.limit}
										<p class="slimit">
											<span class="meter {limitLevel(line.limit.used, line.limit.total)}"
												><i style:width="{Math.min(100, (line.limit.used / line.limit.total) * 100)}%"></i></span
											>
											{big(line.limit.used)} of {big(line.limit.total)} {line.limit.words}
										</p>
									{/if}
									{#if line.note}
										<p class="snote">{line.note}</p>
									{/if}
									{#if line.costs}
										<!-- What the day's units went on: what each costs, and what it took today. -->
										<div class="costs" role="table" aria-label="What today's units went on">
											<div class="crow chead" role="row">
												<span role="columnheader">Spent on</span>
												<span role="columnheader">Costs</span>
												<span role="columnheader">Today</span>
											</div>
											{#each line.costs.rows as row (row.kind)}
												<div class="crow" class:none={row.units === 0} role="row">
													<span role="cell">{row.label}</span>
													<span role="cell">{row.cost}</span>
													<span role="cell">{whole.format(row.units)}</span>
												</div>
											{/each}
											{#if line.costs.uploads !== null}
												<div class="crow uploads" class:none={line.costs.uploads === 0} role="row">
													<span role="cell">Uploading a video</span>
													<span role="cell">own allowance</span>
													<span role="cell">{whole.format(line.costs.uploads)} of {UPLOADS_A_DAY}</span>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<button
				class="btn icon edit"
				class:armed={editArmed}
				class:on={editing}
				aria-pressed={editing}
				aria-label={editing ? 'Stop editing' : editArmed ? 'Press again to edit' : 'Edit'}
				onclick={onEditClick}
				onblur={disarmEdit}
				title={editing
					? 'Stop editing'
					: editArmed
						? 'Press again to edit'
						: `Rename or hide videos${jestrOn ? ', mark Jestr campaigns' : ''} (press twice)`}
			>
				{#if editing}
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect class="fill" x="3.5" y="3.5" width="9" height="9" rx="1.5" /></svg>
				{:else if editArmed}
					<span class="ask" aria-hidden="true">?</span>
				{:else}
					<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
						<path d="M10.6 2.6 13.4 5.4 5.6 13.2H2.8V10.4zM9.1 4.1 11.9 6.9" />
					</svg>
				{/if}
			</button>
			<button
				class="btn icon refresh"
				class:spinning={loading || refreshing}
				class:due={refreshRed}
				onclick={onRefresh}
				disabled={loading || refreshing}
				aria-label={refreshRed ? "Refresh: YouTube's numbers are over 5 minutes old" : 'Refresh'}
				title={refreshRed
					? `YouTube's automatic reads stopped at ${status?.budget?.toLocaleString() ?? ''} units today, and its numbers are over 5 minutes old. Press to read them now, and reset the change markers`
					: 'Read everything again, and reset the change markers'}
			>
				<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
					<path d="M13.2 6.4A5.4 5.4 0 0 0 3.3 5.1M2.8 9.6a5.4 5.4 0 0 0 9.9 1.3" />
					<path d="M3.1 2.4v2.9H6M12.9 13.6v-2.9H10" />
				</svg>
			</button>
		</div>
	</div>

	{#if error}
		<p class="banner bad">Could not reach PocketBase — {error}</p>
	{/if}

	<section class="card periods" aria-label="Numbers by period">
		{#each periods as period (period.key)}
			<div class="period">
				<h2>{period.label}</h2>
				<div class="trio">
					<div>
						<span class="bignum accent">{short(period.released)}</span>
						<span class="unit">{period.released === 1 ? 'video out' : 'videos out'}</span>
					</div>
					<!-- The views' gains and each platform's share, on hover or focus. -->
					<div class="hold">
						<button class="holdnum" aria-describedby="views-{period.key}">
							<span class="bignum">{short(period.views)}</span>
							<span class="unit">views on them</span>
						</button>
						<div class="ppop" id="views-{period.key}" role="tooltip">
							<p class="gained"><strong class="exact">{whole.format(period.views)}</strong> views on the videos out</p>
							<p class="gained">
								<strong>+{whole.format(period.gained)}</strong> views gained{period.partly ? ' (at least)' : ''}
							</p>
							<p class="pnote">
								Views every video in view gained since the start of the period{period.partly
									? '. Some were not read yet at its start, so they count from when flock first read them.'
									: '.'}
							</p>
							{#each filter.platforms as p (p)}
								<p class="pline">
									<i style:background={PLATFORM_COLOURS[p]}></i>
									<span class="pname">{PLATFORMS[p].label}</span>
									{#if viewsUnread.has(p)}
										<span class="pval">views not read yet</span>
									{:else}
										<span class="pval">{whole.format(period.byPlatform[p].views)} on the videos out</span>
										<strong>+{whole.format(period.byPlatform[p].gained)}</strong>
									{/if}
								</p>
							{/each}
						</div>
					</div>
					<div class="hold">
						<button class="holdnum" aria-describedby="followers-{period.key}">
							<span class="bignum" class:faint={!period.followers}
								>{period.followers ? signedShort(period.followers.gained) : '—'}</span
							>
							<span class="unit">follows</span>
						</button>
						<div class="ppop" id="followers-{period.key}" role="tooltip">
							<p class="gained">
								{#if period.followers}
									<strong class:down={period.followers.gained < 0}>{signed(period.followers.gained)}</strong> followers and
									subscribers{period.followers.partly ? ' (since flock began reading them)' : ''}
								{:else}
									No follower counts read yet
								{/if}
							</p>
							<p class="pnote">How far the accounts' counts moved since the start of the period: followers won less followers lost.</p>
							{#each filter.platforms as p (p)}
								{@const gain = period.byPlatform[p].followers}
								<p class="pline">
									<i style:background={PLATFORM_COLOURS[p]}></i>
									<span class="pname">{PLATFORMS[p].label}</span>
									<span class="pval">{gainWords(gain, p)}</span>
								</p>
							{/each}
						</div>
					</div>
				</div>
			</div>
		{/each}
	</section>

	{#if noChannel}
		<p class="banner">
			{brands.multiple ? `${brands.current?.name ?? 'This brand'} has` : 'There is'} no YouTube channel chosen.
			<a href="{base}/settings?section=brands">Choose one in Settings → Brands</a>.
		</p>
	{/if}

	{#if editing}
		<p class="banner editing">
			<strong>EDITING VIDEOS</strong> — Press the pencil beside a title to rename that video on every platform it
			is on, or on some only; the worker renames it within seconds. The eye hides a video from the Dashboard —
			the list, the totals, the periods and the usual; while editing, hidden ones stay in the list, faded, so the eye
			can show one again. <em>Hidden</em> in the filter shows them outside Edit mode too.
			{#if jestrOn}Click a video to mark it as a Jestr campaign, or to take the mark off.{/if}
			Press <strong>■</strong> when finished.
			{#if lastHidden}
				<span class="undo">Hid “{lastHidden.title}” <button onclick={undoHide}>Undo</button></span>
			{/if}
			{#if jestrCampaigns.error}<span class="bad">Not saved: {jestrCampaigns.error}</span>{/if}
			{#if hiddenVideos.error}<span class="bad">Not saved: {hiddenVideos.error}</span>{/if}
		</p>
	{/if}

	<!-- The cells follow the layout set under Settings → Dashboard (dashcolumns.ts);
	     each carries its column's class, so the narrower lists can leave some out. -->
	<section
		class="card list"
		class:editing
		class:nothumb={!columns.includes('thumb')}
		aria-label="Every video"
		style:--cols={grids.wide}
		style:--cols-mid={grids.mid}
		style:--cols-narrow={grids.narrow}
	>
		<div class="row cols">
			{#each columns as col (col)}{@render headCell(col)}{/each}
		</div>
		<div class="row total">
			{#each columns as col (col)}{@render totalCell(col)}{/each}
		</div>

		{#each rows as row (row.release.key)}
			{@const r = row.release}
			{@const campaign = campaigns.has(r.key)}
			{@const marking = editing && jestrOn}
			<div class="item" class:open={openKey === r.key} class:tinted={Boolean(r.tint)} class:hiddenvideo={r.hidden} style:--tint={r.tint}>
				<!-- The pencil and the eye sit over the row, not in it: a button cannot hold another. -->
				<div class="line">
					<button
						class="row"
						onclick={() => toggle(r)}
						aria-expanded={marking ? undefined : openKey === r.key}
						aria-pressed={marking && markable(r) ? campaign : undefined}
						aria-disabled={marking && !markable(r) ? true : undefined}
					>
						{#each columns as col (col)}{@render rowCell(col, row)}{/each}
					</button>
					{#if editing}
						<button class="rename" onclick={() => openRename(r)} title="Rename this video" aria-label="Rename “{r.title}”">
							<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
								<path d="M10.6 2.6 13.4 5.4 5.6 13.2H2.8V10.4zM9.1 4.1 11.9 6.9" />
							</svg>
						</button>
						<button
							class="eye"
							class:shut={r.hidden}
							onclick={() => toggleHidden(row)}
							title={eyeTitle(row)}
							aria-label={r.hidden ? `Show “${r.title}” again` : `Hide “${r.title}”`}
						>
							<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
								{#if r.hidden}
									<path d="M2 6.6s2.2 3.4 6 3.4 6-3.4 6-3.4M4.1 9.3 3 10.9M8 10v1.9M11.9 9.3l1.1 1.6" />
								{:else}
									<path d="M1.6 8S4 3.8 8 3.8 14.4 8 14.4 8 12 12.2 8 12.2 1.6 8 1.6 8z" />
									<circle cx="8" cy="8" r="2.1" />
								{/if}
							</svg>
						</button>
					{/if}
				</div>

				{#if openKey === r.key}
					<div class="details">
						<div class="lead">
							<NasPlayer
								job={r.job}
								title={r.title}
								poster={posterOf(r)}
								upright={r.kind === 'short'}
								duration={r.duration}
								watch={watchOf(r)}
							/>
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
				{releases.length === 0
					? 'No videos read yet. They appear once the worker has read the channel.'
					: spanned.length === 0
						? `Nothing went out in the last ${filter.days} days. Choose a longer timeframe in the filter.`
						: 'Nothing to show with these choices.'}
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
		Views, likes and comments are each platform's own counters.
		{combined || multi ? 'Sums across platforms, ' : ''}"usual", the verdicts and the curves are flock's arithmetic over them,
		not figures any platform reports. A video's followers are Facebook's own count for a reel and YouTube Analytics' for a
		video; for Instagram and TikTok, which only report how many an account has, and for YouTube's newest days they are
		flock's estimate: each rise is credited to the videos gaining views at the time. TikTok lists public videos only. One
		channel at a time; nothing is added up across channels.
	</p>
</div>

{#if renaming}
	<RenameDialog
		name={renaming.release.title}
		choices={renaming.choices}
		job={renaming.release.job}
		onclose={() => (renaming = null)}
	/>
{/if}

<style>
	/* As wide as the Upload page's content: the overlay's own padding is the
	   only margin. */
	.page {
		width: 100%;
		max-width: none;
		margin: 0;
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
		position: relative;
		display: inline-flex;
		align-items: center;
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

	/* Hovered, a chip grows a mouse with its right button lit: right-click opens
	   the brand's month over month. The growth is drawn over the next chip, not
	   laid out: nothing beside it moves, and the pointer passes through it, so
	   the next chip is hovered as soon as the pointer is on it. Opaque, and in
	   the chip's own border and, for the chosen one, the gradient's end colour. */
	.rclick {
		position: absolute;
		top: -1px;
		bottom: -1px;
		left: calc(100% - 12px);
		display: inline-flex;
		align-items: center;
		padding: 0 10px 0 0;
		border: 1px solid var(--pink-soft);
		border-left: 0;
		border-radius: 0 999px 999px 0;
		background: var(--bg-elev);
		pointer-events: none;
		opacity: 0;
		clip-path: inset(0 100% 0 0);
		transition:
			opacity 0.16s,
			clip-path 0.16s;
	}

	.hint.on .rclick {
		border-color: var(--pink);
		background: linear-gradient(rgba(255, 77, 158, 0.18), rgba(255, 77, 158, 0.18)), var(--bg-elev);
	}

	.hint.tinted:not(.on) .rclick {
		border-color: color-mix(in srgb, var(--chip) 70%, transparent);
	}

	.rclick i {
		flex: none;
		width: 1px;
		height: 16px;
		margin: 0 6px 0 9px;
		background: var(--border-strong);
	}

	.rclick svg {
		flex: none;
		fill: none;
		stroke: var(--text-dim);
		stroke-width: 1.15;
	}

	.rclick .lit {
		fill: var(--pink-soft);
		stroke: none;
	}

	/* Set apart while it shows: a blurred outline straight underneath, round the
	   chip and its growth together (a filter takes in the drawn-over part, a
	   box-shadow would not). */
	.hint {
		transition:
			border-color 0.14s,
			background 0.14s,
			color 0.14s,
			filter 0.16s;
	}

	.hint:hover,
	.hint:focus-visible {
		z-index: 2;
		filter: drop-shadow(0 0 2px #000) drop-shadow(0 0 7px #000) drop-shadow(0 0 14px #000);
	}

	/* On the same ground as its growth, so the two meet without a seam. */
	.hint:not(.on):hover,
	.hint:not(.on):focus-visible {
		background: var(--bg-elev);
	}

	.hint.on:hover,
	.hint.on:focus-visible {
		background: var(--accent-grad-soft), var(--bg-elev);
	}

	.hint:hover .rclick,
	.hint:focus-visible .rclick {
		opacity: 1;
		clip-path: inset(0 0 0 0);
	}

	@media (prefers-reduced-motion: reduce) {
		.brandchip,
		.rclick {
			transition: none;
		}
	}

	.aside {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}

	/* Square icon buttons: the status, Edit and Refresh. */
	.icon {
		flex: none;
		width: 32px;
		height: 32px;
		padding: 0;
		border-radius: var(--radius-sm);
		color: var(--text-dim);
	}

	.icon:hover:not(:disabled) {
		color: var(--text);
	}

	.icon svg path,
	.icon svg circle {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.icon svg .dot,
	.icon svg .fill {
		fill: currentColor;
		stroke: none;
	}

	.ask {
		font-size: 16px;
		font-weight: 800;
		line-height: 1;
	}

	.refresh.spinning svg {
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.refresh.spinning svg {
			animation: none;
		}
	}

	/* The status colours: green all good, yellow a limit half used, orange
	   nearly used (or something to look at), red an error or a limit used up. */
	.info.ok,
	.sline.ok,
	.meter.ok {
		--level: var(--ok);
	}

	.info.half,
	.sline.half,
	.meter.half {
		--level: #facc15;
	}

	.info.close,
	.sline.close,
	.meter.close {
		--level: #fb923c;
	}

	.info.bad,
	.sline.bad,
	.meter.bad {
		--level: #ef4444;
	}

	.info,
	.info:hover:not(:disabled) {
		color: var(--level);
	}

	.info {
		border-color: color-mix(in srgb, var(--level) 40%, var(--border-strong));
	}

	.info:hover:not(:disabled),
	.status:focus-within .info {
		border-color: var(--level);
	}

	.status {
		position: relative;
	}

	.pop {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 30;
		display: grid;
		gap: 12px;
		width: max-content;
		min-width: 280px;
		max-width: min(400px, calc(100vw - 40px));
		padding: 12px 14px;
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

	/* Bridges the gap to the icon, so the pointer can move onto the popup. */
	.pop::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -9px;
		height: 9px;
	}

	.status:hover .pop,
	.status:focus-within .pop {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition:
			opacity 0.14s,
			transform 0.14s;
	}

	.sline {
		display: grid;
		grid-template-columns: 13px minmax(0, 1fr);
		gap: 9px;
		align-items: start;
	}

	.sicon {
		display: flex;
		padding-top: 2px;
	}

	.sbody {
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.sbody p {
		margin: 0;
	}

	.shead {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 6px;
	}

	.shead strong {
		color: var(--text);
		font-weight: 600;
	}

	.shead em {
		font-style: normal;
		color: var(--text-faint);
	}

	.sread {
		margin-left: auto;
		padding-left: 10px;
		font-size: 11px;
		color: var(--text-faint);
	}

	.serror,
	.snote {
		color: var(--level);
		line-height: 1.45;
	}

	.slimit {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.meter {
		flex: none;
		width: 64px;
		height: 5px;
		border-radius: 3px;
		background: var(--border);
		overflow: hidden;
	}

	.meter i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--level);
	}

	/* YouTube's units by what they went on: one grid, the rows its contents. */
	.costs {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 2px 14px;
		margin-top: 4px;
		padding-top: 7px;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
	}

	.crow {
		display: contents;
	}

	.crow span:nth-child(n + 2) {
		text-align: right;
		white-space: nowrap;
	}

	.chead span {
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.crow.none span {
		color: var(--text-faint);
	}

	.crow.uploads span {
		padding-top: 5px;
	}

	/* Refresh, once the automatic YouTube reads have stopped and the numbers aged. */
	.refresh.due {
		color: #ef4444;
		border-color: #ef4444;
		background: color-mix(in srgb, #ef4444 12%, transparent);
	}

	.refresh.due:hover:not(:disabled) {
		color: #ff6b6b;
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

	.banner a {
		color: var(--pink-soft);
	}

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

	/* ---- the period numbers ---- */

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
		grid-template-columns: repeat(5, minmax(0, 1fr));
		margin-bottom: 14px;
		padding: 14px 0;
		container-type: inline-size;
	}

	/* Each box sizes its numbers to itself, so five of them never crowd. */
	.period {
		min-width: 0;
		padding: 0 18px;
		container-type: inline-size;
	}

	.period + .period {
		border-left: 1px solid var(--border);
	}

	/* Each number as wide as it is, spread over the box: equal thirds let
	   "166.2k" run into the followers beside it. */
	.trio {
		display: grid;
		grid-template-columns: repeat(3, auto);
		justify-content: space-between;
		gap: 10px;
	}

	/* A number whose details open on hover or focus. No min-width: 0 — the
	   number's own width is the column's floor. */
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
	.period:nth-last-child(-n + 2) .ppop {
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

	.ppop .gained {
		margin: 0;
		font-size: 12.5px;
		color: var(--text);
	}

	.ppop .pnote {
		margin-bottom: 4px;
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
	.ppop .gained strong {
		color: var(--ok);
		font-weight: 650;
	}

	.ppop strong.exact {
		color: var(--text);
	}

	.ppop strong.down {
		color: var(--warn);
	}

	.bignum {
		display: block;
		font-size: clamp(20px, 11cqi, 32px);
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
		font-size: 11.5px;
		color: var(--text-dim);
	}


	.none {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	/* ---- the list ---- */

	/* One grid for the whole list, which every row takes up as a subgrid, so a
	   column sized to its content is as wide as its widest cell in any row. */
	.list {
		/* The thumbnail's column, which the pencil in Edit mode sits beside. */
		--thumbcol: 64px;
		display: grid;
		/* Built from the layout (dashcolumns.ts): "vs usual" holds four platforms' marks. */
		grid-template-columns: var(--cols);
		column-gap: 12px;
		overflow: hidden;
		padding: 0 16px;
	}

	.item,
	.line,
	.row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: subgrid;
	}

	/* A row reaches the card's edges; its padding puts the cells back on the list's grid. */
	.row {
		align-items: center;
		margin-inline: -16px;
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
	.item.open > .line > .row {
		background: var(--surface-2);
	}

	.jcell {
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

	/* Edit mode looks as the Calendar's does: the button pink while armed, the
	   accent once on, and the banner in pink above the list. */
	.edit.armed {
		background: var(--pink-hot);
		border-color: transparent;
		color: #fff;
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.edit.on {
		background: var(--accent-grad);
		border-color: transparent;
		color: #fff;
	}

	.banner.editing {
		background: var(--pink);
		border-color: var(--pink);
		color: var(--bg);
		font-weight: 500;
	}

	.banner.editing strong {
		font-weight: 800;
		letter-spacing: 0.04em;
	}

	.banner.editing .bad {
		margin-left: 8px;
		padding: 1px 7px;
		border-radius: 6px;
		background: var(--bg);
		color: var(--danger);
	}

	/* The pencil beside a title, over the row rather than in it. */
	.line {
		position: relative;
	}

	/* Room for the pencil and the eye before the title. */
	.editing .line .vid {
		padding-left: 60px;
	}

	.rename {
		position: absolute;
		top: 50%;
		left: calc(var(--thumbcol) + 12px);
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		transform: translateY(-50%);
		border: 1px solid var(--pink);
		border-radius: 7px;
		background: var(--accent-grad-soft);
		color: var(--pink-soft);
		transition:
			background 0.14s,
			color 0.14s;
	}

	/* With the thumbnail hidden, the title starts at the row's edge. */
	.nothumb .rename {
		left: 0;
	}

	.nothumb .details {
		padding-left: 16px;
	}

	.rename:hover {
		background: var(--accent-grad);
		color: #fff;
	}

	.rename svg path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* The eye, right before the title: open while the video is shown, shut once hidden. */
	.eye {
		position: absolute;
		top: 50%;
		left: calc(var(--thumbcol) + 12px + 28px);
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		transform: translateY(-50%);
		border: 1px solid var(--border-strong);
		border-radius: 7px;
		background: var(--surface);
		color: var(--text-dim);
		transition:
			border-color 0.14s,
			background 0.14s,
			color 0.14s;
	}

	.nothumb .eye {
		left: 28px;
	}

	.eye:hover {
		border-color: var(--pink);
		color: var(--text);
	}

	.eye.shut {
		border-color: var(--warn);
		background: color-mix(in srgb, var(--warn) 16%, transparent);
		color: var(--warn);
	}

	.eye svg path,
	.eye svg circle {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.banner.editing .undo {
		margin-left: 8px;
		padding: 1px 4px 1px 8px;
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
	}

	.banner.editing .undo button {
		margin-left: 4px;
		padding: 0 4px;
		font: inherit;
		font-weight: 700;
		color: var(--pink-soft);
	}

	.rnote {
		font-weight: 650;
	}

	.rnote.wait {
		color: var(--pink-soft);
	}

	.rnote.bad {
		color: var(--warn);
	}

	/* A group's colour (a local scope's, see devtest.ts) washes its rows. */
	.item.tinted > .line > .row {
		background: color-mix(in srgb, var(--tint) 13%, transparent);
	}

	.item.tinted > .line > button.row:hover,
	.item.tinted.open > .line > .row {
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

	.hid {
		font-weight: 650;
		color: var(--warn);
	}

	/* A hidden video, shown by the filter or while editing: its picture and
	   title fade. Never the platform marks — their brands forbid greying them. */
	.item.hiddenvideo img.thumb {
		opacity: 0.4;
	}

	.item.hiddenvideo .vtitle {
		color: var(--text-faint);
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

	/* A column as wide as its widest cell keeps some room before it, so its
	   numbers never run on from the column to its left. */
	.row > .fit {
		padding-left: 12px;
	}

	/* The skip rate: a lone platform's behind its dot, as the counters have under their sums. */
	.row.total .skip,
	.skip .one {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 5px;
	}

	.skip i {
		width: 6px;
		height: 6px;
	}

	.skip.none {
		color: var(--text-faint);
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

	/* Wraps only where a column has a fixed width too narrow for it (below 1200 px). */
	.parts {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 1px 7px;
		font-size: 10.5px;
		font-weight: 500;
		color: var(--text-faint);
	}

	.parts i {
		width: 6px;
		height: 6px;
	}

	/* Right-bound like every other column: the curve is narrower than its column. */
	.spark {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 0;
	}

	/* A platform's square and, after it, how the video stands there against usual;
	   on top, every platform together, its arrow and by how much. */
	.judged {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-dim);
	}

	.judged.overall {
		gap: 5px;
		font-weight: 600;
	}

	.parts .judged {
		gap: 4px;
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
		grid-column: 1 / -1;
		margin: 0 -16px;
		padding: 16px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-faint);
	}

	/* ---- an opened row ---- */

	.details {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 12px 28px;
		margin-inline: -16px;
		padding: 10px 16px 18px 92px;
		border-top: 1px dashed var(--border);
		background: var(--surface-2);
	}

	/* The player beside the curve, across the top of an opened row. */
	.lead {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: auto minmax(0, 980px);
		align-items: start;
		gap: 14px 28px;
		padding-top: 6px;
	}

	.chart {
		min-width: 0;
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

	/* Five boxes need about 230px each; below that they go three to a row. */
	@media (max-width: 1440px) {
		.periods {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			row-gap: 14px;
		}
		.period:nth-child(3n + 1) {
			border-left: 0;
		}
		.period:nth-child(3n) .ppop {
			left: auto;
			right: 0;
		}
		.period:nth-child(n + 4) {
			padding-top: 12px;
			border-top: 1px solid var(--border);
		}
	}

	@media (max-width: 1200px) {
		.list {
			--thumbcol: 56px;
			grid-template-columns: var(--cols-mid);
		}
		/* Fixed widths here (dashcolumns.ts): each platform's numbers wrap instead. */
		.row > .fit {
			padding-left: 0;
		}
		/* Likes, comments and the skip rate go; an opened row still lists them. */
		.row > .midoff {
			display: none;
		}
		.details {
			padding-left: 16px;
		}
	}

	@media (max-width: 960px) {
		.lead {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.aside {
			margin-left: 0;
		}
		.pop {
			right: auto;
			left: 0;
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
		.period .hold:last-child .ppop {
			left: auto;
			right: 0;
		}
		.row > .narrowoff {
			display: none;
		}
		.list {
			--thumbcol: 48px;
			grid-template-columns: var(--cols-narrow);
		}
		.thumb {
			width: 48px;
			height: 27px;
		}
	}
</style>
