<script lang="ts">
	import ConfirmButton from './ConfirmButton.svelte';
	import { deviceName } from '$lib/log';
	import { users } from '$lib/stores/users.svelte';
	import { copyRefusal, deleteRefusal, devicesWithoutUser, PERSONAL_WORDS, type User } from '$lib/users';

	/**
	 * Settings → Users: who uses flock and their browsers, another user's own
	 * settings copied over yours, and a user deleted — each three presses
	 * within two seconds apiece (ConfirmButton), like naming a browser.
	 */
	let current = $derived(users.current);
	let lines = $derived(users.lines);
	let unclaimed = $derived(devicesWithoutUser(users.devices, users.list));

	let done = $state('');
	let error = $state('');

	async function copy(user: User) {
		done = error = '';
		try {
			await users.copyFrom(user);
			done = `You have ${user.name}'s settings now.`;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	async function remove(user: User) {
		done = error = '';
		try {
			await users.remove(user);
			done = `Deleted ${user.name}.`;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}
</script>

<div class="users">
	<section class="you">
		<p class="youline">
			You are <strong>{current?.name ?? '…'}</strong> on <strong>{deviceName()}</strong>.
		</p>
		<div class="split">
			<div>
				<h4>Your own</h4>
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
		<h4>Users</h4>
		<p class="hint">
			<strong>Copy to me</strong> replaces your own settings with theirs. <strong>Delete</strong>
			removes the user and their own settings; their browsers keep their names and are asked whose they
			are on their next visit. Each takes three presses.
		</p>

		{#if users.error}
			<p class="err">Could not read the users — {users.error}</p>
		{:else if !users.loaded}
			<p class="hint">Loading…</p>
		{/if}

		<ul class="list">
			{#each lines as line (line.user.id)}
				{@const copyWhy = copyRefusal(line.user.id, current?.id ?? '')}
				{@const deleteWhy = deleteRefusal(line.user.id, current?.id ?? '')}
				<li class:you={line.you}>
					<div class="who">
						<span class="name">
							{line.user.name}
							{#if line.you}<span class="tag">you</span>{/if}
						</span>
						<span class="browsers">
							{#if line.devices.length}
								{#each line.devices as name (name)}
									<span class="browser" class:here={line.you && name === deviceName()}>{name}</span>
								{/each}
							{:else}
								<span class="none">No browser yet</span>
							{/if}
						</span>
					</div>
					{#if !line.you}
						<div class="act">
							<ConfirmButton
								label="Copy to me"
								busyLabel="Copying…"
								disabled={Boolean(copyWhy)}
								title={copyWhy || `Replaces your own settings with ${line.user.name}'s`}
								onconfirm={() => copy(line.user)}
							/>
							<ConfirmButton
								label="Delete"
								busyLabel="Deleting…"
								danger
								disabled={Boolean(deleteWhy)}
								title={deleteWhy || `Deletes ${line.user.name} and their own settings`}
								onconfirm={() => remove(line.user)}
							/>
						</div>
					{:else}
						<p class="self">{deleteRefusal(line.user.id, line.user.id)}</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if done}<p class="done">{done}</p>{/if}
		{#if error}<p class="err">{error}</p>{/if}
	</section>

	{#if unclaimed.length}
		<section>
			<h4>Browsers with no user</h4>
			<p class="hint">
				Named before users existed, or their user was deleted. Each is asked whose it is on its next
				visit.
			</p>
			<p class="browsers">
				{#each unclaimed as name (name)}<span class="browser">{name}</span>{/each}
			</p>
		</section>
	{/if}
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

	.browsers {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin: 0;
	}

	.browser {
		padding: 2px 8px;
		border-radius: 6px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.browser.here {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.none {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.act {
		flex: none;
		display: grid;
		grid-template-columns: 130px 110px;
		gap: 6px;
	}

	.self {
		flex: none;
		margin: 0;
		max-width: 240px;
		font-size: 11.5px;
		color: var(--text-faint);
		text-align: right;
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
