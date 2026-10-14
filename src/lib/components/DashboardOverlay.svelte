<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { cubicInOut } from 'svelte/easing';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { dashboard } from '$lib/stores/dashboard.svelte';
	import { todoPanel } from '$lib/stores/todopanel.svelte';
	import Dashboard from './Dashboard.svelte';

	/**
	 * The dashboard over the content area, opened from the sidebar's
	 * Dashboard link or from a round button centred on the content area's
	 * top-left corner, so only its bottom-right quarter shows. Far from the
	 * pointer the button shrinks into the corner with its icon hidden; once
	 * the pointer comes near it grows to full size. Either way in spreads the
	 * dashboard over the whole content area — from the corner, or from the
	 * link's height on the left edge; the corner button (then a close mark),
	 * the link again, Escape or any navigation takes it away. An address with
	 * `?dashboard` (where `/` lands) opens it.
	 *
	 * The layout clips its content area (`overflow: clip`), which is what
	 * hides the other three quarters — over the sidebar and above the page.
	 */

	/** The full quarter's radius, px; the icon sits inside it. */
	const RADIUS = 46;
	/** Tucked away: the sliver left in the corner. */
	const TUCKED = 14;
	/** How near the pointer has to come to the corner, px. */
	const NEAR = 150;

	let near = $state(false);
	let focused = $state(false);
	let button = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	let out = $derived(near || focused || dashboard.open);

	onMount(() => {
		// No pointer to come near on a touch screen: always out.
		if (!matchMedia('(hover: hover)').matches) {
			near = true;
			return;
		}
		let frame = 0;
		let x = 0;
		let y = 0;
		const measure = () => {
			frame = 0;
			const corner = button?.parentElement?.getBoundingClientRect();
			if (!corner) return;
			// Measured from the corner, and only from the content side of the
			// sidebar's edge: the top of the sidebar is close too, and the links
			// there should not set it off.
			near = x >= corner.left - 16 && Math.hypot(x - corner.left, y - corner.top) < NEAR;
		};
		const onMove = (event: PointerEvent) => {
			x = event.clientX;
			y = event.clientY;
			if (!frame) frame = requestAnimationFrame(measure);
		};
		const onLeave = () => (near = false);
		window.addEventListener('pointermove', onMove, { passive: true });
		document.documentElement.addEventListener('pointerleave', onLeave);
		return () => {
			window.removeEventListener('pointermove', onMove);
			document.documentElement.removeEventListener('pointerleave', onLeave);
			if (frame) cancelAnimationFrame(frame);
		};
	});

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

	function toggle() {
		// One panel over the content area at a time.
		todoPanel.close();
		dashboard.toggle(0);
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && dashboard.open) {
			dashboard.close();
			button?.focus();
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
			css: (t: number) => `clip-path: circle(${RADIUS + t * (far - RADIUS)}px at 0 ${y}px)`
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

<button
	class="orb"
	class:out
	class:open={dashboard.open}
	style:--radius="{RADIUS}px"
	style:--tucked={TUCKED / RADIUS}
	bind:this={button}
	onclick={toggle}
	onfocus={() => (focused = true)}
	onblur={() => (focused = false)}
	aria-expanded={dashboard.open}
	aria-controls="dashboard"
	aria-label={dashboard.open ? 'Close the dashboard' : 'Open the dashboard'}
	title={dashboard.open ? 'Close the dashboard (Esc)' : 'Dashboard'}
>
	<span class="glyph" aria-hidden="true">
		{#if dashboard.open}
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none">
				<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
			</svg>
		{:else}
			<!-- Four panes of different heights: a dashboard's layout. -->
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none">
				<rect x="3.5" y="3.5" width="7" height="9.5" rx="1.6" stroke="currentColor" stroke-width="1.7" />
				<rect x="13.5" y="3.5" width="7" height="5.5" rx="1.6" stroke="currentColor" stroke-width="1.7" />
				<rect x="3.5" y="16" width="7" height="4.5" rx="1.6" stroke="currentColor" stroke-width="1.7" />
				<rect x="13.5" y="12" width="7" height="8.5" rx="1.6" stroke="currentColor" stroke-width="1.7" />
			</svg>
		{/if}
	</span>
</button>

<style>
	/* A full circle centred on the corner; the layout's clip leaves the
	   bottom-right quarter. Scaled rather than resized, so moving in and out
	   is one cheap transform. */
	.orb {
		position: absolute;
		top: calc(var(--radius) * -1);
		left: calc(var(--radius) * -1);
		z-index: 30;
		width: calc(var(--radius) * 2);
		height: calc(var(--radius) * 2);
		padding: 0;
		border-radius: 50%;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		color: var(--text-dim);
		transform: scale(var(--tucked));
		transition:
			transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
			background 0.15s,
			border-color 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.orb.out {
		transform: scale(1);
		background: var(--surface-3);
		color: var(--text);
	}

	.orb:hover,
	.orb:focus-visible {
		background: var(--surface-3);
		border-color: var(--pink);
		color: var(--text);
		box-shadow: var(--glow);
		outline: none;
	}

	/* Open is a selected state, so it takes the selection colours, and
	   glows in them: a bloom on opening that settles into a steady halo. */
	.orb.open {
		background: var(--accent-grad);
		border-color: transparent;
		color: #fff;
		box-shadow:
			0 0 18px 6px rgba(255, 77, 158, 0.6),
			0 0 50px 18px rgba(168, 85, 247, 0.4);
		animation: bloom 0.8s ease-out;
	}

	.orb.open:hover,
	.orb.open:focus-visible {
		box-shadow:
			0 0 22px 8px rgba(255, 77, 158, 0.75),
			0 0 60px 22px rgba(168, 85, 247, 0.5);
	}

	@keyframes bloom {
		0% {
			box-shadow:
				0 0 0 0 rgba(255, 77, 158, 0),
				0 0 0 0 rgba(168, 85, 247, 0);
		}
		40% {
			box-shadow:
				0 0 34px 14px rgba(255, 77, 158, 0.85),
				0 0 100px 40px rgba(168, 85, 247, 0.55);
		}
		100% {
			box-shadow:
				0 0 18px 6px rgba(255, 77, 158, 0.6),
				0 0 50px 18px rgba(168, 85, 247, 0.4);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.orb.open {
			animation: none;
		}
	}

	/* The icon sits inside the visible quarter, clear of its curved edge. */
	.glyph {
		position: absolute;
		top: calc(var(--radius) + 7px);
		left: calc(var(--radius) + 7px);
		display: grid;
		opacity: 0;
		transition: opacity 0.12s;
	}

	.orb.out .glyph {
		opacity: 1;
		transition: opacity 0.18s 0.08s;
	}

	.dashboard {
		position: absolute;
		inset: 0;
		z-index: 25;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 30px 40px 60px 76px;
		background: var(--bg);
		outline: none;
	}


	@media (max-width: 860px) {
		.dashboard {
			padding: 22px 18px 50px 64px;
		}
	}
</style>
