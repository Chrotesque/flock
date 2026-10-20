<script lang="ts">
	import { wobble } from '$lib/wobble';

	/**
	 * The gold medal of To finish's gold rows (v0.16.68, the user's design,
	 * 21 Oct 2026): Tabler's `medal` (MIT) in gold with a glow, wobbling at
	 * full strength with a few small sparks (wobble.ts).
	 */
	let { size = 16 }: { size?: number } = $props();
</script>

<span
	class="medal"
	use:wobble={{ strength: 0.8, sparks: 4, from: size * 0.45, to: size * 1.1, thick: 1.3, long: 3 }}
	aria-hidden="true"
>
	<svg
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
</style>
