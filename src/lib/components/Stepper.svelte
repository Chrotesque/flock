<script lang="ts">
	import { STEP_LABELS } from '$lib/stores/draft.svelte';

	let {
		step,
		onjump
	}: { step: number; onjump?: (index: number) => void } = $props();
</script>

<nav class="stepper" aria-label="Progress">
	{#each STEP_LABELS as label, index}
		{@const state = index < step ? 'done' : index === step ? 'current' : 'todo'}
		<button
			class="seg {state}"
			disabled={index >= step}
			onclick={() => onjump?.(index)}
			aria-current={index === step ? 'step' : undefined}
		>
			<span class="bar"></span>
			<span class="meta">
				<span class="num">
					{#if state === 'done'}
						<svg viewBox="0 0 14 14" width="11" height="11"
							><path
								d="M2.5 7.4 5.6 10.5 11.5 4"
								fill="none"
								stroke="currentColor"
								stroke-width="2.2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
					{:else}
						{index + 1}
					{/if}
				</span>
				<span class="label">{label}</span>
			</span>
		</button>
	{/each}
</nav>

<style>
	.stepper {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.seg {
		display: block;
		text-align: left;
		padding: 0;
		background: none;
	}

	.seg:disabled {
		cursor: default;
		opacity: 1;
	}

	.bar {
		display: block;
		height: 4px;
		border-radius: 999px;
		background: var(--surface-3);
		transition: background 0.3s;
	}

	.seg.done .bar {
		background: linear-gradient(90deg, var(--purple), var(--magenta));
	}

	.seg.current .bar {
		background: var(--accent-grad);
		box-shadow: 0 0 12px rgba(255, 77, 158, 0.4);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}

	.num {
		width: 19px;
		height: 19px;
		flex: none;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 10.5px;
		font-weight: 700;
		background: var(--surface-3);
		color: var(--text-faint);
	}

	.seg.done .num {
		background: var(--surface-3);
		color: var(--pink-soft);
	}

	.seg.current .num {
		background: var(--accent-grad);
		color: #fff;
	}

	.label {
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text-faint);
	}

	.seg.current .label {
		color: var(--text);
	}

	.seg.done .label {
		color: var(--text-dim);
	}

	.seg.done:hover .label {
		color: var(--pink-soft);
	}
</style>
