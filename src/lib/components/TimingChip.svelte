<script lang="ts">
	import PlatformIcon from './PlatformIcon.svelte';
	import type { PostTiming } from '$lib/uploadrecord';

	/**
	 * How a post was sent: to go out immediately, or at a slot — the one
	 * thing the Log has to make plain at a glance. Amber with a bolt for
	 * immediately, blue with a clock for a slot; dashed when it was worked out
	 * from the stored times rather than recorded (uploads before 0.12.0).
	 */
	let {
		timing,
		big = false,
		icon = true
	}: { timing: PostTiming; big?: boolean; icon?: boolean } = $props();

	function slotText(iso: string): string {
		const date = new Date(iso.replace(' ', 'T'));
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	let label = $derived(
		timing.immediate
			? big
				? 'Publish immediately'
				: 'Immediately'
			: `${big ? 'Scheduled for' : 'Scheduled ·'} ${slotText(timing.slot)}`
	);
	let hint = $derived(
		(timing.immediate
			? 'Sent to go out as soon as the worker picked it up'
			: 'Sent to go out at this slot, not immediately') +
			(timing.inferred
				? ' — worked out from the stored times, since it was uploaded before flock kept a record of each upload'
				: '')
	);
</script>

<span class="chip" class:now={timing.immediate} class:big class:inferred={timing.inferred} title={hint}>
	{#if icon}<PlatformIcon platform={timing.platform} size={big ? 15 : 12} />{/if}
	{#if timing.immediate}
		<svg viewBox="0 0 16 16" width={big ? 14 : 11} height={big ? 14 : 11} aria-hidden="true">
			<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" fill="currentColor" />
		</svg>
	{:else}
		<svg viewBox="0 0 16 16" width={big ? 14 : 11} height={big ? 14 : 11} fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.6" />
			<path d="M8 4.8V8l2.2 1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
		</svg>
	{/if}
	<span>{label}</span>
</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 650;
		white-space: nowrap;
		border: 1px solid rgba(96, 165, 250, 0.4);
		background: rgba(96, 165, 250, 0.12);
		color: #93c5fd;
	}

	.chip.now {
		border-color: rgba(251, 191, 36, 0.45);
		background: rgba(251, 191, 36, 0.12);
		color: var(--warn);
	}

	.chip.inferred {
		border-style: dashed;
	}

	.chip.big {
		gap: 8px;
		padding: 6px 13px;
		font-size: 13.5px;
	}

	svg {
		flex: none;
	}
</style>
