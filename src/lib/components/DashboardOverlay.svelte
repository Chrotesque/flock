<script lang="ts">
	import { tick } from 'svelte';
	import { cubicInOut } from 'svelte/easing';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { dashboard } from '$lib/stores/dashboard.svelte';
	import { todoPanel } from '$lib/stores/todopanel.svelte';
	import Dashboard from './Dashboard.svelte';

	/**
	 * The dashboard over the content area, opened from the sidebar's
	 * Dashboard link: it spreads from the link's height on the content area's
	 * left edge over the whole of it, and shrinks back there when the link is
	 * pressed again, on Escape or on any navigation. An address with
	 * `?dashboard` (where `/` lands) opens it.
	 */

	let panel = $state<HTMLElement | null>(null);

	// Going anywhere means wanting to see that page — unless the address asks
	// for the dashboard, which then opens and leaves the address.
	afterNavigate(() => {
		if (!page.url.searchParams.has('dashboard')) {
			dashboard.close();
			return;
		}
		todoPanel.close();
		dashboard.show();
		const url = new URL(page.url);
		url.searchParams.delete('dashboard');
		replaceState(url, page.state);
	});

	// However it was opened, the keyboard starts inside it.
	$effect(() => {
		if (dashboard.open) void tick().then(() => panel?.focus());
	});

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && dashboard.open) {
			dashboard.close();
			document.querySelector<HTMLElement>('[aria-controls="dashboard"]')?.focus();
		}
	}

	/**
	 * Spreads as a circle from where it was opened on the left edge until it
	 * covers the farthest corner, and shrinks back there on the way out.
	 * Instant with reduced motion.
	 */
	function reveal(node: HTMLElement) {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const y = dashboard.originY;
		const far = Math.hypot(node.offsetWidth, Math.max(y, node.offsetHeight - y));
		return {
			duration: reduced ? 0 : 420,
			easing: cubicInOut,
			css: (t: number) => `clip-path: circle(${t * far}px at 0 ${y}px)`
		};
	}
</script>

<svelte:window onkeydown={onKey} />

{#if dashboard.open}
	<section
		class="dashboard"
		id="dashboard"
		aria-label="Dashboard"
		tabindex="-1"
		bind:this={panel}
		transition:reveal
	>
		<Dashboard />
	</section>
{/if}

<style>
	.dashboard {
		position: absolute;
		inset: 0;
		z-index: 25;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 30px 40px 60px;
		background: var(--bg);
		outline: none;
	}

	@media (max-width: 860px) {
		.dashboard {
			padding: 22px 18px 50px;
		}
	}
</style>
