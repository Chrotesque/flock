<script lang="ts">
	import { users } from '$lib/stores/users.svelte';
	import { userNameProblem, USER_NAME_MAX, type User } from '$lib/users';

	// The gate's one question: which profile is this browser on? An existing
	// one is a press; a new one is a name and a press. No confirmations — it
	// can be switched any time in Settings → Profiles, and every switch is
	// logged.
	const NEW = '';
	let picked = $state<string | null>(null);
	let newName = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	let creating = $derived(users.loaded && (users.list.length === 0 || picked === NEW));

	function pick(id: string) {
		picked = id;
		error = null;
	}

	async function use(user: User) {
		busy = true;
		try {
			await users.use(user);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function create() {
		if (busy) return;
		const problem = userNameProblem(newName, users.list);
		if (problem) {
			error = problem;
			return;
		}
		busy = true;
		try {
			await users.createAndUse(newName);
			newName = '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if users.list.length > 0}
	<div class="field">
		<span class="fieldlabel">Pick your profile</span>
		<div class="users" role="group" aria-label="Profiles">
			{#each users.list as user (user.id)}
				<button class="userchip" disabled={busy} onclick={() => use(user)}>{user.name}</button>
			{/each}
			<button class="userchip add" class:on={creating} disabled={busy} onclick={() => pick(NEW)}>+ New profile</button>
		</div>
	</div>
{/if}

{#if creating}
	<form
		class="field"
		onsubmit={(e) => {
			e.preventDefault();
			void create();
		}}
	>
		<span class="fieldlabel">{users.list.length === 0 ? 'Your name' : 'New profile'}</span>
		<div class="setrow">
			<input
				class="input name"
				value={newName}
				maxlength={USER_NAME_MAX}
				placeholder="e.g. Sam, or Studio PC"
				disabled={busy}
				oninput={(e) => {
					newName = e.currentTarget.value;
					error = null;
				}}
			/>
			<button class="btn sm" type="submit" disabled={busy || !newName.trim()}>{busy ? 'Adding…' : 'Add and use'}</button>
		</div>
	</form>
{/if}

{#if error}
	<p class="err">{error}</p>
{:else if users.error}
	<p class="err">Could not read the profiles — {users.error}</p>
{/if}

<p class="hint">
	A profile is a person or a machine — whatever should have its own settings: the Dashboard's
	columns, the To finish indicator, time zones and hidden videos. Brands, uploads and folders are
	shared by everyone. The Log signs every change with the profile's name.
</p>

<style>

	.field {
		display: grid;
		gap: 7px;
		margin-bottom: 14px;
	}

	.fieldlabel {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-faint);
		letter-spacing: 0.02em;
	}

	.users {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.userchip {
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		font-weight: 560;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}

	.userchip:hover:not(:disabled) {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.userchip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.userchip.add {
		border-style: dashed;
	}

	.userchip.add.on {
		border-style: solid;
	}

	.name {
		max-width: 260px;
		padding: 8px 11px;
		font-size: 12.5px;
	}

	.setrow {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
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
</style>
