<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const links = [
		{
			href: '/',
			label: 'Upload',
			hint: 'Compose and schedule',
			icon: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
		},
		{
			href: '/analytics',
			label: 'Analytics',
			hint: 'Reach and performance',
			icon: 'M4 20V10m5 10V5m5 15v-7m5 7V8'
		},
		{
			href: '/settings',
			label: 'Settings',
			hint: 'Platforms and adaptations',
			icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 3H9l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2L9 21h6l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A8 8 0 0 0 20 12Z'
		}
	];

	function isActive(href: string): boolean {
		const path = page.url.pathname.replace(base, '') || '/';
		return href === '/' ? path === '/' : path.startsWith(href);
	}
</script>

<div class="shell">
	<aside>
		<a class="brand" href="{base}/">
			<img src="{base}/flock.png" alt="" width="34" height="34" />
			<span>
				<strong>flock</strong>
				<em>multi-platform publishing</em>
			</span>
		</a>

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
		gap: 26px;
		padding: 20px 14px;
		border-right: 1px solid var(--border);
		background: rgba(16, 14, 26, 0.6);
		backdrop-filter: blur(10px);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 6px 8px;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius);
	}

	.brand img {
		border-radius: 9px;
		flex: none;
	}

	.brand strong {
		display: block;
		font-size: 16px;
		font-weight: 680;
		letter-spacing: -0.02em;
		background: var(--accent-grad);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.brand em {
		display: block;
		font-style: normal;
		font-size: 10.5px;
		color: var(--text-faint);
	}

	nav {
		display: grid;
		gap: 3px;
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
			gap: 18px;
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
		main {
			padding: 22px 18px 50px;
		}
	}
</style>
