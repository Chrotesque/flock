<script lang="ts">
	import { deviceName, claimDeviceName, logAction } from '$lib/log';
	import { device as deviceState } from '$lib/stores/device.svelte';
	import { users } from '$lib/stores/users.svelte';
	import { userNameProblem, USER_NAME_MAX, type User } from '$lib/users';

	// Naming is one-way and globally unique. Past log entries are attributed to
	// this name, so a rename would quietly change what they mean; and two
	// machines sharing a name would make the log ambiguous. The same box says
	// whose the browser is (users.ts) — an existing user, or a new one — or,
	// for a browser named before users existed, only that. The button takes
	// three presses — one to ask, two to confirm — each within 2s.
	const CONFIRMATIONS = 2;

	/** Named already: only whose it is is asked. */
	let named = $derived(deviceState.named);

	let draft = $state('');
	// The user picked, or NEW for one typed in.
	const NEW = '';
	let picked = $state<string>(NEW);
	let newName = $state('');
	let stage = $state(0);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let stageTimer: ReturnType<typeof setTimeout> | null = null;

	// With users to pick from, none is picked at first: a new browser is most
	// likely someone's who has one already.
	let choosing = $state(false);
	let creating = $derived(users.list.length === 0 || (choosing && picked === NEW));

	function resetStage() {
		stage = 0;
		if (stageTimer) clearTimeout(stageTimer);
		stageTimer = null;
	}

	function changed() {
		error = null;
		// Editing anything invalidates any confirmation already given.
		resetStage();
	}

	function pick(id: string) {
		picked = id;
		choosing = true;
		changed();
	}

	let ready = $derived(
		(named || Boolean(draft.trim())) && (creating ? Boolean(newName.trim()) : choosing && Boolean(picked))
	);

	async function onConfirm() {
		if (!ready || busy) return;

		if (stage < CONFIRMATIONS) {
			stage += 1;
			if (stageTimer) clearTimeout(stageTimer);
			stageTimer = setTimeout(resetStage, 2000);
			return;
		}

		resetStage();
		if (creating) {
			const problem = userNameProblem(newName, users.list);
			if (problem) {
				error = problem;
				return;
			}
		}

		busy = true;
		try {
			let user: User | null = creating ? null : (users.list.find((u) => u.id === picked) ?? null);
			if (!creating && !user) throw new Error('That user is gone. Pick another.');
			if (!user) user = await users.create(newName);
			const isNew = creating;
			// The user is there now, whatever happens next: a second try picks it.
			picked = user.id;
			choosing = true;
			newName = '';

			if (named) {
				await users.join(user, isNew);
				return;
			}
			const result = await claimDeviceName(draft, user.id);
			if (!result.ok) {
				error = result.reason;
				return;
			}
			draft = '';
			logAction('settings', 'Named this device', `${deviceName()} · ${user.name}`);
			await users.named(user, isNew);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	let label = $derived(
		busy
			? 'Setting…'
			: stage > 0
				? `Confirm? (${stage}/${CONFIRMATIONS})`
				: named
					? 'Set the user'
					: 'Set permanently'
	);

	$effect(() => () => {
		if (stageTimer) clearTimeout(stageTimer);
	});
</script>

{#if named}
	<p class="this">This browser is <strong>{deviceName()}</strong>. Whose is it?</p>
{/if}

<div class="field">
	<span class="fieldlabel">{users.list.length === 0 ? 'Your name' : 'Who uses this browser'}</span>
	{#if users.list.length > 0}
		<div class="users" role="radiogroup" aria-label="User">
			{#each users.list as user (user.id)}
				<button
					class="userchip"
					class:on={choosing && picked === user.id}
					role="radio"
					aria-checked={choosing && picked === user.id}
					disabled={busy}
					onclick={() => pick(user.id)}>{user.name}</button
				>
			{/each}
			<button
				class="userchip add"
				class:on={creating}
				role="radio"
				aria-checked={creating}
				disabled={busy}
				onclick={() => pick(NEW)}>+ New user</button
			>
		</div>
	{/if}
	{#if creating}
		<input
			class="input name"
			value={newName}
			maxlength={USER_NAME_MAX}
			placeholder="e.g. Sam"
			disabled={busy}
			oninput={(e) => {
				newName = e.currentTarget.value;
				changed();
			}}
		/>
	{/if}
</div>

{#if !named}
	<div class="field">
		<span class="fieldlabel">This browser's name</span>
		<input
			class="input name"
			value={draft}
			placeholder="e.g. Studio PC"
			disabled={busy}
			oninput={(e) => {
				draft = e.currentTarget.value;
				changed();
			}}
		/>
	</div>
{/if}

<div class="setrow">
	<button class="btn sm confirm" class:arming={stage > 0} onclick={onConfirm} onblur={resetStage} disabled={!ready || busy}>
		{label}
	</button>
</div>

{#if error}
	<p class="err">{error}</p>
{:else if users.error}
	<p class="err">Could not read the users — {users.error}</p>
{/if}

<p class="hint">
	{#if named}
		Each user has their own settings: the Dashboard's columns, the To finish indicator, time zones
		and hidden videos. Brands, uploads and folders are shared by everyone.
	{:else}
		Browser names are unique across every machine, and cannot be changed once set. Each user has
		their own settings; brands, uploads and folders are shared by everyone.
	{/if}
</p>

<style>
	.this {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--text-dim);
	}

	.this strong {
		color: var(--text);
	}

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

	.confirm.arming {
		background: var(--pink-hot);
		border-color: transparent;
		color: var(--bg);
		font-weight: 700;
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
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
