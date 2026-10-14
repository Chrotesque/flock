<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import PlatformIcon from './PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { portal } from '$lib/portal';
	import { upcoming, type DashTarget } from '$lib/dashboard';
	import { uploadsOfDay, type ComingUpload } from '$lib/releases';

	/**
	 * The next three days, condensed (the Calendar has the rest): a row per day, an upload a cluster of
	 * platform coins in the order of its first slot. Hovering (or focusing) a
	 * cluster opens a card with its title and each post's time and state; a
	 * click opens the upload's overview.
	 */
	let { targets, now }: { targets: DashTarget[]; now: Date } = $props();

	const DAYS = 3;

	const days = $derived(
		upcoming(targets, now, DAYS).map((day, index) => ({
			date: day.date,
			index,
			uploads: uploadsOfDay(day.posts)
		}))
	);
	const postCount = $derived(days.reduce((n, d) => n + d.uploads.reduce((m, u) => m + u.posts.length, 0), 0));
	const uploadCount = $derived(days.reduce((n, d) => n + d.uploads.length, 0));

	function dayName(date: Date, index: number): string {
		if (index === 0) return 'Today';
		if (index === 1) return 'Tomorrow';
		return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
	}

	function clock(iso: string): string {
		return new Date(iso.replace(' ', 'T')).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	/** Where a post stands, in a few words. */
	function stateOf(post: DashTarget): string {
		if (post.status === 'publishing') return 'uploading now';
		if (post.status === 'scheduled') return 'uploaded, released then';
		// Pending: YouTube and Facebook are uploaded ahead and released by the
		// platform; Instagram and TikTok are held by the worker until the slot.
		return post.platform === 'youtube' || post.platform === 'facebook' ? 'not uploaded yet' : 'held until then';
	}

	/* ---- the card ---- */

	let tip = $state<{ upload: ComingUpload<DashTarget>; day: string; x: number; y: number; above: boolean } | null>(null);

	function show(event: Event, upload: ComingUpload<DashTarget>, day: string) {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const above = box.bottom + 190 > window.innerHeight;
		const x = Math.min(Math.max(box.left + box.width / 2, 170), window.innerWidth - 170);
		tip = { upload, day, x, y: above ? box.top - 8 : box.bottom + 8, above };
	}

	function hide() {
		tip = null;
	}

	onMount(() => {
		// The card is fixed to where the cluster was: a scroll leaves it behind.
		window.addEventListener('scroll', hide, true);
		return () => window.removeEventListener('scroll', hide, true);
	});
</script>

<section class="card coming" aria-label="Coming up">
	<header>
		<h2>Coming up <span class="sub">next {DAYS} days</span></h2>
		<span class="total">
			{#if postCount > 0}{postCount} {postCount === 1 ? 'post' : 'posts'} · {uploadCount}
				{uploadCount === 1 ? 'upload' : 'uploads'}{/if}
			<a href="{base}/calendar">Calendar</a>
		</span>
	</header>
	<ol class="days">
		{#each days as day (day.index)}
			<li class:empty={day.uploads.length === 0}>
				<span class="day">{dayName(day.date, day.index)}</span>
				{#if day.uploads.length === 0}
					<span class="nothing">—</span>
				{:else}
					<span class="uploads">
						{#each day.uploads as upload (upload.key)}
							<a
								class="cluster"
								href="{base}/log/upload?job={encodeURIComponent(upload.job)}"
								aria-label="{upload.title}: {upload.posts
									.map((p) => `${PLATFORMS[p.platform].label} ${clock(p.scheduled_at)}`)
									.join(', ')}"
								onpointerenter={(e) => show(e, upload, dayName(day.date, day.index))}
								onpointerleave={hide}
								onfocus={(e) => show(e, upload, dayName(day.date, day.index))}
								onblur={hide}
							>
								{#each upload.posts as post (post.id)}
									<span class="coin {post.status}"><PlatformIcon platform={post.platform} size={13} /></span>
								{/each}
							</a>
						{/each}
					</span>
				{/if}
			</li>
		{/each}
	</ol>
</section>

{#if tip}
	<div
		class="tip"
		class:above={tip.above}
		use:portal
		style:left="{tip.x}px"
		style:top="{tip.y}px"
		role="tooltip"
	>
		<p class="ttitle">{tip.upload.title}</p>
		<p class="tday">{tip.day}</p>
		<ul>
			{#each tip.upload.posts as post (post.id)}
				<li>
					<span class="ttime">{clock(post.scheduled_at)}</span>
					<PlatformIcon platform={post.platform} size={13} />
					<span class="tname">{PLATFORMS[post.platform].label}</span>
					<span class="tstate {post.status}">{stateOf(post)}</span>
				</li>
			{/each}
		</ul>
		<p class="thint">Click for the upload's overview</p>
	</div>
{/if}

<style>
	.coming {
		min-width: 0;
		padding: 14px 16px;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 2px 10px;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		white-space: nowrap;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.sub {
		margin-left: 6px;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}

	.total {
		display: inline-flex;
		gap: 10px;
		font-size: 11px;
		color: var(--text-faint);
		white-space: nowrap;
	}

	.total a {
		color: var(--text-dim);
	}

	.total a:hover {
		color: var(--pink-soft);
	}

	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 3px;
	}

	.days li {
		display: grid;
		grid-template-columns: 66px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		min-height: 28px;
	}

	.day {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-dim);
	}

	.empty .day {
		font-weight: 500;
		color: var(--text-faint);
	}

	.nothing {
		font-size: 12px;
		color: var(--text-faint);
	}

	.uploads {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
	}

	/* An upload: its platforms as overlapping coins, like a stack of avatars. */
	.cluster {
		display: inline-flex;
		align-items: center;
		padding: 1px 3px;
		border-radius: 999px;
		border: 1px solid transparent;
		text-decoration: none;
		transition:
			border-color 0.12s,
			background 0.12s;
	}

	.cluster:hover,
	.cluster:focus-visible {
		border-color: var(--pink);
		background: rgba(255, 77, 158, 0.1);
		outline: none;
	}

	.coin {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--bg-elev);
		box-shadow:
			0 0 0 1.5px var(--border-strong),
			0 0 0 3px var(--surface);
	}

	.coin + .coin {
		margin-left: -4px;
	}

	/* On the platform already, released by it at the slot. */
	.coin.scheduled {
		box-shadow:
			0 0 0 1.5px rgba(52, 211, 153, 0.75),
			0 0 0 3px var(--surface);
	}

	.coin.publishing {
		box-shadow:
			0 0 0 1.5px var(--warn),
			0 0 0 3px var(--surface);
	}

	/* ---- the card ---- */

	.tip {
		position: fixed;
		z-index: 80;
		width: 340px;
		padding: 11px 13px 10px;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		box-shadow: var(--shadow);
		transform: translateX(-50%);
		pointer-events: none;
	}

	.tip.above {
		transform: translate(-50%, -100%);
	}

	.tip p {
		margin: 0;
	}

	.ttitle {
		font-size: 13px;
		font-weight: 600;
		line-height: 1.35;
		color: var(--text);
	}

	.tday {
		margin-top: 2px !important;
		font-size: 11px;
		color: var(--text-faint);
	}

	.tip ul {
		list-style: none;
		margin: 8px 0 0;
		padding: 8px 0 0;
		border-top: 1px solid var(--border);
		display: grid;
		gap: 5px;
	}

	.tip li {
		display: grid;
		grid-template-columns: max-content 13px 70px minmax(0, 1fr);
		align-items: center;
		gap: 7px;
		font-size: 12px;
	}

	.ttime {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text);
	}

	.tname {
		color: var(--text-dim);
	}

	.tstate {
		font-size: 11px;
		color: var(--text-faint);
	}

	.tstate.scheduled {
		color: var(--ok);
	}

	.tstate.publishing {
		color: var(--warn);
	}

	.thint {
		margin-top: 8px !important;
		font-size: 10.5px;
		color: var(--text-faint);
	}
</style>
