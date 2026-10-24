<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { dayLabel, MONTH_NAMES } from '$lib/format';
	import type { PlatformId } from '$lib/types';

	/**
	 * Every post of one upload, opened by hovering its box in the Calendar:
	 * each platform's time, state and text, a title only where the platform
	 * has one. A post on another day than the box names its day.
	 */
	interface Post {
		id: string;
		platform: PlatformId;
		date: string;
		time: string;
		title: string;
		description: string;
		status: string;
		/** A line about the post itself: a move under way (`busy`) or turned down (`warn`). */
		note?: string;
		noteKind?: '' | 'busy' | 'warn';
	}

	let {
		posts,
		date,
		brand = '',
		product = ''
	}: {
		posts: Post[];
		date: string;
		brand?: string;
		/** The upload's product name, uncut — its box may end it in "…". */
		product?: string;
	} = $props();

	function day(iso: string): string {
		const [y, m, d] = iso.split('-').map(Number);
		return `${dayLabel(new Date(y, m - 1, d).getDay())} ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
	}
</script>

<div class="top">
	<span class="when">{day(date)}</span>
	{#if brand}
		<span class="brand">{brand}</span>
	{/if}
</div>
{#if product}
	<p class="product">{product}</p>
{/if}

{#each posts as post (post.id)}
	{@const hasTitle = PLATFORMS[post.platform].hasTitle}
	<section class="post">
		<div class="head">
			<PlatformIcon platform={post.platform} size={13} />
			<span class="name">{PLATFORMS[post.platform].label}</span>
			{#if post.status}
				<span class="status" class:bad={post.status === 'failed' || post.status === 'past due'}>
					{post.status}
				</span>
			{/if}
			<span class="time">{post.date === date ? '' : `${day(post.date)} · `}{post.time}</span>
		</div>
		{#if post.note}
			<p class="note {post.noteKind ?? ''}">{post.note}</p>
		{/if}
		{#if hasTitle}
			<p class="title">{post.title || '(no title)'}</p>
		{/if}
		{#if post.description}
			<p class="text" class:caption={!hasTitle}>{post.description}</p>
		{/if}
	</section>
{/each}

<style>
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 2px;
	}

	.when {
		font-size: 11px;
		font-weight: 650;
		color: var(--text-dim);
	}

	.product {
		margin: 0 0 4px;
		font-size: 12px;
		font-weight: 620;
		color: var(--text);
	}

	.brand {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-faint);
	}

	.post {
		padding-top: 8px;
		margin-top: 8px;
		border-top: 1px solid var(--border);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 4px;
	}

	.name {
		font-size: 11.5px;
		font-weight: 620;
		color: var(--text-dim);
	}

	.status {
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.status.bad {
		color: var(--danger);
	}

	.time {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--text-faint);
		white-space: nowrap;
	}

	.note {
		margin: 0 0 4px;
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-dim);
	}

	.note.busy {
		color: var(--pink-soft);
	}

	.note.warn {
		color: var(--warn);
	}

	/* Line breaks fold into spaces, so a caption's blank lines do not use up
	   its few lines. */
	.title,
	.text {
		margin: 0;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.title {
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1.35;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.text {
		margin-top: 3px;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-dim);
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	/* The caption is the post's text itself, not a note under a title. */
	.text.caption {
		margin-top: 0;
		font-size: 12px;
		color: var(--text);
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}
</style>
