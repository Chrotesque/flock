<script lang="ts">
	/**
	 * A button for something that cannot be taken back: one press asks, then
	 * `confirmations` more do it, each within two seconds of the last — the
	 * pattern of naming a device and moving an upload to another brand.
	 */
	let {
		label,
		busyLabel = 'Working…',
		confirmations = 2,
		disabled = false,
		danger = false,
		title = '',
		onconfirm
	}: {
		label: string;
		busyLabel?: string;
		confirmations?: number;
		disabled?: boolean;
		danger?: boolean;
		title?: string;
		onconfirm: () => void | Promise<void>;
	} = $props();

	let stage = $state(0);
	let busy = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		stage = 0;
		if (timer) clearTimeout(timer);
		timer = null;
	}

	async function press() {
		if (busy || disabled) return;
		if (timer) clearTimeout(timer);
		if (stage < confirmations) {
			stage += 1;
			timer = setTimeout(() => (stage = 0), 2000);
			return;
		}
		disarm();
		busy = true;
		try {
			await onconfirm();
		} finally {
			busy = false;
		}
	}

	$effect(() => () => {
		if (timer) clearTimeout(timer);
	});
</script>

<button class="confirm" class:armed={stage > 0} class:danger {disabled} {title} onclick={press} onblur={disarm}>
	{busy ? busyLabel : stage > 0 ? `Confirm? (${stage}/${confirmations})` : label}
</button>

<style>
	.confirm {
		width: 100%;
		padding: 7px 10px;
		border-radius: 7px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		font-weight: 560;
		text-align: left;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}

	.confirm:hover:not(:disabled),
	.confirm:focus-visible {
		border-color: var(--pink-soft);
		outline: none;
	}

	.confirm.danger:hover:not(:disabled) {
		border-color: rgba(248, 113, 113, 0.6);
		color: var(--danger);
	}

	/* Asked; one or two more presses do it. */
	.confirm.armed {
		background: var(--pink);
		border-color: transparent;
		color: var(--bg);
	}

	.confirm.danger.armed {
		background: var(--danger);
		color: var(--bg);
	}

	.confirm:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
