<script lang="ts">
	import PlatformIcon from '../PlatformIcon.svelte';
	import Modal from '../Modal.svelte';
	import AdaptationSummary from '../AdaptationSummary.svelte';
	import CharCount from '../CharCount.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { draft } from '$lib/stores/draft.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { formatSchedule, formatBytes, formatDuration, firstLine } from '$lib/format';
	import type { PlanRow } from '$lib/plan';
	import type { PlatformId } from '$lib/types';

	let { rows }: { rows: PlanRow[] } = $props();

	let destination = $derived(general.defaultDestination);

	/** "In 11h - Sat 5 Sep, 09:00", or the immediate wording on its own. */
	function whenLine(row: PlanRow): string {
		if (row.immediate) return 'Immediately, as soon as the worker picks it up';
		const rel = row.relative.charAt(0).toUpperCase() + row.relative.slice(1);
		return `${rel} - ${formatSchedule(row.date, row.time)}`;
	}

	// A still of the video itself, so the last screen before upload shows what is
	// actually being sent rather than just its file name.
	let posterUrl = $state('');
	let thumbUrl = $state('');

	$effect(() => {
		const file = draft.file;
		if (!file) {
			posterUrl = '';
			return;
		}
		const url = URL.createObjectURL(file);
		posterUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	$effect(() => {
		const image = draft.thumbnail;
		if (!image) {
			thumbUrl = '';
			return;
		}
		const url = URL.createObjectURL(image);
		thumbUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	/**
	 * `preload="metadata"` alone leaves some browsers on a blank first paint.
	 * Nudging past zero forces a frame to be decoded and shown.
	 */
	function showFirstFrame(event: Event) {
		const video = event.currentTarget as HTMLVideoElement;
		if (video.currentTime === 0) video.currentTime = 0.1;
	}

	// Which pane the stage shows: the video, or a platform's thumbnail at the
	// same size, so the preview is actually judgeable. Falls back to the video
	// if the platform whose tab was open drops out of the plan.
	let tab = $state<'video' | PlatformId>('video');
	let shownTab = $derived(
		tab !== 'video' && !rows.some((row) => row.platform === tab) ? 'video' : tab
	);

	let detailFor = $state<PlanRow | null>(null);
	let detailOpen = $state(false);

	function openDetail(row: PlanRow) {
		detailFor = row;
		detailOpen = true;
	}
</script>

<div class="wrap">
	<section class="card summary">
		<div class="tabs" role="tablist">
			<button
				class="tab"
				class:active={shownTab === 'video'}
				role="tab"
				aria-selected={shownTab === 'video'}
				onclick={() => (tab = 'video')}
			>
				Video
			</button>
			{#each rows as row (row.platform)}
				{#if row.platform === 'youtube'}
					<button
						class="tab"
						class:active={shownTab === row.platform}
						role="tab"
						aria-selected={shownTab === row.platform}
						onclick={() => (tab = row.platform)}
					>
						<PlatformIcon platform={row.platform} size={14} />
						Thumbnail
					</button>
				{/if}
			{/each}
		</div>

		{#if shownTab === 'video'}
			{#if posterUrl}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					class="poster"
					src={posterUrl}
					controls
					playsinline
					preload="metadata"
					onloadeddata={showFirstFrame}
				></video>
			{:else}
				<div class="poster empty">
					<svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
						<path
							d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v11A2.5 2.5 0 0 1 13.5 20h-7A2.5 2.5 0 0 1 4 17.5v-11ZM16 9.5l4-2.2v9.4l-4-2.2"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linejoin="round"
						/>
					</svg>
					{#if draft.nasFile}
						<p>Picked off the NAS, so there is nothing to play here.</p>
					{/if}
				</div>
			{/if}
		{:else if thumbUrl}
			<img class="poster" src={thumbUrl} alt="Thumbnail for YouTube" />
		{:else}
			<div class="poster empty">
				<p>No thumbnail chosen. YouTube will pick a frame.</p>
			</div>
		{/if}

		<div class="file">
			<div class="filemeta">
				<p class="name">{draft.videoName || 'No file'}</p>
				<p class="sub">
					<!--
						Both routes have to report here. A watch-folder pick has a name and a
						size but no bytes in the browser, so it has no duration and no poster
						frame — reading only `draft.file` left this screen claiming "No file"
						for a video that was in fact chosen.
					-->
					{#if draft.file}
						{formatBytes(draft.file.size)}
						{#if draft.duration}<span class="dot">·</span>{formatDuration(draft.duration)}{/if}
						<span class="dot">·</span>
						{#if destination}
							will be copied to <span class="dest">{destination.label || destination.path || 'unnamed'}</span>
						{:else}
							uploads to the NAS on confirm
						{/if}
					{:else if draft.nasFile}
						{formatBytes(draft.nasFile.size)}
						<span class="dot">·</span>already on the NAS, nothing to transfer
						{#if destination}
							<span class="dot">·</span>will be copied to
							<span class="dest">{destination.label || destination.path || 'unnamed'}</span>
						{/if}
					{/if}
				</p>
			</div>
		</div>
	</section>

	<ul class="rows">
		{#each rows as row (row.platform)}
			{@const def = PLATFORMS[row.platform]}
			{@const label = def.hasTitle ? row.title : firstLine(row.description)}
			<li class="card" class:flagged={row.overLimit || row.errors > 0}>
				<span class="ic"><PlatformIcon platform={row.platform} size={20} /></span>

				<div class="body">
					<div class="titleline">
						<p class="title" class:empty={!label}>
							{def.hasTitle ? 'Title' : 'Caption'}: {label ? `"${label}"` : '(none)'}
						</p>
						<button class="info" onclick={() => openDetail(row)} aria-label="Show description for {def.label}">
							<svg viewBox="0 0 24 24" width="15" height="15" fill="none">
								<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
								<path
									d="M12 11v5.5M12 7.6v.9"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<p class="date">{whenLine(row)}</p>
					</div>
					<p class="meta">
						{#if row.platform === 'youtube' && row.options.playlist}
							<span class="dot">·</span>playlist: {row.options.playlist}
						{/if}
						{#if row.platform === 'youtube' && row.options.paidPromotion}
							<span class="dot">·</span>paid promotion
						{/if}
						{#if row.hits > 0}
							<span class="dot">·</span><span class="adapted">{row.hits} adapted</span>
						{/if}
						{#if row.overLimit}
							<span class="dot">·</span><span class="bad">over character limit</span>
						{/if}
						{#if row.errors > 0}
							<span class="dot">·</span><span class="bad">rule error</span>
						{/if}
					</p>
				</div>
			</li>
		{/each}
	</ul>
</div>

<Modal bind:open={detailOpen} width="640px">
	{#snippet header()}
		{#if detailFor}
			<div class="dhead">
				<span class="ic"><PlatformIcon platform={detailFor.platform} size={19} /></span>
				<div>
					<h2>{PLATFORMS[detailFor.platform].label}</h2>
					<p>{formatSchedule(detailFor.date, detailFor.time)}</p>
				</div>
			</div>
		{/if}
	{/snippet}

	{#if detailFor}
		{@const def = PLATFORMS[detailFor.platform]}
		<div class="detail">
			{#if def.hasTitle}
				<div>
					<div class="blockhead">
						<span class="label">Title</span>
						<CharCount value={detailFor.title} limit={def.titleLimit} />
					</div>
					<p class="out">{detailFor.title || '(no title)'}</p>
				</div>
			{/if}

			<div>
				<div class="blockhead">
					<span class="label">{def.hasTitle ? 'Description' : 'Caption'}</span>
					<CharCount value={detailFor.description} limit={def.descriptionLimit} />
				</div>
				<p class="out pre">{detailFor.description || '(no description)'}</p>
			</div>

			<div>
				<span class="label">Adaptations applied</span>
				<AdaptationSummary hits={detailFor.allHits} compact />
			</div>

			<div>
				<span class="label">Publish options</span>
				<dl class="opts">
					{#each def.fields as field (field.key)}
						{@const value = detailFor.options[field.key]}
						<div>
							<dt>{field.label}</dt>
							<dd>
								{#if typeof value === 'boolean'}
									{value ? 'Yes' : 'No'}
								{:else if Array.isArray(value)}
									{value.length ? value.join(', ') : '—'}
								{:else}
									{value === '' || value === undefined ? '—' : value}
								{/if}
							</dd>
						</div>
					{/each}
				</dl>
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<button class="btn btn-primary" onclick={() => (detailOpen = false)}>Close</button>
	{/snippet}
</Modal>

<style>
	/* The video on the left, the per-platform list beside it. */
	.wrap {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
		gap: 20px;
		align-items: start;
	}

	.summary {
		padding: 16px;
		display: grid;
		justify-items: center;
		gap: 14px;
	}

	/* A fixed 16:9 stage rather than the video's own ratio: a portrait clip would
	   otherwise be taller than the screen at this width. `contain` letterboxes
	   instead of cropping, so the frame shown is the whole frame. */
	.poster {
		width: 100%;
		/* Wide enough to watch, never taller than the screen. */
		max-width: min(100%, calc(70vh * 16 / 9));
		justify-self: center;
		aspect-ratio: 16 / 9;
		object-fit: contain;
		border-radius: 12px;
		background: #000;
		border: 1px solid var(--border-strong);
	}

	.poster.empty {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 8px;
		background: var(--bg-elev);
		color: var(--text-faint);
	}

	.poster.empty p {
		margin: 0;
		font-size: 12.5px;
	}

	.tabs {
		width: 100%;
		display: flex;
		gap: 4px;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid transparent;
		background: none;
		color: var(--text-dim);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.tab:hover {
		color: var(--text);
	}

	.tab.active {
		background: var(--surface-3);
		border-color: var(--border-strong);
		color: var(--text);
	}

	.file {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.ic {
		flex: none;
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--pink);
	}

	.filemeta {
		flex: 1;
		min-width: 0;
	}

	.name {
		margin: 0;
		font-size: 13.5px;
		font-weight: 570;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sub {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.dot {
		margin: 0 6px;
		opacity: 0.5;
	}

	.dest {
		color: var(--pink-soft);
		font-family: var(--mono);
		font-size: 11px;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.rows li {
		display: flex;
		align-items: center;
		gap: 13px;
		padding: 13px 16px;
	}

	.rows li.flagged {
		border-color: rgba(251, 191, 36, 0.35);
	}

	.rows .ic {
		color: inherit;
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	/* Title left, date right, on one line — and when they meet, the title is
	   the one that wraps. */
	.titleline {
		display: flex;
		align-items: flex-start;
		gap: 7px;
	}

	.title {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 13.5px;
		font-weight: 560;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.title.empty {
		color: var(--text-faint);
		font-style: italic;
	}

	.info {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		color: var(--text-faint);
	}

	.info:hover {
		background: var(--surface-3);
		color: var(--pink);
	}

	.meta {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	/* With the platform name gone, the first item must not start with a dot. */
	.meta .dot:first-child {
		display: none;
	}

	.adapted {
		color: #cfa8fb;
	}

	.bad {
		color: var(--warn);
	}

	.date {
		flex: none;
		margin: 0 0 0 auto;
		font-size: 12.5px;
		font-weight: 570;
		line-height: 1.4;
		white-space: nowrap;
		text-align: right;
	}

	.dhead {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.dhead h2 {
		font-size: 16px;
	}

	.dhead p {
		margin: 2px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.detail {
		display: grid;
		gap: 20px;
	}

	.blockhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.blockhead .label {
		margin-bottom: 8px;
	}

	.out {
		margin: 0;
		padding: 11px 13px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 13px;
		line-height: 1.6;
	}

	.out.pre {
		white-space: pre-wrap;
		max-height: 220px;
		overflow-y: auto;
	}

	.opts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		background: var(--border);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.opts > div {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 11px;
		background: var(--bg-elev);
	}

	dt {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	dd {
		margin: 0;
		font-size: 11.5px;
		font-weight: 550;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 1040px) {
		.wrap {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.opts {
			grid-template-columns: 1fr;
		}
	}
</style>
