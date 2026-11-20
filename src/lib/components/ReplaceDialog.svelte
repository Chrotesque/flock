<script lang="ts">
	import Modal from './Modal.svelte';
	import ConfirmButton from './ConfirmButton.svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { replaceReel } from '$lib/repo';
	import { replaceChoices, type ReplaceChoice } from '$lib/replacepost';
	import type { Post, ReelPlatform, Release } from '$lib/releases';

	/**
	 * Puts a reel posted on the platform by hand in the place of the one a
	 * flock upload made (replacepost.ts), from the Dashboard's Edit mode:
	 * pick the submission, three presses, and the old reel is forgotten.
	 */
	let {
		post,
		title,
		releases,
		onclose
	}: {
		/** The hand-posted reel. */
		post: Post & { platform: ReelPlatform };
		title: string;
		releases: Release[];
		onclose: () => void;
	} = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	// svelte-ignore state_referenced_locally
	const choices = replaceChoices(post, releases).slice(0, 30);
	let picked = $state<ReplaceChoice | null>(null);
	let error = $state('');
	let done = $state(false);
	const label = $derived(PLATFORMS[post.platform].label);
	const noun = $derived(post.platform === 'tiktok' ? 'video' : 'reel');

	function gapWords(ms: number): string {
		const h = ms / 3_600_000;
		if (h < 1) return `${Math.round(ms / 60_000)} min earlier`;
		if (h < 48) return `${Math.round(h)} h earlier`;
		return `${Math.round(h / 24)} days earlier`;
	}

	const count = (n: number | null) => (n === null ? '—' : n.toLocaleString());

	async function run() {
		if (!picked) return;
		error = '';
		try {
			await replaceReel({
				job: picked.release.job,
				platform: post.platform,
				title: picked.release.title,
				oldUrl: picked.oldUrl,
				oldPostId: picked.old?.id ?? '',
				oldRecord: picked.old?.record ?? '',
				oldViews: picked.old?.views ?? null,
				newPostId: post.id,
				newUrl: post.url,
				newAt: post.at
			});
			done = true;
			setTimeout(() => (open = false), 1200);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<Modal bind:open title="Replaces a flock upload’s {noun}" subtitle={title} width="620px">
	<p class="lead">
		<PlatformIcon platform={post.platform} size={14} />
		This {noun} was posted on {label} directly, {new Date(post.at).toLocaleString()}, {count(post.views)} views.
		Pick the upload whose {label} {noun} it replaces: that one is forgotten — its numbers too — and this one counts
		for the upload from now on.
	</p>
	{#if choices.length === 0}
		<p class="none">No flock upload with a {label} {noun} went out before this one.</p>
	{:else}
		<ul class="choices">
			{#each choices as c (c.release.key)}
				<li>
					<button class="choice" class:on={picked === c} onclick={() => (picked = c)} disabled={done}>
						<span class="t">{c.release.title}</span>
						<span class="m"
							>{new Date(c.release.at).toLocaleString()} · {gapWords(c.gap)} · old {noun}: {c.old
								? `${count(c.old.views)} views`
								: 'not read'}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#snippet footer()}
		{#if error}<span class="err">{error}</span>{/if}
		{#if done}<span class="ok">Replaced.</span>{/if}
		<button class="btn" onclick={() => (open = false)}>Cancel</button>
		<ConfirmButton
			label={picked ? `Replace the ${noun} of “${picked.release.title}”` : `Pick an upload`}
			busyLabel="Replacing…"
			danger
			disabled={!picked || done}
			title="Three presses, each within two seconds. The old {noun}'s numbers are forgotten."
			onconfirm={run}
		/>
	{/snippet}
</Modal>

<style>
	.lead {
		margin: 0 0 12px;
		color: var(--text-dim);
		line-height: 1.45;
	}
	.none {
		color: var(--text-faint);
	}
	.choices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.choice {
		width: 100%;
		text-align: left;
		display: grid;
		gap: 2px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}
	.choice:hover {
		background: var(--bg-elev);
	}
	.choice.on {
		border-color: var(--accent);
		background: var(--bg-elev);
	}
	.m {
		font-size: 12px;
		color: var(--text-faint);
	}
	.err {
		color: var(--warn);
		margin-right: auto;
	}
	.ok {
		color: var(--ok);
		margin-right: auto;
	}
</style>
