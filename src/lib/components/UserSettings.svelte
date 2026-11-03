<script lang="ts">
	import ConfirmButton from './ConfirmButton.svelte';
	import { users } from '$lib/stores/users.svelte';
	import { copyRefusal, PERSONAL_WORDS, type User } from '$lib/users';

	/**
	 * Settings → Profiles: who is using flock, with no logins. Switching is one
	 * press and logged; copying another profile's settings over yours and
	 * deleting a profile take three presses within two seconds apiece
	 * (ConfirmButton).
	 */
	let current = $derived(users.current);
	let lines = $derived(users.lines);

	let done = $state('');
	let error = $state('');

	async function run(what: () => Promise<void>, said: string) {
		done = error = '';
		try {
			await what();
			done = said;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<div class="users">
	<section class="you">
		<p class="youline">This browser is on <strong>{current?.name ?? '…'}</strong>.</p>
		<div class="split">
			<div>
				<h4>Each profile's own</h4>
				<ul class="what">
					{#each PERSONAL_WORDS as words (words)}
						<li>{words}</li>
					{/each}
				</ul>
			</div>
			<div>
				<h4>Shared by everyone</h4>
				<p class="shared">
					Brands and their accounts, defaults, rules and templates; uploads, the Calendar and the
					Log; folders and destinations; the worker.
				</p>
			</div>
		</div>
	</section>

	<section>
		<h4>Profiles</h4>
		<p class="hint">
			<strong>Switch</strong> puts this browser on that profile. <strong>Copy to me</strong> replaces
			your profile's settings with theirs. <strong>Delete</strong> removes the profile and its settings;
			browsers on it are asked for a profile again. Copy and Delete take three presses.
		</p>

		{#if users.error}
			<p class="err">Could not read the profiles — {users.error}</p>
		{:else if !users.loaded}
			<p class="hint">Loading…</p>
		{/if}

		<ul class="list">
			{#each lines as line (line.user.id)}
				{@const copyWhy = copyRefusal(line.user.id, current?.id ?? '')}
				<li class:you={line.you}>
					<div class="who">
						<span class="name">
							{line.user.name}
							{#if line.you}<span class="tag">this browser</span>{/if}
						</span>
					</div>
					<div class="act">
						<button
							class="btn sm"
							disabled={line.you}
							onclick={() => run(() => users.use(line.user), `This browser is on ${line.user.name} now.`)}>Switch</button
						>
						<ConfirmButton
							label="Copy to me"
							busyLabel="Copying…"
							disabled={Boolean(copyWhy)}
							title={copyWhy || `Replaces your profile's settings with ${line.user.name}'s`}
							onconfirm={() => run(() => users.copyFrom(line.user), `You have ${line.user.name}'s settings now.`)}
						/>
						<ConfirmButton
							label="Delete"
							busyLabel="Deleting…"
							danger
							title={line.you
								? 'Deletes this profile; this browser then asks for one again'
								: `Deletes ${line.user.name} and its settings`}
							onconfirm={() => run(() => users.remove(line.user), `Deleted ${line.user.name}.`)}
						/>
					</div>
				</li>
			{/each}
		</ul>

		{#if done}<p class="done">{done}</p>{/if}
		{#if error}<p class="err">{error}</p>{/if}
	</section>
</div>

<style>
	.users {
		display: grid;
		gap: 26px;
	}

	h4 {
		margin: 0 0 8px;
		font-size: 13px;
	}

	.you {
		padding: 14px 16px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
	}

	.youline {
		margin: 0 0 14px;
		font-size: 14px;
		color: var(--text-dim);
	}

	.youline strong {
		color: var(--text);
	}

	.split {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 22px;
	}

	@media (max-width: 760px) {
		.split {
			grid-template-columns: 1fr;
		}
	}

	.what {
		margin: 0;
		padding-left: 18px;
		font-size: 12.5px;
		line-height: 1.7;
		color: var(--text-dim);
	}

	.shared,
	.hint {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text-faint);
	}

	.hint {
		margin-bottom: 12px;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
		padding: 10px 12px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
	}

	.list li.you {
		border-color: rgba(255, 77, 158, 0.45);
	}

	.who {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 6px;
	}

	.name {
		font-size: 13.5px;
		font-weight: 620;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tag {
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--accent-grad-soft);
		border: 1px solid var(--pink);
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}


	.act {
		flex: none;
		display: grid;
		grid-template-columns: 90px 130px 110px;
		gap: 6px;
	}


	.sm {
		padding: 6px 12px;
		font-size: 12px;
	}

	.done {
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--ok);
	}

	.err {
		margin: 12px 0 0;
		padding: 9px 11px;
		border-radius: var(--radius-sm);
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.35);
		font-size: 12px;
		color: var(--danger);
	}
</style>
