<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { device } from '$lib/stores/device.svelte';
	import { workers } from '$lib/stores/workers.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { videoTodo } from '$lib/stores/videotodo.svelte';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import PasteNotice from '$lib/components/PasteNotice.svelte';
	import { paste } from '$lib/stores/paste.svelte';
	import { readFlockPaste } from '$lib/flockpaste';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { TodoLine } from '$lib/videotodo';

	onMount(() => {
		void general.load();
		workers.start();
		return videoTodo.start();
	});

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

	/** "Sun 13 Oct, 08:00" — when a scheduled video goes public. */
	function goesPublic(iso: string | null): string {
		const date = iso ? new Date(iso) : null;
		if (!date || Number.isNaN(date.getTime())) return '';
		return date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	function studioTitle(line: TodoLine): string {
		return line.studio.length
			? `Open in YouTube Studio to set ${line.studio.join(' and ')} — counts as done`
			: 'Open in YouTube Studio — nothing left to set there';
	}

	function lineTitle(line: TodoLine): string {
		const parts = [line.title, line.channel, line.publicAt ? `goes public ${goesPublic(line.publicAt)}` : ''];
		return parts.filter(Boolean).join(' — ');
	}

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

	const utilities = [
		{
			href: '/settings',
			label: 'Settings',
			icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 3H9l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2L9 21h6l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A8 8 0 0 0 20 12Z'
		},
		{
			href: '/log',
			label: 'Log',
			icon: 'M5.5 4h13a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 4.5h7m-7 3.5h7m-7 3.5h4.5'
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

		<!-- Videos with something left to do by hand — set in Studio, linked on
		     Jestr — centred in the free stretch between the main links and the
		     worker. Rules in videotodo.ts. -->
		{#if videoTodo.lines.length > 0}
			<section class="todo" aria-label="Videos to finish">
				<p class="todohead">To finish <span class="count">{videoTodo.lines.length}</span></p>
				<ul>
					{#each videoTodo.lines as line (line.id)}
						<li>
							<a class="vtitle" href={line.watchUrl} target="_blank" rel="noopener" title={lineTitle(line)}>
								{line.title}
							</a>
							<a
								class="studio"
								href={line.studioUrl}
								target="_blank"
								rel="noopener"
								title={studioTitle(line)}
								aria-label={studioTitle(line)}
								onclick={() => {
									if (line.studio.length) void videoTodo.markStudio(line);
								}}
							>
								<PlatformIcon platform="youtube" size={15} />
								<!-- Never a faded logo (YouTube's branding rules forbid
								     altering it): a yellow dot while something is left to
								     set in Studio, a green check once nothing is. -->
								{#if line.studio.length > 0}
									<span class="badge open" aria-hidden="true"></span>
								{:else}
									<span class="badge done" aria-hidden="true">
										<svg viewBox="0 0 10 10" width="7" height="7" fill="none">
											<path
												d="M2.3 5.3 4.3 7.2 7.8 3.2"
												stroke="currentColor"
												stroke-width="1.7"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
									</span>
								{/if}
							</a>
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
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<div class="lower">
			{#if needsDevice}
				<a class="alert" href="{base}/settings" title="This device has no name yet">
					<span class="bang">!</span>
					<span class="alerttext">Name this device</span>
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

	<main class="scroll">
		{@render children()}
	</main>
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

	/* Settings and Log: one line each, close together. */
	.utility {
		gap: 1px;
	}

	.utility .navlink {
		padding: 8px 11px;
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

	.todo {
		margin: auto 0;
		padding: 18px 0 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
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

	.todo ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		/* minmax(0, …): an auto column grows to the longest title, pushing the
		   icon and the button out of the rail instead of shortening the title. */
		grid-template-columns: minmax(0, 1fr);
		overflow-x: hidden;
		gap: 2px;
		/* A long backlog scrolls rather than pushing the worker off the rail. */
		max-height: 36vh;
		overflow-y: auto;
	}

	.todo li {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 6px;
		padding: 4px 4px 4px 11px;
		border-radius: 8px;
	}

	.todo li:hover {
		background: var(--surface-2);
	}

	.vtitle {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		line-height: 1.3;
		color: var(--text-dim);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.vtitle:hover {
		color: var(--text);
	}

	.jbtn {
		flex: none;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font: inherit;
		font-size: 11px;
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

	/* The way to the video's edit page in Studio. The logo is always shown as
	   it is — YouTube's branding rules forbid fading or recolouring it — and a
	   badge in its corner says the state: yellow while something is still to
	   be set there (paid promotion, a Short's cover), a green check once
	   nothing is. */
	.studio {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 24px;
		height: 22px;
		border-radius: 6px;
		transition: background 0.15s;
	}

	.studio:hover {
		background: var(--surface-3);
	}

	.badge {
		position: absolute;
		top: 0;
		right: 0;
		display: grid;
		place-items: center;
		border-radius: 50%;
		box-shadow: 0 0 0 1.5px var(--bg);
	}

	.badge.open {
		width: 7px;
		height: 7px;
		background: var(--warn);
	}

	.badge.done {
		width: 9px;
		height: 9px;
		top: -1px;
		right: -1px;
		background: var(--ok);
		color: var(--bg);
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

	main {
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
		/* A list does not fit a one-row bar; the wide layout shows it. */
		.todo {
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
