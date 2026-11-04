<script lang="ts">
	import { base } from '$app/paths';
	import PlatformIcon from './PlatformIcon.svelte';
	import { startTikTokSignin } from '$lib/repo';
	import { signinRedirect } from '$lib/tiktoksignin';

	/**
	 * Signs a TikTok account in from flock's page: the worker hands back
	 * TikTok's consent address (tiktoksignin.ts), this tab goes there, and
	 * TikTok sends it back to /connect/tiktok.
	 */
	let busy = $state(false);
	let problem = $state('');

	async function signIn() {
		busy = true;
		problem = '';
		try {
			const answer = await startTikTokSignin(signinRedirect(location.origin, base));
			if (answer === 'timeout') {
				problem =
					'No worker answers TikTok sign-ins. Its config needs tiktok.pageSignin, or run pnpm tiktok:demo serve for the sandbox.';
			} else if ('error' in answer) {
				problem = answer.error;
			} else {
				location.assign(answer.url);
				return;
			}
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		}
		busy = false;
	}
</script>

<button type="button" class="signin" onclick={signIn} disabled={busy}>
	<PlatformIcon platform="tiktok" size={14} />
	<span>{busy ? 'Opening TikTok…' : 'Continue with TikTok'}</span>
</button>
{#if problem}
	<p class="problem">{problem}</p>
{/if}

<style>
	.signin {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: 8px;
		margin-top: 4px;
		padding: 7px 14px;
		border: 1px solid #3a3a3a;
		border-radius: 8px;
		background: #000;
		color: #fff;
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
	}

	.signin:hover:not(:disabled) {
		border-color: #fff;
	}

	.signin:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.problem {
		margin: 4px 0 0;
		color: #fb923c;
		line-height: 1.45;
	}
</style>
