<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { device } from '$lib/stores/device.svelte';
	import { workers } from '$lib/stores/workers.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { videoTodo } from '$lib/stores/videotodo.svelte';
	import PasteNotice from '$lib/components/PasteNotice.svelte';
	import DashboardOverlay from '$lib/components/DashboardOverlay.svelte';
	import TodoPanel from '$lib/components/TodoPanel.svelte';
	import { dashboard } from '$lib/stores/dashboard.svelte';
	import { todoPanel } from '$lib/stores/todopanel.svelte';
	import { paste } from '$lib/stores/paste.svelte';
	import { projects } from '$lib/stores/projects.svelte';
	import { draft } from '$lib/stores/draft.svelte';
	import { projectState } from '$lib/projects';
	import { folderName } from '$lib/folders';
	import { readFlockPaste } from '$lib/flockpaste';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { devtestActive, startDevtest } from '$lib/devtest';

	onMount(() => {
		void general.load();
		workers.start();
		const stopProjects = projects.start();
		const stopTodo = videoTodo.start();
		const stopDevtest = startDevtest();
		return () => {
			stopProjects();
			stopTodo();
			stopDevtest();
		};
	});

	// A local-devtest module changing something says so on every page.
	let devtest = $derived(devtestActive());

	/**
	 * A project in the sidebar opens on the Upload page, which takes it from
	 * the store. An upload open there that belongs to no project would be
	 * replaced and lost, so that takes a second press within two seconds;
	 * a project's own upload is kept on its row and needs none.
	 */
	let armedProject = $state<string | null>(null);
	let projectTimer: ReturnType<typeof setTimeout> | null = null;

	function openProject(id: string) {
		const replaces = draft.project !== id && !draft.project && draft.hasContent;
		if (replaces && armedProject !== id) {
			armedProject = id;
			if (projectTimer) clearTimeout(projectTimer);
			projectTimer = setTimeout(() => (armedProject = null), 2000);
			return;
		}
		armedProject = null;
		projects.offer(id);
		if (!isActive('/upload')) void goto(`${base}/upload`);
	}

	/**
	 * Ctrl+V anywhere: a flock block (flockpaste.ts) fills the upload, and
	 * anything else pastes wherever it was going, untouched. The paste event
	 * carries the clipboard without the permission prompt that reading it
	 * from script would raise. The upload page takes the block from there.
	 */
	function onPaste(event: ClipboardEvent) {
		const result = readFlockPaste(event.clipboardData?.getData('text/plain') ?? '');
		if (!result) return;
		event.preventDefault();
		paste.offer(result);
		if (result.ok && !isActive('/upload')) void goto(`${base}/upload`);
	}

	/**
	 * The To finish tile opens the panel over the content area, spreading
	 * from the tile's own height on the content area's left edge.
	 */
	let content = $state<HTMLElement | null>(null);

	function toggleTodo(event: MouseEvent) {
		const tile = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const top = content?.getBoundingClientRect().top ?? 0;
		dashboard.close();
		todoPanel.toggle(tile.top + tile.height / 2 - top);
	}

	/**
	 * Something can be done right now: Studio steps still open on a video, or
	 * a public one to link on Jestr. A greyed Jestr button, an upload on its
	 * way and YouTube's paid-promotion reading are not — the last only
	 * informs, and "not ticked" is right for a video without any.
	 */
	let needsDoing = $derived(videoTodo.lines.some((line) => line.studio.length > 0 || line.jestr === 'open'));

	/** A held release's slot, as the clock on this machine reads it. */
	function at(iso: string): string {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) || date.getTime() < Date.now()
			? ''
			: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	let needsDevice = $derived(!device.named);
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const links = [
		{
			href: '/analytics',
			label: 'Analytics',
			hint: 'Reach and performance',
			icon: 'M4 20V10m5 10V5m5 15v-7m5 7V8'
		},
		{
			href: '/upload',
			label: 'Upload',
			hint: 'Compose and schedule',
			icon: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
		},
		{
			href: '/calendar',
			label: 'Calendar',
			hint: 'Everything scheduled',
			icon: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-9ZM4 10h16M8.5 4v3.5M15.5 4v3.5'
		},
	];

	// Side by side, Log left and Settings right (the user's layout, 0.12.1).
	const utilities = [
		{
			href: '/log',
			label: 'Log',
			icon: 'M5.5 4h13a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 4.5h7m-7 3.5h7m-7 3.5h4.5'
		},
		{
			href: '/settings',
			label: 'Settings',
			icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 3H9l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2L9 21h6l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A8 8 0 0 0 20 12Z'
		}
	];

	function isActive(href: string): boolean {
		// No link points at '/' any more — it only redirects to /analytics.
		const path = page.url.pathname.replace(base, '') || '/';
		return path.startsWith(href);
	}
</script>

<div class="shell">
	<aside>
		<nav>
			{#each links as link (link.href)}
				<a href="{base}{link.href}" class="navlink" class:active={isActive(link.href)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
						<path
							d={link.icon}
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span class="text">
						{link.label}
						<em>{link.hint}</em>
					</span>
				</a>
			{/each}
		</nav>

		<!-- Project folders that hold a flock JSON file and have not been sent
		     yet, right under Upload: one press opens the upload, filled from
		     the file the first time and as it was left after that. -->
		{#if projects.listed.length > 0}
			<section class="projects" aria-label="New projects">
				<p class="todohead">New projects <span class="count">{projects.listed.length}</span></p>
				<ul>
					{#each projects.listed as row (row.id)}
						{@const started = projectState(row) === 'started'}
						<li class:current={draft.project === row.id}>
							<button
								class="ptitle"
								class:armed={armedProject === row.id}
								title={armedProject === row.id
									? 'Press again: the upload open now belongs to no project and would be replaced'
									: `${row.name} — in ${folderName(row.root)}${started ? ', started' : ''}`}
								onclick={() => openProject(row.id)}
							>
								{armedProject === row.id ? 'Press again to replace' : row.name}
							</button>
							<span class="pbadge" class:new={!started}>{started ? 'Started' : 'New'}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Videos with something left to do by hand — set in Studio, linked on
		     Jestr — as one icon centred in the free stretch between the main
		     links and the worker: a muted green box with a check cut out when nothing
		     needs doing, a yellow-to-pink outline round an exclamation mark
		     when something does, filled purple with a back arrow while open.
		     The list itself opens over the content area (TodoPanel). Rules in
		     videotodo.ts; Settings → Other can hide it. -->
		{#if general.value.showTodo}
			<section class="todo" aria-label="Videos to finish">
				<button
					id="todo-tile"
					class="tile"
					class:open={todoPanel.open}
					class:due={needsDoing}
					onclick={toggleTodo}
					aria-expanded={todoPanel.open}
					aria-controls="todo-panel"
					aria-label="To finish, {videoTodo.lines.length} {videoTodo.lines.length === 1 ? 'video' : 'videos'}"
					title={todoPanel.open
						? 'Close To finish (Esc)'
						: needsDoing
							? 'To finish: something needs doing'
							: 'To finish: nothing to do right now'}
				>
					<span class="tileart">
						<svg class="tileicon" viewBox="0 0 48 48" width="128" height="128" fill="none" aria-hidden="true">
							<defs>
								<!-- In the icon's own units: an exclamation mark is a
								     line with no width, which a box-relative gradient
								     would not paint at all. -->
								<linearGradient id="todo-due" gradientUnits="userSpaceOnUse" x1="4" y1="44" x2="44" y2="4">
									<stop offset="0" style="stop-color: var(--warn)" />
									<stop offset="1" style="stop-color: var(--pink)" />
								</linearGradient>
							</defs>
							{#if todoPanel.open}
								<!-- Open: filled purple, the way back cut out of it. -->
								<rect class="box open" x="4" y="4" width="40" height="40" rx="11" />
								<path class="neg back" d="M27.5 14.5L18 24l9.5 9.5" stroke-linecap="round" stroke-linejoin="round" />
							{:else if needsDoing}
								<!-- Something to do: the colour on the border, a thick
								     exclamation mark in the middle. -->
								<rect class="box due" x="5.5" y="5.5" width="37" height="37" rx="10" stroke="url(#todo-due)" />
								<path class="bangmark" d="M24 13.5v12.5M24 33.6v0.01" stroke="url(#todo-due)" stroke-linecap="round" />
							{:else}
								<!-- Nothing to do: muted green, the check cut out of it. -->
								<rect class="box idle" x="4" y="4" width="40" height="40" rx="11" />
								<path class="neg" d="M14 24.8l7 7L34.5 17.5" stroke-linecap="round" stroke-linejoin="round" />
							{/if}
						</svg>
						<!-- Where it opens, shown on hover; open, the box itself points back. -->
						<svg class="tilearrow" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
							<path d="M9 5.5l6.5 6.5L9 18.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
					<span class="tilecount" aria-hidden="true">{videoTodo.lines.length}</span>
				</button>
			</section>
		{/if}

		<div class="lower">
			{#if needsDevice}
				<a class="alert" href="{base}/settings" title="This device has no name yet">
					<span class="bang">!</span>
					<span class="alerttext">Name this device</span>
				</a>
			{/if}

			{#if devtest.length > 0}
				<a class="devtest" href="{base}/settings?section=devtest" title="Settings → DevTest">
					<span class="devtesthead">DevTest</span>
					{#each devtest as line (line)}
						<span class="devtestline">{line}</span>
					{/each}
				</a>
			{/if}

			<section class="worker" aria-label="Worker status">
				<div class="workerhead">
					<span class="workername">Worker</span>
					<span class="dots">
						{#each workers.view.dots as dot (dot.role)}
							<span class="dot {dot.state}" title={dot.title} aria-label={dot.title}></span>
						{/each}
					</span>
				</div>
				{#each workers.view.lines as line, i (i)}
					<p class="doing" title={line.text}>
						{line.text}{#if line.until && at(line.until)}<span class="until"> · out at {at(line.until)}</span>{/if}
					</p>
				{/each}
			</section>
		</div>

		<nav class="utility">
			{#each utilities as link (link.href)}
				<a href="{base}{link.href}" class="navlink" class:active={isActive(link.href)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
						<path
							d={link.icon}
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span class="text">{link.label}</span>
				</a>
			{/each}
		</nav>

		<div class="foot">
			<a class="brand" href="{base}/">
				<span class="mark">
					<strong>flock</strong>
					<img src="{base}/flock.png" alt="" width="68" height="68" />
				</span>
				<em>multi-platform publishing</em>
			</a>
		</div>
	</aside>

	<!-- The content area, clipped: the dashboard's button sits on its corner
	     and the dashboard covers it (DashboardOverlay), as does the To finish
	     panel the sidebar tile opens (TodoPanel). -->
	<div class="content" bind:this={content}>
		<main class="scroll" inert={dashboard.open || todoPanel.open}>
			{@render children()}
		</main>
		<TodoPanel />
		<DashboardOverlay />
	</div>
</div>

<svelte:document onpaste={onPaste} />
<PasteNotice />

<style>
	.shell {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: var(--nav-w) minmax(0, 1fr);
		height: 100vh;
	}

	aside {
		display: flex;
		flex-direction: column;
		/* No gap: the three groups space themselves — .utility pushes down with
		   an auto margin and .foot sets its own clearance — so a container gap
		   would silently add to it. */
		gap: 0;
		/* Less at the bottom than the top: the brand sits low, where the
		   version used to be (it is on the Settings page now). */
		padding: 20px 14px 8px;
		border-right: 1px solid var(--border);
		background: rgba(16, 14, 26, 0.6);
		backdrop-filter: blur(10px);
	}

	/* The brand, at the very bottom under Settings and Log. */
	.foot {
		margin-top: 16px;
		display: grid;
	}

	/* Stacked and centred: the mark and name on one line, the tagline under
	   them, sharing one centre line. */
	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 7px;
		padding: 6px 8px;
		text-align: center;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius);
	}

	.brand img {
		border-radius: 16px;
		flex: none;
	}

	/* Mark and name share one line, sitting on the same bottom edge rather than
	   being centred against each other.
	   `baseline` rather than `flex-end` on purpose: a flex row takes a replaced
	   element's baseline to be its bottom margin edge, so this puts the name's
	   baseline exactly on the logo's bottom edge. flex-end would align the boxes
	   instead, leaving "flock" — which has no descenders — floating a few pixels
	   high. */
	.mark {
		display: flex;
		align-items: baseline;
		gap: 11px;
	}

	.brand strong {
		display: block;
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.025em;
		line-height: 1;
		background: var(--accent-grad);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.brand em {
		display: block;
		font-style: normal;
		font-size: 13px;
		color: var(--text-dim);
	}

	nav {
		display: grid;
		gap: 3px;
	}

	/* Log and Settings: one row, half the rail each. */
	.utility {
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}

	.utility .navlink {
		min-width: 0;
		gap: 8px;
		padding: 8px 10px;
	}

	/* The device alert and the worker status, low in the rail just above
	   Settings: the auto top margin takes the free space, and the bottom one
	   keeps a little more room to Settings than the links keep to each other.
	   With the "To finish" list showing, the list's own auto margins take the
	   free space instead, centring it between the main links and this block. */
	.lower {
		margin-top: auto;
		margin-bottom: 22px;
		display: grid;
		gap: 14px;
		padding-top: 18px;
	}

	.todo + .lower {
		margin-top: 0;
	}

	/* Right under the main links: these are things to start, not to finish. */
	.projects {
		padding-top: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
	}

	.projects ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2px;
		max-height: 26vh;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.projects li {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 6px;
		padding: 2px 6px 2px 0;
		border-radius: 8px;
	}

	.projects li:hover {
		background: var(--surface-2);
	}

	.projects li.current {
		background: var(--accent-grad-soft);
		box-shadow: inset 0 0 0 1px rgba(255, 77, 158, 0.25);
	}

	.ptitle {
		flex: 1;
		min-width: 0;
		padding: 5px 0 5px 11px;
		text-align: left;
		font: inherit;
		font-size: 12px;
		line-height: 1.3;
		color: var(--text-dim);
		background: none;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ptitle:hover,
	.projects li.current .ptitle {
		color: var(--text);
	}

	.ptitle.armed {
		color: var(--warn);
	}

	.pbadge {
		flex: none;
		padding: 1px 7px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 600;
		background: var(--surface-2);
		color: var(--text-faint);
	}

	.pbadge.new {
		background: var(--accent-grad-soft);
		color: var(--pink-soft);
	}

	.todo {
		margin: auto 0;
		padding: 18px 0 0;
		display: flex;
		flex-direction: column;
	}

	.todohead {
		margin: 0;
		text-align: center;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.count {
		margin-left: 4px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-dim);
		letter-spacing: 0;
	}

	/* The way into the To finish panel: a box with no button chrome round
	   it. Muted green with a check cut out when nothing needs doing; a yellow-to-pink
	   border round a thick exclamation mark when something does; filled
	   purple with a back arrow cut out while open. Hovered (or focused) it
	   brightens and glows with a bloom that settles, and an arrow shows on
	   its right, pointing to where the panel opens. */
	.tile {
		--glow: 101, 124, 115;
		--glow-2: 80, 98, 91;
		--arrow: #849a91;
		position: relative;
		align-self: center;
		display: grid;
		justify-items: center;
		gap: 6px;
		padding: 0;
		border: none;
		background: none;
		color: var(--text-faint);
		font: inherit;
		cursor: pointer;
	}

	.tile:focus-visible {
		outline: none;
	}

	.tileart {
		position: relative;
		display: flex;
		align-items: center;
		/* The arrow's room hangs to the right without pushing the box off
		   centre, and is kept while hidden, so nothing moves when it shows. */
		margin-right: -28px;
		gap: 6px;
	}

	.tileicon,
	.tilearrow {
		display: block;
		overflow: visible;
		transition:
			opacity 0.2s,
			filter 0.25s,
			transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	/* Strokes keep their pixel width at any size. */
	.tileicon *,
	.tilearrow path {
		vector-effect: non-scaling-stroke;
		transition:
			fill 0.2s,
			opacity 0.2s,
			stroke-width 0.2s;
	}

	.tile.due {
		--glow: 251, 191, 36;
		--glow-2: 255, 77, 158;
		--arrow: var(--pink-soft);
	}

	.tile.open {
		--glow: 168, 85, 247;
		--glow-2: 168, 85, 247;
	}

	/* Nothing needs attention: green, but quiet — barely green, and a
	   little faded until the pointer is on it. */
	.box.idle {
		fill: #50625b;
		opacity: 0.75;
	}

	.box.due {
		stroke-width: 5px;
	}

	.box.open {
		fill: var(--purple);
	}

	/* A mark cut out of a filled box: the rail's own dark. */
	.neg {
		stroke: var(--bg-elev);
		stroke-width: 9px;
	}

	.neg.back {
		stroke-width: 9.5px;
	}

	.bangmark {
		stroke-width: 11px;
	}

	.tile.due .tileicon {
		filter: drop-shadow(0 0 5px rgba(var(--glow), 0.35)) drop-shadow(0 0 12px rgba(var(--glow-2), 0.25));
	}

	.tile.open .tileicon {
		filter: drop-shadow(0 0 8px rgba(var(--glow), 0.65)) drop-shadow(0 0 22px rgba(var(--glow-2), 0.4));
	}

	.tile:hover .tileicon,
	.tile:focus-visible .tileicon {
		filter: drop-shadow(0 0 7px rgba(var(--glow), 0.65)) drop-shadow(0 0 20px rgba(var(--glow-2), 0.45));
		animation: tilebloom 0.7s ease-out;
	}

	.tile.open:hover .tileicon,
	.tile.open:focus-visible .tileicon {
		filter: drop-shadow(0 0 10px rgba(var(--glow), 0.85)) drop-shadow(0 0 28px rgba(var(--glow-2), 0.55));
	}

	.tile:hover .box.idle,
	.tile:focus-visible .box.idle {
		fill: #657c73;
		opacity: 1;
	}

	.tile:hover .box.due,
	.tile:focus-visible .box.due {
		stroke-width: 6.5px;
	}

	.tile:hover .bangmark,
	.tile:focus-visible .bangmark {
		stroke-width: 12.5px;
	}

	.tile:hover .box.open,
	.tile:focus-visible .box.open {
		fill: #b56ef9;
	}

	/* The arrow: hidden until the pointer is on the box, then sliding in,
	   in the box's own colour. */
	.tilearrow {
		color: var(--arrow);
		opacity: 0;
		transform: translateX(-6px);
	}

	.tilearrow path {
		stroke-width: 3px;
	}

	.tile:hover .tilearrow,
	.tile:focus-visible .tilearrow {
		opacity: 1;
		transform: none;
		filter: drop-shadow(0 0 5px rgba(var(--glow-2), 0.7));
	}

	/* Open, the box carries the way back itself. */
	.tile.open .tilearrow {
		opacity: 0;
		transform: translateX(-6px);
	}

	@keyframes tilebloom {
		0% {
			filter: drop-shadow(0 0 0 rgba(var(--glow), 0)) drop-shadow(0 0 0 rgba(var(--glow-2), 0));
		}
		40% {
			filter: drop-shadow(0 0 12px rgba(var(--glow), 0.9)) drop-shadow(0 0 32px rgba(var(--glow-2), 0.65));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tile:hover .tileicon,
		.tile:focus-visible .tileicon {
			animation: none;
		}
		.tilearrow {
			transition: opacity 0.2s;
			transform: none;
		}
	}

	/* How many videos are on the list, the only words under the box. */
	.tilecount {
		min-width: 26px;
		padding: 2px 10px;
		border-radius: 999px;
		text-align: center;
		font-size: 13.5px;
		font-weight: 650;
		background: var(--surface-2);
		color: var(--text-dim);
		transition: color 0.2s;
	}

	.tile:hover .tilecount,
	.tile:focus-visible .tilecount,
	.tile.open .tilecount {
		color: var(--text);
	}

	.worker {
		padding: 0 11px;
		min-width: 0;
	}

	.workerhead {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
	}

	.workername {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--text);
	}

	.dots {
		display: flex;
		gap: 6px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		cursor: help;
	}

	.dot.up {
		background: var(--ok);
		box-shadow: 0 0 6px rgba(52, 211, 153, 0.55);
	}

	.dot.down {
		background: var(--danger);
		box-shadow: 0 0 6px rgba(248, 113, 113, 0.45);
	}

	/* The PC worker doing the NAS worker's share as well: amber, and ringed,
	   so it reads as "carrying more" rather than merely another colour. */
	.dot.covering {
		background: var(--warn);
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 3.5px var(--warn),
			0 0 8px rgba(251, 191, 36, 0.6);
	}

	.doing {
		margin: 2px 0 0;
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.until {
		color: var(--text-dim);
	}

	.alert {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 9px 11px;
		border-radius: var(--radius);
		text-decoration: none;
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.35);
		color: var(--warn);
		transition: background 0.15s, border-color 0.15s;
	}

	.alert:hover {
		background: rgba(251, 191, 36, 0.18);
		border-color: var(--warn);
	}

	.bang {
		flex: none;
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		background: var(--warn);
		color: var(--bg);
		font-size: 13px;
		font-weight: 800;
		line-height: 1;
	}

	.alerttext {
		font-size: 12px;
		font-weight: 600;
	}

	.devtest {
		display: grid;
		gap: 2px;
		padding: 8px 11px;
		border-radius: var(--radius);
		text-decoration: none;
		background: rgba(168, 85, 247, 0.1);
		border: 1px dashed rgba(168, 85, 247, 0.5);
		color: var(--text-dim);
		transition: background 0.15s, border-color 0.15s;
	}

	.devtest:hover {
		background: rgba(168, 85, 247, 0.18);
		border-color: var(--purple);
	}

	.devtesthead {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--purple);
	}

	.devtestline {
		font-size: 11.5px;
		line-height: 1.35;
	}

	.navlink {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 10px 11px;
		border-radius: var(--radius);
		text-decoration: none;
		color: var(--text-dim);
		transition: background 0.15s, color 0.15s;
	}

	.navlink:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.navlink.active {
		background: var(--accent-grad-soft);
		color: var(--text);
		box-shadow: inset 0 0 0 1px rgba(255, 77, 158, 0.25);
	}

	.navlink.active svg {
		color: var(--pink);
	}

	.text {
		font-size: 13.5px;
		font-weight: 560;
		line-height: 1.25;
	}

	.text em {
		display: block;
		font-style: normal;
		font-size: 10.5px;
		font-weight: 450;
		color: var(--text-faint);
		margin-top: 1px;
	}

	.content {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		/* clip, not hidden: no scroll container, so nothing sticky inside
		   loses the page it sticks to in the narrow layout. */
		overflow: clip;
	}

	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 30px 40px 60px;
	}

	@media (max-width: 860px) {
		.shell {
			grid-template-columns: 1fr;
			height: auto;
		}
		aside {
			flex-direction: row;
			align-items: center;
			/* Wraps rather than overflowing: brand + five nav links do not fit
			   one row on a phone. */
			flex-wrap: wrap;
			gap: 10px 18px;
			border-right: none;
			border-bottom: 1px solid var(--border);
			position: sticky;
			top: 0;
			z-index: 20;
		}
		nav {
			grid-auto-flow: column;
			gap: 2px;
		}
		.text em {
			display: none;
		}
		/* The tagline is what forces the brand block wide enough to push the nav
		   off screen, and it earns nothing on a narrow bar. */
		.brand em {
			display: none;
		}
		.brand {
			flex-direction: row;
			gap: 9px;
			padding: 0;
			text-align: left;
		}
		.brand img {
			width: 34px;
			height: 34px;
			border-radius: 9px;
		}
		.brand strong {
			font-size: 17px;
		}
		.foot {
			order: -1;
			margin-top: 0;
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.utility {
			margin-top: 0;
			grid-auto-flow: column;
			gap: 2px;
		}
		.utility .navlink {
			padding: 10px 11px;
		}
		.lower {
			margin: 0;
			padding: 0;
			display: flex;
			align-items: center;
			gap: 12px;
		}
		/* Neither fits a one-row bar; the wide layout shows them. */
		.todo,
		.projects {
			display: none;
		}
		.devtestline {
			display: none;
		}
		.doing {
			display: none;
		}
		main {
			padding: 22px 18px 50px;
		}
	}
</style>
