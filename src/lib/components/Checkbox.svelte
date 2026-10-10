<script lang="ts">
	let {
		checked = $bindable(false),
		label = '',
		disabled = false,
		ariaLabel,
		onchange
	}: {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		/** The accessible name when there is no visible label. */
		ariaLabel?: string;
		onchange?: (next: boolean) => void;
	} = $props();
</script>

<label class="wrap" class:disabled>
	<input
		type="checkbox"
		{checked}
		{disabled}
		aria-label={ariaLabel}
		onchange={(e) => {
			checked = e.currentTarget.checked;
			onchange?.(checked);
		}}
	/>
	<span class="box">
		<svg viewBox="0 0 14 14" aria-hidden="true">
			<path d="M2.5 7.4 5.6 10.5 11.5 4" />
		</svg>
	</span>
	{#if label}<span class="text">{label}</span>{/if}
</label>

<style>
	.wrap {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		cursor: pointer;
		user-select: none;
	}

	.wrap.disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.box {
		position: relative;
		width: 20px;
		height: 20px;
		flex: none;
		border-radius: 6px;
		border: 1.5px solid var(--border-strong);
		background: var(--bg-elev);
		display: grid;
		place-items: center;
		transition: background 0.16s, border-color 0.16s, box-shadow 0.16s;
	}

	.wrap:hover .box {
		border-color: var(--pink-soft);
	}

	svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: #fff;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 16;
		stroke-dashoffset: 16;
		transition: stroke-dashoffset 0.2s ease 0.04s;
	}

	input:checked + .box {
		background: var(--accent-grad);
		border-color: transparent;
		box-shadow: 0 2px 10px rgba(255, 77, 158, 0.35);
	}

	input:checked + .box svg {
		stroke-dashoffset: 0;
	}

	input:focus-visible + .box {
		outline: 2px solid var(--pink);
		outline-offset: 2px;
	}

	.text {
		font-size: 13px;
	}
</style>
