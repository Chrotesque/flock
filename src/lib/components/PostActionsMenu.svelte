<script lang="ts">
	import { onMount } from 'svelte';
	import { portal } from '$lib/portal';
	import { PLATFORMS } from '$lib/platforms';
	import { groupRefusal, type ActionPost } from '$lib/postactions';
	import PlatformIcon from './PlatformIcon.svelte';
	import ConfirmButton from './ConfirmButton.svelte';

	/**
	 * The Calendar's right-click menu in Edit mode, for one post or a whole
	 * box of them: release at once, or delete — each three presses within two
	 * seconds apiece. What may not be done says why instead (postactions.ts).
	 * Closes on a press elsewhere, Esc or a scroll; stays open on an error.
	 */
	type Post = ActionPost & { id: string; time: string };

	let {
		posts,
		x,
		y,
		onrelease,
		ondelete,
		close
	}: {
		posts: Post[];
		x: number;
		y: number;
		onrelease: () => Promise<void>;
		ondelete: () => Promise<void>;
		close: () => void;
	} = $props();

	let node = $state<HTMLElement | null>(null);
	let error = $state('');
	const now = Date.now();
	const releaseWhy = $derived(groupRefusal('release', posts, now));
	const deleteWhy = $derived(groupRefusal('delete', posts, now));
	const what = $derived(
		posts.length === 1
			? `${PLATFORMS[posts[0].platform].label} post · ${posts[0].time}`
			: `${posts.length} posts of this upload`
	);

	// Kept inside the window: by the right or bottom edge it opens the other way.
	const left = $derived(Math.min(x, window.innerWidth - 268));
	const top = $derived(Math.min(y, window.innerHeight - 230));

	async function run(action: () => Promise<void>) {
		error = '';
		try {
			await action();
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	onMount(() => {
		const away = (e: PointerEvent) => {
			if (node && !node.contains(e.target as Node)) close();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		window.addEventListener('pointerdown', away, true);
		window.addEventListener('keydown', key);
		window.addEventListener('scroll', close, true);
		return () => {
			window.removeEventListener('pointerdown', away, true);
			window.removeEventListener('keydown', key);
			window.removeEventListener('scroll', close, true);
		};
	});
</script>

<div class="menu" use:portal bind:this={node} style:left="{left}px" style:top="{top}px" role="dialog" aria-label={what}>
	<div class="head">
		<span class="icons">
			{#each posts as post (post.id)}
				<PlatformIcon platform={post.platform} size={13} />
			{/each}
		</span>
		<span class="what">{what}</span>
	</div>

	<div class="action">
		<ConfirmButton
			label="Release immediately"
			busyLabel="Releasing…"
			disabled={Boolean(releaseWhy)}
			title="Three presses, each within two seconds"
			onconfirm={() => run(onrelease)}
		/>
		{#if releaseWhy}<p class="why">{releaseWhy}</p>{/if}
	</div>

	<div class="action">
		<ConfirmButton
			label={posts.length === 1 ? 'Delete' : 'Delete all of them'}
			busyLabel="Deleting…"
			danger
			disabled={Boolean(deleteWhy)}
			title="Three presses, each within two seconds"
			onconfirm={() => run(ondelete)}
		/>
		{#if deleteWhy}<p class="why">{deleteWhy}</p>{/if}
	</div>

	{#if error}<p class="error">{error}</p>{/if}
	<p class="hint">Press three times, each within two seconds. Neither can be taken back.</p>
</div>

<style>
	.menu {
		position: fixed;
		z-index: 90;
		width: 252px;
		display: grid;
		gap: 8px;
		padding: 11px 12px 10px;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--surface-3);
		box-shadow: var(--shadow);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 2px;
	}

	.icons {
		display: inline-flex;
		gap: 3px;
	}

	.what {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-dim);
	}

	.action {
		display: grid;
		gap: 3px;
	}

	.why {
		margin: 0;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-faint);
	}

	.error {
		margin: 0;
		font-size: 11.5px;
		color: var(--danger);
	}

	.hint {
		margin: 2px 0 0;
		font-size: 10.5px;
		line-height: 1.4;
		color: var(--text-faint);
	}
</style>
