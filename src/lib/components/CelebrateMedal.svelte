<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The gold medal of To finish's gold rows (v0.16.68, the user's design,
	 * 21 Oct 2026): Tabler's `medal` (MIT) in gold with a glow, stretched
	 * sideways and snapping back on a loop — 0.9 s of wobble at strength 0.8,
	 * then 0.4 s at rest — with a few sparks flying off as it snaps back.
	 * Still under reduced motion.
	 */
	let { size = 16 }: { size?: number } = $props();

	const WOBBLE_MS = 900;
	const PAUSE_MS = 400;
	const STRENGTH = 0.8;
	/** How far into the wobble it snaps back, where the sparks start. */
	const SNAP = 0.34;
	const SPARKS = 4;

	let wrap = $state<HTMLElement | null>(null);
	let icon = $state<SVGSVGElement | null>(null);

	const k = STRENGTH;
	const STEPS: [number, number, number][] = [
		[0, 1, 1],
		[0.16, 1 + 0.3 * k, 1 - 0.22 * k],
		[0.34, 1 - 0.2 * k, 1 + 0.18 * k],
		[0.52, 1 + 0.11 * k, 1 - 0.08 * k],
		[0.7, 1 - 0.05 * k, 1 + 0.04 * k],
		[0.86, 1 + 0.02 * k, 1 - 0.01 * k],
		[1, 1, 1]
	];
	const FRAMES: Keyframe[] = STEPS.map(([offset, x, y]) => ({
		offset,
		transform: `scale(${x}, ${y})`,
		easing: 'cubic-bezier(.33,.7,.4,1)'
	}));

	function sparks(node: HTMLElement) {
		for (let i = 0; i < SPARKS; i++) {
			const angle = (i / SPARKS) * 360 + (Math.random() * 30 - 15) - 90;
			const from = size * 0.45;
			const to = size * (0.95 + Math.random() * 0.45) * (0.7 + k * 0.3);
			const dot = Math.random() < 0.35;
			const thick = 1.3;
			const long = dot ? thick * 1.5 : Math.max(3, size * (0.14 + Math.random() * 0.08));
			const high = dot ? thick * 1.5 : thick;
			const spark = document.createElement('span');
			spark.className = 'spark';
			spark.style.width = `${long}px`;
			spark.style.height = `${high}px`;
			spark.style.marginLeft = `${-long / 2}px`;
			spark.style.marginTop = `${-high / 2}px`;
			node.appendChild(spark);
			const duration = 500 + Math.random() * 300;
			// Removed on a timer too: a tab that is not drawing never finishes the animation.
			setTimeout(() => spark.remove(), duration + 200);
			spark.animate(
				[
					{ transform: `rotate(${angle}deg) translateX(${from}px) scaleX(.4)`, opacity: 0 },
					{ transform: `rotate(${angle}deg) translateX(${from + (to - from) * 0.25}px) scaleX(1)`, opacity: 1, offset: 0.18 },
					{ transform: `rotate(${angle}deg) translateX(${to}px) scaleX(.25)`, opacity: 0 }
				],
				{ duration, easing: 'cubic-bezier(.2,.7,.3,1)' }
			);
		}
	}

	onMount(() => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// One timer drives both, so the sparks stay on the snap however long it runs.
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const once = () => {
			// Nobody sees a hidden tab, and it would only queue the sparks up.
			if (document.hidden) return;
			icon?.animate(FRAMES, { duration: WOBBLE_MS });
			const snap = setTimeout(() => {
				timers.delete(snap);
				if (wrap) sparks(wrap);
			}, SNAP * WOBBLE_MS);
			timers.add(snap);
		};
		once();
		const loop = setInterval(once, WOBBLE_MS + PAUSE_MS);
		return () => {
			clearInterval(loop);
			for (const t of timers) clearTimeout(t);
		};
	});
</script>

<span class="medal" bind:this={wrap} aria-hidden="true">
	<svg
		bind:this={icon}
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M12 4v3m-4 -3v6m8 -6v6" />
		<path d="M12 18.5l-3 1.5l.5 -3.5l-2 -2l3 -.5l1.5 -3l1.5 3l3 .5l-2 2l.5 3.5z" />
	</svg>
</span>

<style>
	.medal {
		position: relative;
		display: inline-block;
		line-height: 1;
		color: var(--gold);
	}

	svg {
		display: block;
		filter: drop-shadow(0 0 2px rgba(242, 193, 78, 0.75)) drop-shadow(0 0 6px rgba(242, 193, 78, 0.35));
	}

	.medal :global(.spark) {
		position: absolute;
		left: 50%;
		top: 50%;
		border-radius: 999px;
		background: var(--gold-soft);
		box-shadow: 0 0 3px rgba(242, 193, 78, 0.9);
		pointer-events: none;
	}
</style>
