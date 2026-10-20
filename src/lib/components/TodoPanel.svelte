<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import { cubicInOut } from 'svelte/easing';
	import { afterNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import { todoPanel } from '$lib/stores/todopanel.svelte';
	import { videoTodo } from '$lib/stores/videotodo.svelte';
	import { attention } from '$lib/stores/attention.svelte';
	import { celebrations } from '$lib/stores/celebrations.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { INSTAGRAM_STEP, WAITING, type InstagramStep, type TodoLine } from '$lib/videotodo';
	import { follows, toggled } from '$lib/todobrands';
	import type { Attention } from '$lib/attention';
	import { ageWords, type Celebration } from '$lib/celebrate';
	import { PLATFORMS } from '$lib/platforms';
	import PlatformIcon from './PlatformIcon.svelte';
	import RetryButton from './RetryButton.svelte';
	import CelebrateMedal from './CelebrateMedal.svelte';

	/**
	 * The To finish list over the whole content area (v0.13.8, the user's
	 * design): it spreads from the sidebar's tile as a circle and goes back
	 * into it. First what needs attention (v0.14.7, moved here from the
	 * dashboard): a row per post gone wrong or the system's trouble, linking
	 * to the upload's overview, a post's with Dismiss, a failed one's with
	 * Retry (v0.14.8), and a gold row per post doing at least half as much
	 * again as usual (v0.16.68, celebrate.ts). Then a row per video —
	 * preview, title, what YouTube reports about paid promotion, the Studio
	 * button and Jestr's. Rules in attention.ts and videotodo.ts, state in
	 * their stores; nothing here decides what is listed.
	 */

	brands.load();

	let panel = $state<HTMLElement | null>(null);

	/**
	 * The enlarged preview while the pointer is on a thumbnail: twice the
	 * size the rows had before they went small, beside the thumbnail, from
	 * the 1280×720 image so it stays sharp. Fixed, so no row moves.
	 */
	const BIG = 256;
	const BIG_SHORT = 144;
	let big = $state<{ src: string; upright: boolean; x: number; y: number } | null>(null);

	function showBig(event: PointerEvent, src: string, upright: boolean) {
		if (!src) return;
		const w = upright ? BIG_SHORT : BIG;
		const h = upright ? BIG : BIG_SHORT;
		const at = (event.currentTarget as HTMLElement).getBoundingClientRect();
		let x = at.right + 12;
		if (x + w > innerWidth - 8) x = at.left - 12 - w;
		const y = Math.min(Math.max(8, at.top + at.height / 2 - h / 2), innerHeight - h - 8);
		big = { src, upright, x, y };
	}
	let lines = $derived(videoTodo.lines);
	let items = $derived(attention.items);
	let cheers = $derived(celebrations.items);

	// The gold rows are read in the background (for the sidebar's box); fresh ones on opening.
	$effect(() => {
		if (todoPanel.open) void celebrations.refresh();
	});

	/**
	 * A gold row's second line: the brand once there are several, the
	 * submission's views and each platform's, and the middle of the top 15 %
	 * it beat.
	 */
	function cheerMeta(c: Celebration): string {
		const brand = brands.multiple ? (brands.byId(c.brand)?.name ?? '') : '';
		const each = (['youtube', 'instagram', 'tiktok'] as const)
			.filter((p) => c.views[p] !== null)
			.map((p) => `${PLATFORMS[p].label} ${(c.views[p] ?? 0).toLocaleString()}`)
			.join(' · ');
		const words = `${c.combined.toLocaleString()} views in ${ageWords(c.age)} (${each}) · top 15% usually ${Math.round(c.median).toLocaleString()}`;
		return [brand, words].filter(Boolean).join(' · ');
	}
	let jestr = $derived(general.value.jestrIntegration);

	/** A post's brand, named once there are several. */
	function brandOf(item: Attention): string {
		return brands.multiple && item.brand ? (brands.byId(item.brand)?.name ?? '') : '';
	}

	/** A post that did not go out: what turns the sidebar box red. */
	const isFailure = (item: Attention) => item.kind === 'failed' || item.kind === 'unsent';

	$effect(() => {
		if (!todoPanel.open) return;
		void tick().then(() => panel?.focus());
	});

	// Going anywhere means wanting to see that page.
	afterNavigate(() => todoPanel.close());

	function close() {
		todoPanel.close();
		document.getElementById('todo-tile')?.focus();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && todoPanel.open) close();
	}

	/**
	 * Spreads from the tile — the content area's left edge, at the tile's
	 * height — until it covers the farthest corner, and shrinks back into it.
	 * Instant with reduced motion.
	 */
	function reveal(node: HTMLElement) {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const y = todoPanel.originY;
		const far = Math.hypot(node.offsetWidth, Math.max(y, node.offsetHeight - y));
		return {
			duration: reduced ? 0 : 420,
			easing: cubicInOut,
			css: (t: number) => `clip-path: circle(${t * far}px at 0 ${y}px)`
		};
	}

	/** "Sun 13 Oct, 08:00" — when a scheduled video goes public. */
	function goesPublic(iso: string | null): string {
		const date = iso ? new Date(iso) : null;
		if (!date || Number.isNaN(date.getTime())) return '';
		return date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	function meta(line: TodoLine): string {
		if (!line.studioUrl) return line.waiting ?? '';
		const when = line.publicAt ? `Goes public ${goesPublic(line.publicAt)}` : '';
		return [line.channel, when].filter(Boolean).join(' · ');
	}

	/** The one button's tooltip: what opening Studio through it counts as done. */
	function studioTitle(line: TodoLine): string {
		const label = line.instagram?.state === 'open';
		if (line.studio.length > 0) {
			return `Open in YouTube Studio to set ${line.studio.join(' and ')} — counts as done${
				label ? `, and so does Instagram's ${INSTAGRAM_STEP}` : ''
			}`;
		}
		return label
			? `Open in YouTube Studio — counts Instagram's ${INSTAGRAM_STEP} as done`
			: 'Open in YouTube Studio — nothing left to set there';
	}

	/** The Instagram mark's tooltip. The label is added on a phone: Instagram's app, not its website. */
	function instagramMarkTitle(step: InstagramStep): string {
		if (step.state === 'waiting') {
			const when = goesPublic(step.at);
			return `${when ? `Goes out ${when}` : 'Not out yet'} — its ${INSTAGRAM_STEP} after that`;
		}
		return step.state === 'open'
			? `Left on Instagram: ${INSTAGRAM_STEP} — added in the Instagram app on a phone`
			: `Instagram: ${INSTAGRAM_STEP} done`;
	}

	const PAID = {
		on: { label: 'Ticked', title: 'Paid promotion is ticked on YouTube' },
		off: { label: 'Not ticked', title: 'Paid promotion is not ticked on YouTube — tick it in Studio if this video has any' },
		unread: { label: 'Not read yet', title: 'Paid promotion not detected yet — the channel has not been read since the upload' }
	};

	/** The brands whose finishing steps are listed (todobrands.ts), one chip each. */
	function toggleBrand(id: string) {
		general.setTodoBrands(
			toggled(brands.ordered, general.value.todoBrands, id),
			Object.fromEntries(brands.ordered.map((b) => [b.id, b.name]))
		);
	}
	let leftOut = $derived(brands.ordered.filter((b) => !follows(general.value.todoBrands, b.id)));

	function paid(line: TodoLine) {
		return line.paid ? PAID.on : line.paid === false ? PAID.off : PAID.unread;
	}

	/**
	 * Instagram's entry beside YouTube's. Instagram reports no label (its API
	 * has no such field, tested 20 Oct 2026), so this is flock's own record:
	 * whether Open in Studio marked the label done.
	 */
	function igPaid(step: InstagramStep): { state: 'on' | 'off' | 'wait'; label: string; title: string } {
		if (step.state === 'waiting') {
			const when = goesPublic(step.at);
			return { state: 'wait', label: 'Not out yet', title: `The reel goes out ${when || 'later'} — add its label after that` };
		}
		const own = "flock cannot read the label from Instagram; this is its own record, set by Open in Studio";
		return step.state === 'done'
			? { state: 'on', label: 'Marked done', title: `Instagram's ${INSTAGRAM_STEP} is marked done — ${own}` }
			: { state: 'off', label: 'Not done', title: `Instagram's ${INSTAGRAM_STEP} is not marked done yet — ${own}` };
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- The badge on a mark's corner: yellow while open, a green check once
     done, a grey ring while waiting. -->
<!-- The paid-promotion circle: green ticked or done, red not, grey while
     the reel is not out. -->
{#snippet dollar(state: 'on' | 'off' | 'wait', size: number)}
	<span class="paidmark {state}" style:--size="{size}px" aria-hidden="true">
		<svg viewBox="0 0 10 10" width={Math.round(size * 0.54)} height={Math.round(size * 0.54)} fill="none">
			<path d="M6.9 3.3C6.6 2.7 5.9 2.4 5 2.4c-1.1 0-1.9.6-1.9 1.4 0 .9.9 1.1 1.9 1.3s1.9.4 1.9 1.3c0 .8-.8 1.4-1.9 1.4-.9 0-1.6-.3-1.9-.9M5 1.3v7.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
		</svg>
	</span>
{/snippet}

{#snippet badge(state: 'open' | 'done' | 'waiting')}
	{#if state === 'open'}
		<span class="badge open" aria-hidden="true"></span>
	{:else if state === 'done'}
		<span class="badge done" aria-hidden="true">
			<svg viewBox="0 0 10 10" width="8" height="8" fill="none">
				<path d="M2.3 5.3 4.3 7.2 7.8 3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</span>
	{:else}
		<span class="badge wait" aria-hidden="true"></span>
	{/if}
{/snippet}

{#if todoPanel.open}
	<section
		class="todopanel"
		id="todo-panel"
		aria-label="To finish"
		tabindex="-1"
		bind:this={panel}
		transition:reveal
		onscroll={() => (big = null)}
	>
		<header>
			<div>
				<h1>To finish <span class="count">{items.length + lines.length}</span></h1>
				<p class="sub">
					What needs attention comes first: click a post for its upload in the Log, retry a failed one, and
					dismiss it once dealt with. Then what is left to do by hand on each video: the Studio button opens it in YouTube Studio and
					counts it as done, together with the Paid partnership label of its Instagram reel (added in the Instagram app on a
					phone; the website cannot). The $ is what YouTube reports about paid promotion, and for Instagram whether the label
					was marked done here.{#if jestr}{' '}Jestr's button goes once the video is linked there.{/if}
				</p>
				{#if brands.multiple}
					<!-- Whose finishing steps and Jestr are listed (the user's call,
					     20 Oct 2026); the others show only posts that did not go out. -->
					<div class="follow" role="group" aria-label="Brands whose finishing steps are listed">
						<span class="followlabel">Finishing steps for</span>
						{#each brands.ordered as brand (brand.id)}
							{@const on = follows(general.value.todoBrands, brand.id)}
							<button
								class="followchip"
								class:on
								aria-pressed={on}
								title={on
									? `${brand.name}: finishing steps${jestr ? ', Jestr' : ''} and everything that needs attention`
									: `${brand.name}: only posts that did not go out`}
								onclick={() => toggleBrand(brand.id)}>{brand.name}</button
							>
						{/each}
						{#if leftOut.length > 0}
							<span class="followhint">
								{leftOut.map((b) => b.name).join(', ')}: only posts that did not go out
							</span>
						{/if}
					</div>
				{/if}
			</div>
			<!-- What the marks and circles mean, top right (the user's request). -->
			<aside class="legend" aria-label="What the marks mean">
				<div class="lgroup">
					<span class="lhead">Studio · Instagram</span>
					<span class="lrow">
						<span class="lsample"><span class="mark"><PlatformIcon platform="youtube" size={15} />{@render badge('open')}</span></span>
						Left to do
					</span>
					<span class="lrow">
						<span class="lsample"><span class="mark"><PlatformIcon platform="youtube" size={15} />{@render badge('done')}</span></span>
						Done
					</span>
					<span class="lrow">
						<span class="lsample"><span class="mark"><PlatformIcon platform="instagram" size={15} />{@render badge('waiting')}</span></span>
						Reel not out yet
					</span>
					<span class="lrow">
						<span class="lsample"><span class="spinner small"></span></span>
						On its way to YouTube
					</span>
				</div>
				<div class="lgroup">
					<span class="lhead">Paid promotion</span>
					<span class="lrow"><span class="lsample">{@render dollar('on', 18)}</span>Ticked · label marked done</span>
					<span class="lrow"><span class="lsample">{@render dollar('off', 18)}</span>Not ticked, not read yet · not done</span>
					<span class="lrow"><span class="lsample">{@render dollar('wait', 18)}</span>Reel not out yet</span>
					<span class="lnote">YouTube reports its own; Instagram's is flock's record.</span>
				</div>
			</aside>
			<button class="close" onclick={close} aria-label="Close To finish" title="Close (Esc)">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
					<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
				</svg>
			</button>
		</header>

		{#if items.length > 0 || cheers.length > 0}
			<section class="attn" aria-label="Needs attention">
				<h2>Needs attention <span class="count">{items.length + cheers.length}</span></h2>
				<ul>
					{#each items as item (item.key || item.text)}
						<li class={item.level} class:alarm={isFailure(item)} animate:flip={{ duration: 200 }} out:fade={{ duration: 160 }}>
							<span class="what">
								{#if item.platform}
									<PlatformIcon platform={item.platform} size={20} />
								{:else}
									<span class="sys" aria-hidden="true">!</span>
								{/if}
							</span>
							<div class="info">
								{#if item.job}
									<a class="title" href="{base}/log/upload?job={encodeURIComponent(item.job)}" title="Open this upload in the Log">
										{item.text}
									</a>
								{:else}
									<span class="title">{item.text}</span>
								{/if}
								{#if item.detail || brandOf(item)}
									<p class="meta" title={item.detail}>{[brandOf(item), item.detail].filter(Boolean).join(' · ')}</p>
								{/if}
							</div>
							<div class="acts">
								{#if item.retry}
									<RetryButton
										target={item.retry.target}
										slot={item.retry.slot}
										onretried={() => void attention.refresh()}
									/>
								{/if}
								{#if item.key}
									<button
										class="dismiss"
										onclick={() => attention.dismiss(item)}
										title="Dealt with: take it off this list. The upload's overview in the Log keeps it."
									>
										Dismiss
									</button>
								{/if}
							</div>
						</li>
					{/each}
					<!-- A submission half as much again as the top 15 % usually does
					     (celebrate.ts): gold, no buttons; the plain checkmark takes it off. -->
					{#each cheers as cheer (cheer.key)}
						<li class="gold" animate:flip={{ duration: 200 }} out:fly={{ x: 10, duration: 220 }}>
							<span
								class="preview upright"
								role="presentation"
								onpointerenter={(event) => showBig(event, cheer.thumb, true)}
								onpointerleave={() => (big = null)}
							>
								{#if cheer.thumb}
									<img src={cheer.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />
								{/if}
							</span>
							<div class="info">
								<a class="title" href={cheer.url} target="_blank" rel="noopener" title="Open it on YouTube">
									{cheer.title}
								</a>
								<p class="meta">{cheerMeta(cheer)}</p>
							</div>
							<div class="cheer">
								<div class="cheerwords">
									<span class="better"><span class="amt">{cheer.percent}%</span> better performance than usual</span>
									<span class="congrats"><CelebrateMedal size={16} />Congratulations!</span>
								</div>
								<button
									class="seen"
									onclick={() => celebrations.dismiss(cheer)}
									title="Seen, take it off the list"
									aria-label="Seen, take it off the list"
								>
									<svg viewBox="0 0 24 24" width="36" height="36" fill="none" aria-hidden="true">
										<path d="M5 12l5 5l10 -10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if lines.length === 0}
			{#if items.length === 0 && cheers.length === 0}<p class="empty">Nothing left to finish.</p>{/if}
		{:else}
			{#if items.length + cheers.length > 0}<h2>Videos <span class="count">{lines.length}</span></h2>{/if}
			<div class="table" class:nojestr={!jestr}>
				<div class="thead" aria-hidden="true">
					<span>Video</span>
					<span></span>
					<span class="mid">Paid promotion</span>
					<span class="mid">Studio · Instagram</span>
					{#if jestr}<span class="mid">Jestr</span>{/if}
				</div>
				<ul>
					{#each lines as line (line.id)}
						{@const p = paid(line)}
						<li animate:flip={{ duration: 200 }} out:fade={{ duration: 160 }}>
							<!-- The preview: YouTube's thumbnail, small so many rows fit, a
							     Short's upright (the middle of the 16:9 image, which is where
							     its frame is); the pointer on it shows it large. -->
							{#if line.watchUrl}
								<a
									class="preview"
									class:upright={line.short || !line.thumb}
									href={line.watchUrl}
									target="_blank"
									rel="noopener"
									tabindex="-1"
									aria-hidden="true"
									onpointerenter={(event) => showBig(event, line.thumb ? line.thumbLarge || line.thumb : '', line.short)}
									onpointerleave={() => (big = null)}
								>
									{#if line.thumb}
										<img src={line.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />
									{:else}
										<span class="spinner" title={line.waiting ?? ''}></span>
									{/if}
								</a>
							{:else}
								<span class="preview upright"><span class="spinner" title={line.waiting ?? ''}></span></span>
							{/if}

							<div class="info">
								{#if line.watchUrl}
									<a class="title" href={line.watchUrl} target="_blank" rel="noopener">{line.title}</a>
								{:else}
									<span class="title">{line.title}</span>
								{/if}
								{#if meta(line)}<p class="meta">{meta(line)}</p>{/if}
								{#if line.studio.length > 0}
									<p class="steps">Left in Studio: {line.studio.join(', ')}</p>
								{/if}
								{#if line.instagram?.state === 'open'}
									<p class="steps">Left on Instagram: {INSTAGRAM_STEP}</p>
								{/if}
							</div>

							<div class="cell paidcell">
								{#if line.studioUrl}
									<!-- Each platform's entry under its mark: YouTube's as YouTube
									     reports it, Instagram's as flock recorded it (igPaid). -->
									<span class="paid" title={p.title}>
										<span class="paidhead">
											<PlatformIcon platform="youtube" size={13} />
											{@render dollar(line.paid === true ? 'on' : 'off', 22)}
										</span>
										<span class="paidlabel">{p.label}</span>
									</span>
									{#if line.instagram}
										{@const q = igPaid(line.instagram)}
										<span class="paid" title={q.title}>
											<span class="paidhead">
												<PlatformIcon platform="instagram" size={13} />
												{@render dollar(q.state, 22)}
											</span>
											<span class="paidlabel">{q.label}</span>
										</span>
									{/if}
								{/if}
							</div>

							<div class="cell byhand">
								{#if line.studioUrl}
									{@const ig = line.instagram}
									{@const open = line.studio.length > 0 || ig?.state === 'open'}
									<!-- What is left, as the platforms' own marks with a badge on
									     the corner (a logo is never altered — YouTube's branding
									     rules): yellow while open, a green check once done, a grey
									     ring while the reel is not out yet. Not buttons. -->
									<span class="marks">
										<span class="mark" title={line.studio.length > 0 ? `Left in Studio: ${line.studio.join(', ')}` : 'Studio done'}>
											<PlatformIcon platform="youtube" size={18} />
											{@render badge(line.studio.length > 0 ? 'open' : 'done')}
										</span>
										{#if ig}
											<span class="mark" title={instagramMarkTitle(ig)}>
												<PlatformIcon platform="instagram" size={18} />
												{@render badge(ig.state)}
											</span>
										{/if}
									</span>
									<!-- One button for both (the user's call, 20 Oct 2026): it opens
									     the video in Studio, and the Studio steps and the reel's
									     label count as done. -->
									<a
										class="studio"
										class:done={!open}
										href={line.studioUrl}
										target="_blank"
										rel="noopener"
										title={studioTitle(line)}
										onclick={() => {
											if (open) void videoTodo.markOpened(line);
										}}
									>
										{open ? 'Open in Studio' : 'Studio done'}
									</a>
								{:else}
									<span class="spinner" role="status" title={line.waiting ?? ''} aria-label={line.waiting ?? ''}></span>
								{/if}
							</div>

							{#if jestr}
								<div class="cell">
									{#if line.jestr}
										<button
											class="jbtn"
											disabled={line.jestr === 'waiting'}
											onclick={() => videoTodo.markJestr(line)}
											title={line.jestr === 'waiting'
												? `Goes public ${goesPublic(line.publicAt)}; link it on Jestr after that`
												: 'Linked on Jestr: take it off this list'}
										>
											Jestr
										</button>
									{:else if line.waiting === WAITING.listing}
										<span class="spinner small" role="status" title={line.waiting} aria-label={line.waiting}></span>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if big}
			<span
				class="big"
				class:upright={big.upright}
				style:left="{big.x}px"
				style:top="{big.y}px"
				transition:fade={{ duration: 120 }}
				aria-hidden="true"
			>
				<img src={big.src} alt="" referrerpolicy="no-referrer" />
			</span>
		{/if}
	</section>
{/if}

<style>
	.todopanel {
		position: absolute;
		inset: 0;
		z-index: 25;
		display: flex;
		flex-direction: column;
		gap: 22px;
		overflow-y: auto;
		/* As wide a gap on the right as on the left. */
		padding: 30px 76px 60px;
		background: var(--bg);
		outline: none;
	}

	/* The words, the legend, the close button; the legend drops below the
	   words where the panel is narrow. */
	header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: start;
		gap: 20px;
	}

	.legend {
		display: flex;
		gap: 22px;
		padding: 10px 16px 11px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.lgroup {
		display: grid;
		align-content: start;
		gap: 5px;
	}

	.lhead {
		margin-bottom: 2px;
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.lrow {
		display: flex;
		align-items: center;
		gap: 9px;
		white-space: nowrap;
	}

	.lsample {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
	}

	.lnote {
		margin-top: 2px;
		font-size: 10.5px;
		color: var(--text-faint);
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 680;
		letter-spacing: -0.02em;
	}

	.count {
		margin-left: 6px;
		padding: 2px 9px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
		vertical-align: middle;
		background: var(--surface-2);
		color: var(--text-dim);
	}

	.sub {
		margin: 6px 0 0;
		max-width: 720px;
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.follow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		margin-top: 12px;
	}

	.followlabel {
		margin-right: 2px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.followchip {
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-faint);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}

	.followchip:hover,
	.followchip:focus-visible {
		border-color: var(--text-dim);
		color: var(--text);
		outline: none;
	}

	.followchip.on {
		border-color: rgba(255, 77, 158, 0.55);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.followhint {
		margin-left: 4px;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.close {
		flex: none;
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-dim);
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, box-shadow 0.15s;
	}

	.close:hover,
	.close:focus-visible {
		border-color: var(--pink);
		color: var(--text);
		box-shadow: var(--glow);
		outline: none;
	}

	.empty {
		margin: 40px 0 0;
		text-align: center;
		font-size: 14px;
		color: var(--text-faint);
	}

	h2 {
		margin: 0 0 -8px;
		font-size: 13px;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-dim);
	}

	h2 .count {
		font-size: 11.5px;
		letter-spacing: 0;
	}

	/* What needs attention: a row per item, its platform (or a "!" for the
	   system's own trouble), what it is, and Dismiss for a post. Errors carry
	   a red edge, warnings an amber one; a post that did not go out is red
	   all round, like the sidebar box. */
	.attn {
		display: grid;
		gap: 18px;
	}

	.attn li {
		grid-template-columns: 44px minmax(0, 1fr) auto;
		border-left: 3px solid var(--warn);
	}

	/* Retry (a failed post) and Dismiss, side by side, at the row's end. */
	.acts {
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		gap: 8px;
	}

	.attn li.error {
		border-left-color: #ff2828;
	}

	.attn li.alarm {
		border-color: rgba(255, 40, 40, 0.55);
		border-left-color: #ff2828;
		background: rgba(255, 40, 40, 0.06);
	}

	.attn li.alarm:hover {
		border-color: rgba(255, 40, 40, 0.85);
		border-left-color: #ff2828;
	}

	/* A post doing far better than usual (celebrate.ts): gold all round with a
	   slow breathing glow on the sidebar's red alarm's rhythm, steady under
	   reduced motion. No buttons: the words sit where they would be, and a
	   plain gold checkmark takes the row off the list. */
	.attn li.gold {
		border-color: rgba(242, 193, 78, 0.7);
		border-left-color: var(--gold);
		background: rgba(242, 193, 78, 0.05);
		animation: goldglow 2.8s ease-in-out infinite;
	}

	.attn li.gold:hover {
		border-color: rgba(242, 193, 78, 0.9);
		border-left-color: var(--gold);
	}

	@keyframes goldglow {
		0%,
		100% {
			box-shadow:
				0 0 0 1px rgba(242, 193, 78, 0.18),
				0 0 10px rgba(242, 193, 78, 0.22);
		}
		50% {
			box-shadow:
				0 0 0 1px rgba(242, 193, 78, 0.35),
				0 0 20px rgba(242, 193, 78, 0.45);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.attn li.gold {
			animation: none;
			box-shadow:
				0 0 0 1px rgba(242, 193, 78, 0.25),
				0 0 14px rgba(242, 193, 78, 0.3);
		}
	}

	.cheer {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.cheerwords {
		display: grid;
		justify-items: end;
		gap: 3px;
		text-align: right;
	}

	.better {
		font-size: 13px;
		font-weight: 600;
		color: var(--gold);
	}

	.amt {
		text-decoration: underline;
		text-decoration-color: var(--gold);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 3px;
	}

	.congrats {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 15px;
		font-weight: 650;
		color: var(--gold-soft);
	}

	.seen {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: none;
		background: none;
		color: var(--gold);
		cursor: pointer;
		filter: drop-shadow(0 0 2px rgba(242, 193, 78, 0.45));
		transition: filter 0.15s;
	}

	.seen:hover,
	.seen:focus-visible {
		outline: none;
		filter: drop-shadow(0 0 3px rgba(242, 193, 78, 0.9)) drop-shadow(0 0 8px rgba(242, 193, 78, 0.45));
	}

	.attn .title {
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}

	.attn a.title:hover {
		color: var(--pink-soft);
	}

	.attn .meta {
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow-wrap: anywhere;
	}

	.what {
		display: grid;
		place-items: center;
	}

	.sys {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		font-size: 13px;
		font-weight: 800;
		background: var(--warn);
		color: var(--bg);
	}

	.attn li.error .sys {
		background: #ff2828;
	}

	.dismiss {
		padding: 6px 16px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.dismiss:hover,
	.dismiss:focus-visible {
		border-color: var(--text-dim);
		color: var(--text);
		outline: none;
	}

	/* One grid for the head and every row, so the columns line up. */
	/* The Studio cell holds YouTube's button and the reel's beside it. */
	.table {
		--cols: 44px minmax(0, 1fr) 170px 210px 100px;
	}

	.table.nojestr {
		--cols: 44px minmax(0, 1fr) 170px 210px;
	}

	.thead,
	li {
		display: grid;
		grid-template-columns: var(--cols);
		align-items: center;
		gap: 18px;
	}

	.thead {
		padding: 0 14px 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.mid {
		text-align: center;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 6px;
	}

	li {
		padding: 8px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		transition: border-color 0.15s;
	}

	li:hover {
		border-color: var(--border-strong);
	}

	/* A narrow column: a Short upright in the middle of it, anything else
	   filling its width at 16:9 — a third of the size they started at. */
	.preview {
		justify-self: center;
		display: grid;
		place-items: center;
		width: 43px;
		height: 24px;
		border-radius: 4px;
		overflow: hidden;
		background: var(--surface-2);
		cursor: zoom-in;
	}

	.preview.upright {
		width: 24px;
		height: 43px;
	}

	.preview img,
	.big img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.preview .spinner {
		width: 12px;
		height: 12px;
	}

	.big {
		position: fixed;
		z-index: 5;
		width: 256px;
		height: 144px;
		border-radius: 12px;
		overflow: hidden;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow);
		pointer-events: none;
	}

	.big.upright {
		width: 144px;
		height: 256px;
	}

	.info {
		min-width: 0;
		display: grid;
		gap: 4px;
	}

	.title {
		font-size: 14.5px;
		font-weight: 600;
		line-height: 1.35;
		color: var(--text);
		text-decoration: none;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	a.title:hover {
		color: var(--pink-soft);
	}

	.meta,
	.steps {
		margin: 0;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-faint);
	}

	.steps {
		color: var(--warn);
	}

	.cell {
		display: grid;
		justify-items: center;
	}

	/* What YouTube reports: green when ticked, red when not (or not read). */
	.cell.paidcell {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 14px;
	}

	.paid {
		display: grid;
		justify-items: center;
		gap: 5px;
		cursor: help;
	}

	.paidhead {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.paidmark {
		flex: none;
		display: grid;
		place-items: center;
		width: var(--size, 24px);
		height: var(--size, 24px);
		border-radius: 50%;
		background: var(--danger);
		color: var(--bg);
	}

	.paidmark.on {
		background: var(--ok);
	}

	/* The reel is not out yet: nothing to mark. */
	.paidmark.wait {
		background: var(--surface-3);
		color: var(--text-faint);
	}

	.paidlabel {
		font-size: 11px;
		color: var(--text-faint);
	}

	.studio {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		padding: 7px 14px;
		border-radius: 999px;
		border: 1px solid rgba(251, 191, 36, 0.45);
		background: rgba(251, 191, 36, 0.08);
		color: var(--text);
		font-size: 12.5px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		transition: border-color 0.15s, background 0.15s;
	}

	.studio:hover {
		border-color: var(--warn);
		background: rgba(251, 191, 36, 0.16);
	}

	.studio.done {
		border-color: var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
	}

	.studio.done:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}

	.cell.byhand {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.marks {
		display: inline-flex;
		align-items: center;
		gap: 13px;
	}

	.mark {
		position: relative;
		display: grid;
	}

	.badge {
		position: absolute;
		top: -3px;
		right: -4px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		box-shadow: 0 0 0 1.5px var(--surface);
	}

	.badge.open {
		width: 8px;
		height: 8px;
		background: var(--warn);
	}

	.badge.done {
		width: 11px;
		height: 11px;
		background: var(--ok);
		color: var(--bg);
	}

	/* The reel is not out yet. */
	.badge.wait {
		width: 8px;
		height: 8px;
		background: var(--surface);
		border: 1.5px solid var(--text-faint);
	}

	.jbtn {
		padding: 6px 16px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.jbtn:hover:not(:disabled) {
		border-color: var(--text-dim);
		color: var(--text);
	}

	/* Scheduled: nothing to link on Jestr until the video is public. */
	.jbtn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* Waiting on YouTube. Still with reduced motion. */
	.spinner {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid var(--surface-3);
		border-top-color: var(--pink-soft);
		animation: spin 0.9s linear infinite;
		cursor: help;
	}

	.spinner.small {
		width: 13px;
		height: 13px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
			border-top-color: var(--warn);
		}
	}

	@media (max-width: 1100px) {
		/* Narrow: the two platforms' entries stack, and the button wraps
		   under the marks if it must, so the title keeps its room. */
		.table {
			--cols: 44px minmax(0, 1fr) 96px 180px 80px;
		}
		.table.nojestr {
			--cols: 44px minmax(0, 1fr) 96px 180px;
		}
		.thead,
		li {
			gap: 12px;
		}
		.cell.paidcell {
			flex-direction: column;
			align-items: center;
			gap: 8px;
		}
		.cell.byhand {
			flex-wrap: wrap;
			row-gap: 6px;
		}
		header {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.legend {
			grid-column: 1 / -1;
			grid-row: 2;
			justify-self: start;
		}
	}
</style>
