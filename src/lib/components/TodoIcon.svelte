<script lang="ts">
	import { TODO_MARKS, type TodoState } from '$lib/todoicon';

	/**
	 * The sidebar's To finish box (+layout.svelte) in one of its states, drawn
	 * small to explain it (Settings → Other). Its strokes scale with it, where
	 * the sidebar's keep their pixel width; they are the sidebar's at 128px.
	 * A mark is cut out in `--cut`, the card's colour unless set.
	 */
	let { state, size = 28 }: { state: TodoState; size?: number } = $props();
	const gradient = $props.id();
</script>

<svg class="todoicon {state}" viewBox="0 0 48 48" width={size} height={size} fill="none" aria-hidden="true">
	{#if state === 'due'}
		<defs>
			<linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="4" y1="44" x2="44" y2="4">
				<stop offset="0" style="stop-color: var(--warn)" />
				<stop offset="1" style="stop-color: var(--pink)" />
			</linearGradient>
		</defs>
		<rect class="box" x="5.5" y="5.5" width="37" height="37" rx="10" stroke="url(#{gradient})" />
		<path class="bangmark" d={TODO_MARKS.bang} stroke="url(#{gradient})" stroke-linecap="round" />
	{:else}
		<rect class="box" x="4" y="4" width="40" height="40" rx="11" />
		{#if state === 'idle'}
			<path class="neg" d={TODO_MARKS.check} stroke-linecap="round" stroke-linejoin="round" />
		{:else if state === 'failed'}
			<path class="neg bang" d={TODO_MARKS.bang} stroke-linecap="round" />
		{:else}
			<path class="neg back" d={TODO_MARKS.back} stroke-linecap="round" stroke-linejoin="round" />
		{/if}
	{/if}
</svg>

<style>
	.todoicon {
		display: block;
		flex: none;
		overflow: visible;
	}

	/* The sidebar's pixel widths at 128px, in the box's 48 units. */
	.neg {
		stroke: var(--cut, var(--surface));
		stroke-width: 3.375;
	}

	.neg.bang {
		stroke-width: 3.75;
	}

	.neg.back {
		stroke-width: 3.56;
	}

	.due .box {
		stroke-width: 1.875;
	}

	.bangmark {
		stroke-width: 4.125;
	}

	.idle .box {
		fill: #50625b;
		opacity: 0.75;
	}

	.due {
		filter: drop-shadow(0 0 2px rgba(251, 191, 36, 0.35)) drop-shadow(0 0 5px rgba(255, 77, 158, 0.25));
	}

	.failed .box {
		fill: #ff2828;
	}

	.failed {
		animation: alarm 2.8s ease-in-out infinite;
	}

	.open .box {
		fill: var(--purple);
	}

	.open {
		filter: drop-shadow(0 0 3px rgba(168, 85, 247, 0.6)) drop-shadow(0 0 8px rgba(168, 85, 247, 0.35));
	}

	/* The sidebar's breathing, scaled down. */
	@keyframes alarm {
		0%,
		100% {
			opacity: 1;
			filter: drop-shadow(0 0 2px rgba(255, 40, 40, 0.6)) drop-shadow(0 0 6px rgba(255, 40, 40, 0.35));
		}
		50% {
			opacity: 0.62;
			filter: drop-shadow(0 0 0.5px rgba(255, 40, 40, 0.15)) drop-shadow(0 0 1px rgba(255, 40, 40, 0.1));
		}
	}

	/* Still red, and glowing, just not breathing — as in the sidebar. */
	@media (prefers-reduced-motion: reduce) {
		.failed {
			animation: none;
			filter: drop-shadow(0 0 2px rgba(255, 40, 40, 0.6)) drop-shadow(0 0 6px rgba(255, 40, 40, 0.35));
		}
	}
</style>
