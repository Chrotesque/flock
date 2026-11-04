<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import { readTikTokSignin, returnTikTokSignin } from '$lib/repo';
	import { doneWords, readReturn } from '$lib/tiktoksignin';

	/**
	 * Where TikTok sends the browser after its consent (tiktoksignin.ts): the
	 * code goes to the worker that opened the sign-in, which saves the account,
	 * and this page says how it went. The code leaves the address bar at once.
	 */
	type Shown = { kind: 'working' | 'done' | 'failed'; text: string };
	let shown = $state<Shown>({ kind: 'working', text: 'Handing the sign-in to flock…' });

	const GIVE_UP_MS = 90_000;

	onMount(() => {
		const answer = readReturn(new URLSearchParams(location.search));
		history.replaceState(history.state, '', location.pathname);
		void finish(answer);
	});

	async function finish(answer: ReturnType<typeof readReturn>) {
		if (answer.kind === 'none') {
			shown = { kind: 'failed', text: 'TikTok sent nothing back. Start the sign-in again from the Dashboard.' };
			return;
		}
		try {
			const handed = await returnTikTokSignin(
				answer.kind === 'code' ? { code: answer.code, state: answer.state } : { error: answer.error }
			);
			if (!handed) {
				shown = {
					kind: 'failed',
					text: 'No sign-in was waiting for this (it may have run out). Start it again from the Dashboard.'
				};
				return;
			}
		} catch (err) {
			shown = { kind: 'failed', text: err instanceof Error ? err.message : String(err) };
			return;
		}
		shown = { kind: 'working', text: 'Connecting the account…' };
		const started = Date.now();
		while (Date.now() - started < GIVE_UP_MS) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const row = await readTikTokSignin();
			if (row?.status === 'done') {
				shown = { kind: 'done', text: doneWords(row) };
				setTimeout(() => void goto(`${base}/upload?dashboard`), 2500);
				return;
			}
			if (row?.status === 'failed' || row?.status === 'expired') {
				shown = { kind: 'failed', text: row.error || 'The sign-in ran out. Start it again from the Dashboard.' };
				return;
			}
		}
		shown = { kind: 'failed', text: 'The worker did not finish the sign-in. Is it still running?' };
	}
</script>

<DeviceGate what="Signing in">
	<div class="connect">
		<div class="card panel {shown.kind}">
			<div class="head">
				<PlatformIcon platform="tiktok" size={22} />
				<h1>TikTok sign-in</h1>
			</div>
			<p role="status">{shown.text}</p>
			{#if shown.kind !== 'working'}
				<a class="btn" href="{base}/upload?dashboard">Back to the Dashboard</a>
			{/if}
		</div>
	</div>
</DeviceGate>

<style>
	.connect {
		display: grid;
		place-items: start center;
		padding: 80px 20px;
	}

	.panel {
		width: min(480px, 100%);
		padding: 24px 26px;
		display: grid;
		gap: 14px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	h1 {
		font-size: 18px;
	}

	p {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text-dim);
	}

	.done p {
		color: var(--ok);
	}

	.failed p {
		color: #fb923c;
	}

	.btn {
		justify-self: start;
	}
</style>
