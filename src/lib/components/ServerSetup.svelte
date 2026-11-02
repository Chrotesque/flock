<script lang="ts">
	import { base } from '$app/paths';
	import { blockedReason, checkServer, keepServer, lastServer, serverAddress } from '$lib/server';

	/**
	 * The copy of flock on its website, before this browser has named its
	 * server: the one question it asks. Once a flock server answers at the
	 * address, it is kept and the page starts over on it.
	 */
	let typed = $state(lastServer());
	let busy = $state(false);
	let problem = $state('');

	async function connect(event: SubmitEvent) {
		event.preventDefault();
		problem = '';
		const address = serverAddress(typed);
		if (!address) {
			problem = 'That is no web address. It looks like https://flock.example.com.';
			return;
		}
		problem = blockedReason(address, location.protocol);
		if (problem) return;
		busy = true;
		problem = await checkServer(address);
		if (!problem && !keepServer(address)) {
			problem = 'This browser would not keep the address (a private window, or site data blocked), so flock cannot start here.';
		}
		if (problem) {
			busy = false;
			return;
		}
		location.reload();
	}
</script>

<div class="setup">
	<form class="card panel" onsubmit={connect}>
		<div class="head">
			<img src="{base}/flock.png" alt="" width="52" height="52" />
			<h1>Which flock server?</h1>
		</div>
		<p>
			This is flock, served from its website. Your uploads, settings and numbers live on the flock server
			you run yourself, and this page talks only to it — nothing passes through the website. Give the
			server's address, the one flock opens at there. This browser remembers it.
		</p>

		<label class="label" for="server-address">Server address</label>
		<input
			id="server-address"
			class="input"
			type="text"
			inputmode="url"
			autocomplete="url"
			spellcheck="false"
			placeholder="https://flock.example.com"
			bind:value={typed}
			disabled={busy}
		/>
		{#if problem}
			<p class="problem" role="alert">{problem}</p>
		{/if}

		<div class="actions">
			<button class="btn btn-primary" type="submit" disabled={busy || !typed.trim()}>
				{busy ? 'Checking…' : 'Connect'}
			</button>
		</div>

		<p class="foot">
			No server yet? flock runs on your own machine: see <a href="/how-it-works.html">how it works</a> and
			<a href="https://github.com/Chrotesque/flock#readme" target="_blank" rel="noopener">how to set it up</a>.
		</p>
	</form>
</div>

<style>
	.setup {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 24px 16px;
	}

	.panel {
		width: min(520px, 100%);
		padding: 28px 30px 24px;
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 14px;
	}

	.head img {
		border-radius: 12px;
	}

	h1 {
		font-size: 20px;
	}

	.panel > p {
		margin: 0 0 20px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-dim);
	}

	.problem {
		margin: 10px 0 0;
		padding: 9px 12px;
		border-radius: var(--radius);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--warn);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 16px;
	}

	.panel > .foot {
		margin: 20px 0 0;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-faint);
	}

	.foot a {
		color: var(--pink-soft);
	}

	.foot a:hover {
		color: var(--pink);
	}
</style>
