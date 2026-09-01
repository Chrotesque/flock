<script lang="ts">
	import { deviceName, claimDeviceName, logAction } from '$lib/log';
	import { device as deviceState } from '$lib/stores/device.svelte';

	// Naming is one-way and globally unique. Past log entries are attributed to
	// this name, so a rename would quietly change what they mean; and two
	// machines sharing a name would make the log ambiguous. The button takes
	// three presses — one to ask, two to confirm — each within 2s.
	const CONFIRMATIONS = 2;

	let named = $derived(deviceState.named);
	let device = $state(deviceName());
	let draft = $state('');
	let stage = $state(0);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let stageTimer: ReturnType<typeof setTimeout> | null = null;

	function resetStage() {
		stage = 0;
		if (stageTimer) clearTimeout(stageTimer);
		stageTimer = null;
	}

	function onDraft(value: string) {
		draft = value;
		error = null;
		// Editing the name invalidates any confirmation already given.
		resetStage();
	}

	async function onConfirm() {
		if (!draft.trim() || busy) return;

		if (stage < CONFIRMATIONS) {
			stage += 1;
			if (stageTimer) clearTimeout(stageTimer);
			stageTimer = setTimeout(resetStage, 2000);
			return;
		}

		resetStage();
		busy = true;
		const result = await claimDeviceName(draft);
		busy = false;

		if (!result.ok) {
			error = result.reason;
			return;
		}

		deviceState.refresh();
		device = deviceName();
		draft = '';
		logAction('settings', 'Named this device', device);
	}

	let label = $derived(
		busy
			? 'Claiming…'
			: stage === 0
				? 'Set permanently'
				: stage < CONFIRMATIONS
					? `Cannot be undone — confirm (${stage}/${CONFIRMATIONS})`
					: `Confirm again (${stage}/${CONFIRMATIONS})`
	);

	$effect(() => () => {
		if (stageTimer) clearTimeout(stageTimer);
	});
</script>

{#if named}
	<div class="named">
		<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
			<path
				d="M7 10.5V8a5 5 0 0 1 10 0v2.5M6 10.5h12a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="devicename">{device}</span>
		<span class="lockhint">Set — this cannot be changed.</span>
	</div>
{:else}
	<div class="setrow">
		<input
			class="input device"
			value={draft}
			placeholder="e.g. Studio PC"
			disabled={busy}
			oninput={(e) => onDraft(e.currentTarget.value)}
		/>
		<button
			class="btn sm confirm"
			class:arming={stage > 0}
			onclick={onConfirm}
			onblur={resetStage}
			disabled={!draft.trim() || busy}
		>
			{label}
		</button>
	</div>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	<p class="hint">
		Names are unique across every machine, and cannot be changed once set. Until then the log would
		record this browser as <strong>{device}</strong>.
	</p>
{/if}

<style>
	.setrow {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.device {
		max-width: 260px;
		padding: 8px 11px;
		font-size: 12.5px;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.confirm.arming {
		background: var(--pink-hot);
		border-color: transparent;
		color: var(--bg);
		font-weight: 700;
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.named {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 13px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		color: var(--text-faint);
	}

	.devicename {
		font-size: 13px;
		font-weight: 620;
		color: var(--text);
	}

	.lockhint {
		font-size: 11.5px;
	}

	.err {
		margin: 10px 0 0;
		padding: 9px 11px;
		border-radius: var(--radius-sm);
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.35);
		font-size: 12px;
		color: var(--danger);
	}

	.hint {
		margin: 10px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.hint strong {
		color: var(--text-dim);
		font-weight: 600;
	}
</style>
