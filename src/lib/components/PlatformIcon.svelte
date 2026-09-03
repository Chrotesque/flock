<script lang="ts">
	import { general } from '$lib/stores/general.svelte';
	import type { PlatformId } from '$lib/types';

	// Brand glyphs, drawn in muted brand colours. The app's own pink/purple is
	// reserved for selection state, so a "selected" platform always reads
	// clearly regardless of which brand colour sits next to it.
	//
	// With compliance branding on, YouTube's mark switches to its official red
	// and a white play triangle instead. YouTube's API branding guidelines forbid
	// altering the colours of its logo, and the muted version is exactly that —
	// so the compliant rendering has to be available even though it sits awkwardly
	// beside the other three. Read from the store rather than threaded as a prop:
	// this component has a dozen call sites and none of them care.
	let { platform, size = 22 }: { platform: PlatformId; size?: number } = $props();

	let compliant = $derived(platform === 'youtube' && general.value.complianceBranding);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	aria-hidden="true"
	class="icon {platform}"
>
	{#if platform === 'youtube'}
		<path
			d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5C0 8.4 0 12 0 12s0 3.6.5 5.5a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.5.5-5.5s0-3.6-.5-5.5Z"
			fill={compliant ? '#FF0000' : 'currentColor'}
		/>
		<path d="M9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" fill={compliant ? '#FFFFFF' : '#0a0912'} />
	{:else if platform === 'instagram'}
		<rect
			x="2.4"
			y="2.4"
			width="19.2"
			height="19.2"
			rx="5.6"
			stroke="currentColor"
			stroke-width="1.9"
		/>
		<circle cx="12" cy="12" r="4.1" stroke="currentColor" stroke-width="1.9" />
		<circle cx="17.6" cy="6.4" r="1.3" fill="currentColor" />
	{:else if platform === 'tiktok'}
		<path
			d="M20.4 8.7a6 6 0 0 1-4.3-1.8 6 6 0 0 1-1.6-3.1h-3.2v12.1a2.9 2.9 0 1 1-2.1-2.8V9.9a6.1 6.1 0 1 0 5.3 6.1V9.7a9.1 9.1 0 0 0 5.9 2.1V8.7Z"
			fill="currentColor"
		/>
	{:else if platform === 'facebook'}
		<path
			d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.8 3.7-3.8 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"
			fill="currentColor"
		/>
	{/if}
</svg>

<style>
	.icon {
		display: block;
		flex: none;
	}
	.youtube {
		color: #e8484a;
	}
	.instagram {
		color: #d6558f;
	}
	.tiktok {
		color: #3de0dc;
	}
	.facebook {
		color: #3b82f6;
	}
</style>
