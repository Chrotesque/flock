<script lang="ts">
	import { PB_URL } from '$lib/pb';
	import { forgetServer } from '$lib/server';

	/**
	 * The server the website's copy of flock talks to, and a way to name
	 * another. Changing it starts the page over, which loses an upload being
	 * composed, so it takes a second press within two seconds.
	 */
	let { compact = false }: { compact?: boolean } = $props();

	let armed = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function change() {
		if (!armed) {
			armed = true;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => (armed = false), 2000);
			return;
		}
		forgetServer();
		location.reload();
	}
</script>

<div class="server" class:compact>
	<span class="what">Server</span>
	<code title={PB_URL}>{PB_URL}</code>
	<button
		type="button"
		class="btn change"
		class:armed
		onclick={change}
		title="Name another flock server. The page starts over, and an upload being composed is lost."
	>
		{armed ? 'Again to change' : 'Change…'}
	</button>
</div>

<style>
	.server {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 8px 8px 13px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		min-width: 0;
	}

	.what {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	code {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12.5px;
		color: var(--text);
	}

	.change {
		padding: 6px 12px;
		font-size: 12px;
	}

	.change.armed {
		border-color: var(--pink);
		color: var(--pink);
	}

	.compact {
		margin-top: 16px;
	}
</style>
