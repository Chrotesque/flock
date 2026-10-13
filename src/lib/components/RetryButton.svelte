<script lang="ts">
	import { retryTarget } from '$lib/repo';
	import { retryWhen } from '$lib/attention';

	/**
	 * Sends a failed post again (repo.retryTarget). Two presses within two
	 * seconds, like the upload's confirm tick, since it publishes; the label
	 * says when it would go out — at its slot while that is still ahead, now
	 * once it has passed. Used in the To finish panel and on an upload's
	 * overview in the Log.
	 */
	let { target, slot, onretried }: { target: string; slot: string; onretried?: () => void } = $props();

	let now = $state(new Date());
	let armed = $state(false);
	let busy = $state(false);
	let error = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	// A slot can pass while the button is on screen.
	$effect(() => {
		const clock = setInterval(() => (now = new Date()), 30_000);
		return () => {
			clearInterval(clock);
			if (timer) clearTimeout(timer);
		};
	});

	let when = $derived(retryWhen(slot, now));

	let label = $derived.by(() => {
		if (!when) return 'Retry now';
		const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		const today = when.toDateString() === now.toDateString();
		return `Retry · ${today ? '' : `${when.toLocaleDateString([], { weekday: 'short' })} `}${time}`;
	});

	let title = $derived(
		when
			? `Send it again: it goes out at its slot, ${when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Press twice.`
			: 'Send it again: its slot has passed, so it goes out at once. Press twice.'
	);

	async function press() {
		if (busy) return;
		if (!armed) {
			armed = true;
			error = '';
			now = new Date();
			timer = setTimeout(() => (armed = false), 2000);
			return;
		}
		if (timer) clearTimeout(timer);
		armed = false;
		busy = true;
		try {
			await retryTarget(target);
			onretried?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<span class="retry">
	<button class="rbtn" class:armed disabled={busy} onclick={press} {title}>
		{busy ? 'Retrying…' : armed ? 'Press again' : label}
	</button>
	{#if error}<span class="rerr" role="alert">{error}</span>{/if}
</span>

<style>
	.retry {
		display: inline-grid;
		justify-items: center;
		gap: 4px;
	}

	.rbtn {
		padding: 6px 16px;
		border-radius: 999px;
		border: 1px solid var(--pink);
		background: rgba(255, 77, 158, 0.1);
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: background 0.15s, box-shadow 0.15s;
	}

	.rbtn:hover:not(:disabled),
	.rbtn:focus-visible {
		background: rgba(255, 77, 158, 0.2);
		box-shadow: var(--glow);
		outline: none;
	}

	/* One more press sends it. */
	.rbtn.armed {
		background: var(--pink);
		color: var(--bg);
		box-shadow: var(--glow);
	}

	.rbtn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.rerr {
		max-width: 220px;
		font-size: 11.5px;
		line-height: 1.35;
		text-align: center;
		color: var(--danger);
	}
</style>
