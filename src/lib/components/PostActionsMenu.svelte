<script lang="ts">
	import { onMount } from 'svelte';
	import { portal } from '$lib/portal';
	import { PLATFORMS } from '$lib/platforms';
	import { dayLabel, MONTH_NAMES } from '$lib/format';
	import { actionSplit, platformList, type ActionPost, type PostAction } from '$lib/postactions';
	import PlatformIcon from './PlatformIcon.svelte';
	import ConfirmButton from './ConfirmButton.svelte';

	/**
	 * The Calendar's right-click menu in Edit mode, for a whole upload
	 * wherever it was clicked (the user's layout, 22 Oct 2026): release all
	 * of it at once, or the platforms ticked, and the same for deleting. Each
	 * button takes three presses within two seconds apiece. A post the action
	 * cannot take is left out of "all", says why, and cannot be ticked
	 * (postactions.ts). Closes on a press elsewhere, Esc or a scroll; stays
	 * open on an error.
	 */
	type Post = ActionPost & { id: string; date: string; time: string };

	let {
		posts,
		x,
		y,
		onact,
		close
	}: {
		/** Every post of the upload, in display order. */
		posts: Post[];
		x: number;
		y: number;
		onact: (action: PostAction, ids: string[]) => Promise<void>;
		close: () => void;
	} = $props();

	let node = $state<HTMLElement | null>(null);
	let height = $state(0);
	let error = $state('');
	const now = Date.now();

	const SECTIONS: { action: PostAction; all: string; each: string; verb: string; busy: string }[] = [
		{ action: 'release', all: 'Release all (!) immediately', each: 'Release individual platform:', verb: 'Release', busy: 'Releasing…' },
		{ action: 'delete', all: 'Delete all (!)', each: 'Delete individual platform:', verb: 'Delete', busy: 'Deleting…' }
	];

	const split = $derived({ release: actionSplit('release', posts, now), delete: actionSplit('delete', posts, now) });
	let picked = $state<Record<PostAction, string[]>>({ release: [], delete: [] });

	function toggle(action: PostAction, id: string) {
		const list = picked[action];
		picked[action] = list.includes(id) ? list.filter((one) => one !== id) : [...list, id];
	}

	function pickedPosts(action: PostAction): Post[] {
		return posts.filter((post) => picked[action].includes(post.id));
	}

	function eachLabel(section: (typeof SECTIONS)[number]): string {
		const chosen = pickedPosts(section.action);
		const what = chosen.length > 0 ? platformList(chosen) : 'selected';
		return section.action === 'release' ? `${section.verb} ${what} immediately` : `${section.verb} ${what}`;
	}

	function when(post: Post): string {
		const at = new Date(`${post.date}T${post.time}`);
		if (Number.isNaN(at.getTime())) return post.time;
		return `${dayLabel(at.getDay())} ${at.getDate()} ${MONTH_NAMES[at.getMonth()].slice(0, 3)}, ${post.time}`;
	}

	/** What "all" leaves out, in one line: the reason itself for one post, else where to read each. */
	function leftOut(action: PostAction, readyCount: number, out: { post: Post; why: string }[]): string {
		if (out.length === 1) {
			const name = PLATFORMS[out[0].post.platform].label;
			return readyCount === 0 ? out[0].why : `Leaves out ${name}: ${out[0].why}`;
		}
		if (readyCount === 0) return `None can be ${action === 'release' ? 'released' : 'deleted'} — hover an icon for why.`;
		return `Leaves out ${platformList(out.map((entry) => entry.post))} — hover an icon for why.`;
	}

	function why(action: PostAction, post: Post): string {
		return split[action].left.find((entry) => entry.post.id === post.id)?.why ?? '';
	}

	// Kept inside the window: by the right or bottom edge it opens the other way.
	const left = $derived(Math.min(x, window.innerWidth - 312));
	const top = $derived(Math.max(8, Math.min(y, window.innerHeight - (height || 380) - 8)));

	async function run(action: PostAction, ids: string[]) {
		error = '';
		try {
			await onact(action, ids);
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

<div
	class="menu"
	use:portal
	bind:this={node}
	bind:offsetHeight={height}
	style:left="{left}px"
	style:top="{top}px"
	role="dialog"
	aria-label="This upload's {posts.length} posts"
>
	<div class="head">
		<span class="icons">
			{#each posts as post (post.id)}
				<PlatformIcon platform={post.platform} size={13} />
			{/each}
		</span>
		<span class="what">{posts.length === 1 ? '1 post' : `${posts.length} posts`} of this upload</span>
	</div>

	{#each SECTIONS as section (section.action)}
		{@const { ready, left: out } = split[section.action]}
		{@const chosen = picked[section.action]}
		<section class="block">
			<ConfirmButton
				label={section.all}
				busyLabel={section.busy}
				danger={section.action === 'delete'}
				disabled={ready.length === 0}
				title="Three presses, each within two seconds"
				onconfirm={() => run(section.action, ready.map((post) => post.id))}
			/>
			{#if out.length > 0}
				<p class="why">{leftOut(section.action, ready.length, out)}</p>
			{/if}

			<span class="each">{section.each}</span>
			<div class="picks" role="group" aria-label={section.each}>
				{#each posts as post (post.id)}
					{@const no = why(section.action, post)}
					{@const on = chosen.includes(post.id)}
					<button
						class="pick"
						class:on
						disabled={Boolean(no)}
						aria-pressed={on}
						aria-label={PLATFORMS[post.platform].label}
						title="{PLATFORMS[post.platform].label} · {when(post)}{no ? ` — ${no}` : ''}"
						onclick={() => toggle(section.action, post.id)}
					>
						<PlatformIcon platform={post.platform} size={16} />
						{#if on}
							<span class="tick" aria-hidden="true">
								<svg viewBox="0 0 10 10"><path d="M2.2 5.3 4.2 7.2 7.8 3" /></svg>
							</span>
						{/if}
					</button>
				{/each}
			</div>
			<ConfirmButton
				label={eachLabel(section)}
				busyLabel={section.busy}
				danger={section.action === 'delete'}
				disabled={chosen.length === 0}
				title="Three presses, each within two seconds"
				onconfirm={() => run(section.action, [...chosen])}
			/>
		</section>
	{/each}

	{#if error}<p class="error">{error}</p>{/if}
	<p class="hint">Press three times, each within two seconds. Neither can be taken back.</p>
</div>

<style>
	.menu {
		position: fixed;
		z-index: 90;
		width: 296px;
		display: grid;
		gap: 10px;
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

	/* Release above, delete below, a rule between. */
	.block {
		display: grid;
		gap: 6px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}

	.each {
		margin-top: 4px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-dim);
	}

	.picks {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	/* A platform to tick: dimmed (the button, never the mark) when the
	   action cannot take it, pink and checked when ticked. */
	.pick {
		position: relative;
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		transition: border-color 0.14s, background 0.14s;
	}

	.pick:hover:not(:disabled) {
		border-color: var(--pink-soft);
	}

	.pick.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
	}

	.pick:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.tick {
		position: absolute;
		top: -5px;
		right: -5px;
		width: 14px;
		height: 14px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--pink);
	}

	.tick svg {
		width: 10px;
		height: 10px;
		fill: none;
		stroke: #fff;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
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
		margin: 0;
		font-size: 10.5px;
		line-height: 1.4;
		color: var(--text-faint);
	}
</style>
