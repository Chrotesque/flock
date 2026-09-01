<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import type { PlatformId } from '$lib/types';

	// The card that appears in a week grid cell. Shared by the upload wizard's
	// schedule step and the standalone Calendar, so the two read identically.
	let {
		platform,
		time,
		title,
		description = '',
		muted = false,
		status = '',
		dim = false
	}: {
		platform: PlatformId;
		time: string;
		title: string;
		description?: string;
		/** Already released (or past due) — greyed back, still legible. */
		muted?: boolean;
		status?: string;
		/** Mid-drag ghosting. */
		dim?: boolean;
	} = $props();
</script>

<div class="post {platform}" class:muted class:dim>
	<div class="posthead">
		<PlatformIcon {platform} size={14} />
		<span class="time">{time}</span>
	</div>
	<p class="posttitle">{title || '(no title)'}</p>
	{#if description}
		<p class="postbody">{description}</p>
	{/if}
	{#if status}
		<span class="status">{status}</span>
	{/if}
</div>

<style>
	.post {
		border-radius: 8px;
		padding: 7px 8px 8px;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-left: 3px solid var(--text-faint);
		transition: border-color 0.14s, transform 0.06s, box-shadow 0.14s, opacity 0.14s;
	}

	.post.youtube {
		border-left-color: #e8484a;
	}
	.post.instagram {
		border-left-color: #d6558f;
	}
	.post.tiktok {
		border-left-color: #3de0dc;
	}
	.post.facebook {
		border-left-color: #3b82f6;
	}

	/* Released or past due: pushed back, but not so far it cannot be read. */
	.post.muted {
		opacity: 0.42;
		background: var(--bg-elev);
		border-color: var(--border);
		filter: grayscale(0.85);
	}

	.post.muted:hover {
		opacity: 0.75;
		filter: grayscale(0.4);
	}

	.post.dim {
		opacity: 0.4;
	}

	.posthead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin-bottom: 3px;
	}

	.time {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text-faint);
	}

	.posttitle {
		margin: 0;
		font-size: 11.5px;
		font-weight: 600;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.postbody {
		margin: 3px 0 0;
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--text-faint);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.status {
		display: inline-block;
		margin-top: 5px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--surface-3);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
</style>
