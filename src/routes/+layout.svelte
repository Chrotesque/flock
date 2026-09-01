<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { VERSION } from '$lib/version';
	import { device } from '$lib/stores/device.svelte';

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
			href: '/',
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
			hint: 'Platforms and adaptations',
			icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 3H9l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2L9 21h6l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A8 8 0 0 0 20 12Z'
		},
		{
			href: '/log',
			label: 'Log',
			hint: 'Everything that changed',
			icon: 'M5.5 4h13a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 4.5h7m-7 3.5h7m-7 3.5h4.5'
		}
	];

	function isActive(href: string): boolean {
		const path = page.url.pathname.replace(base, '') || '/';
		return href === '/' ? path === '/' : path.startsWith(href);
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

		{#if needsDevice}
			<a class="alert" href="{base}/settings" title="This device has no name yet">
				<span class="bang">!</span>
				<span class="alerttext">Name this device</span>
			</a>
		{/if}

		<nav class="utility" class:pushed={!needsDevice}>
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
					<span class="text">
						{link.label}
						<em>{link.hint}</em>
					</span>
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
			<p class="version">v{VERSION}</p>
		</div>
	</aside>

	<main class="scroll">
		{@render children()}
	</main>
</div>

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
		padding: 20px 14px;
		border-right: 1px solid var(--border);
		background: rgba(16, 14, 26, 0.6);
		backdrop-filter: blur(10px);
	}

	/* Brand and version sit together at the bottom; this block is what pushes
	   them there, so the nav can start flush at the top. */
	.foot {
		margin-top: 30px;
		display: grid;
		gap: 14px;
	}

	/* Stacked and centred: the mark sits above the name, the name above the
	   tagline, all sharing the version's centre line. */
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

	/* Settings and Log sit at the bottom of the rail; .foot's own 30px keeps
	   them clear of the brand.
	   The push comes from whichever element owns the free space: normally
	   .utility's auto margin, but when the alert is present its own pair of
	   autos absorbs everything instead. Three competing autos would split the
	   gap in thirds and leave the alert sitting high. */
	.utility.pushed {
		margin-top: auto;
	}

	/* Centred in the empty stretch between the two nav groups: an auto margin on
	   both sides splits the free space evenly, and .utility's own auto margin
	   still holds the bottom group down. */
	.alert {
		margin: auto 0;
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

	.version {
		margin: 0;
		text-align: center;
		font-size: 11px;
		font-family: var(--mono);
		color: var(--text-faint);
		letter-spacing: 0.02em;
	}

	main {
		overflow-y: auto;
		padding: 30px 34px 60px;
	}

	@media (max-width: 860px) {
		.shell {
			grid-template-columns: 1fr;
			height: auto;
		}
		aside {
			flex-direction: row;
			align-items: center;
			/* Wraps rather than overflowing: brand + version + three nav links do
			   not fit one row on a phone. */
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
		.alert {
			margin: 0;
		}
		main {
			padding: 22px 18px 50px;
		}
	}
</style>
