<script lang="ts">
	import { general, type FolderListKey } from '$lib/stores/general.svelte';
	import { requestFolderPick } from '$lib/repo';
	import { folderKind } from '$lib/folders';

	/**
	 * One folder list in Settings — the watch folders or the project folders.
	 * A folder is added either way: picked in the Windows folder dialog on the
	 * PC the worker runs on (a browser cannot produce a real path), or typed,
	 * which is how a network path like \\nas\share goes in. Whether a folder
	 * is the network's or this PC's follows from its path (folders.ts), and
	 * each row says which.
	 */
	let {
		list,
		empty,
		importChoice = false
	}: {
		list: FolderListKey;
		/** What to say while the list is empty. */
		empty: string;
		/** Mark one network row as where local picks are copied (the watch list). */
		importChoice?: boolean;
	} = $props();

	let folders = $derived(general.value[list]);
	let importId = $derived(general.importFolder?.id ?? null);
	let hasLocal = $derived(folders.some((f) => f.path.trim() && folderKind(f.path) === 'local'));
	let networkCount = $derived(folders.filter((f) => f.path.trim() && folderKind(f.path) === 'network').length);

	/* `picking` is 'new' for an addition or the id of the row being changed. */
	let picking = $state<string | null>(null);
	let pickNote = $state('');

	async function choose(replacing?: string) {
		picking = replacing ?? 'new';
		pickNote = '';
		try {
			const path = await requestFolderPick({
				onWaiting: () =>
					(pickNote = 'Waiting for the worker to open the dialog — is it running on this PC?')
			});
			pickNote = '';
			if (!path) return;
			if (replacing) general.setFolder(list, replacing, path, true);
			else general.addFolder(list, path, true);
		} catch (err) {
			pickNote = err instanceof Error ? err.message : String(err);
		} finally {
			picking = null;
		}
	}
</script>

<div class="actions">
	<button class="btn sm" onclick={() => choose()} disabled={picking !== null}>
		{picking === 'new' ? 'Waiting…' : 'Choose folder…'}
	</button>
	<button class="btn sm ghost" onclick={() => general.addFolder(list)}>Type a path</button>
</div>

{#if pickNote}
	<p class="hint warn pick">{pickNote}</p>
{/if}

{#if folders.length === 0}
	<p class="empty">{empty}</p>
{:else}
	<ul>
		{#each folders as folder (folder.id)}
			{@const kind = folder.path.trim() ? folderKind(folder.path) : null}
			{@const imports = importChoice && kind === 'network' && folder.id === importId}
			<li class:imports>
				{#if folder.chosen}
					<span class="path" title={folder.path}>{folder.path}</span>
				{:else}
					<input
						class="input path-input"
						value={folder.path}
						oninput={(e) => general.setFolder(list, folder.id, e.currentTarget.value)}
						placeholder="\\nas\videos\incoming"
						autocomplete="off"
						spellcheck="false"
						aria-label="Folder path"
					/>
				{/if}

				{#if kind}
					<span
						class="kind {kind}"
						title={kind === 'network'
							? 'On the network: read where it lies by the worker that publishes'
							: 'On the PC the local worker runs on'}
					>
						{kind === 'network' ? 'LAN' : 'Local'}
					</span>
				{/if}

				{#if importChoice && kind === 'network' && networkCount > 1}
					<button
						class="radio"
						role="radio"
						aria-checked={imports}
						title={imports ? 'Local videos are copied here' : 'Copy local videos here instead'}
						aria-label={imports ? 'Local videos are copied here' : 'Copy local videos here instead'}
						onclick={() => general.setImportFolder(folder.id)}
					>
						<span class="dot"></span>
					</button>
				{/if}

				<button class="btn sm ghost" onclick={() => choose(folder.id)} disabled={picking !== null}>
					{picking === folder.id ? 'Waiting…' : 'Change…'}
				</button>
				<button class="del" onclick={() => general.removeFolder(list, folder.id)} aria-label="Remove folder">
					<svg viewBox="0 0 16 16" width="13" height="13"
						><path
							d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
				</button>
			</li>
		{/each}
	</ul>

	{#if importChoice && hasLocal}
		{#if general.importFolder}
			<p class="hint">
				Local videos are copied into <code>{general.importFolder.path}</code> by the worker before anything
				is published{networkCount > 1 ? ' — the filled circle marks it' : ''}, so the upload no longer depends
				on the PC afterwards.
			</p>
		{:else}
			<p class="hint warn">
				Add a LAN folder too: local videos are copied into one before they are published. Only a single
				worker that both lists and publishes on this PC can do without.
			</p>
		{/if}
	{/if}
{/if}

<style>
	.actions {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.ghost {
		background: transparent;
	}

	.empty {
		margin: 0;
		padding: 16px;
		border-radius: var(--radius);
		border: 1px dashed var(--border-strong);
		font-size: 12.5px;
		color: var(--text-faint);
		line-height: 1.6;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.15s;
	}

	li.imports {
		border-color: rgba(255, 77, 158, 0.4);
	}

	.path {
		flex: 1;
		min-width: 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.path-input {
		flex: 1;
		min-width: 0;
		padding: 6px 10px;
		font-family: var(--mono);
		font-size: 12px;
	}

	.kind {
		flex: none;
		padding: 1px 7px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
		cursor: help;
		background: var(--surface-2);
		color: var(--text-dim);
	}

	.kind.network {
		color: var(--pink-soft);
	}

	.radio {
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
		display: grid;
		place-items: center;
		transition: border-color 0.15s;
	}

	.radio:hover {
		border-color: var(--pink-soft);
	}

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: transparent;
		transition: background 0.15s;
	}

	li.imports .radio {
		border-color: var(--pink);
	}

	li.imports .dot {
		background: var(--accent-grad);
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
	}

	.del:hover {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.hint {
		margin: 12px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.hint code {
		font-family: var(--mono);
		font-size: 11px;
		overflow-wrap: anywhere;
	}

	.hint.warn {
		color: var(--warn);
	}

	.pick {
		margin: 0 0 12px;
	}
</style>
