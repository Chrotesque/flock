<script lang="ts">
	import { templates } from '$lib/stores/templates.svelte';

	// One template open at a time: the bodies are multi-line, and a list of them
	// all expanded buries the names you are scanning for.
	let expanded = $state<string | null>(null);

	function toggle(id: string) {
		expanded = expanded === id ? null : id;
	}

	function add() {
		expanded = templates.add();
	}

	/**
	 * Names are stored lower case so `{name}` lookups and the hints agree. The
	 * caret is restored by hand because writing `value` moves it to the end, and
	 * the case fold happens mid-typing.
	 */
	function onName(id: string, el: HTMLInputElement) {
		const next = el.value.toLowerCase();
		if (el.value !== next) {
			const at = el.selectionStart ?? next.length;
			el.value = next;
			el.setSelectionRange(at, at);
		}
		templates.update(id, { name: next });
	}

	/* ---- delete confirmation ----
	 *
	 * Same two-press gate as the Calendar's Edit button: templates are shared by
	 * every future upload and there is no undo.
	 */
	let armed = $state<string | null>(null);
	let armTimer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		armed = null;
		if (armTimer) clearTimeout(armTimer);
		armTimer = null;
	}

	function onDelete(id: string) {
		if (armed === id) {
			disarm();
			if (expanded === id) expanded = null;
			templates.remove(id);
			return;
		}
		disarm();
		armed = id;
		armTimer = setTimeout(() => {
			armed = null;
			armTimer = null;
		}, 2000);
	}

	$effect(() => () => {
		if (armTimer) clearTimeout(armTimer);
	});
</script>

<div class="editor">
	<header>
		<div>
			<h4>Text templates</h4>
			<p>
				Blocks of text you reuse. On the upload screen they appear under the details, and typing a
				template's name in braces — <code>{'{'}outro{'}'}</code> — swaps it in as you write.
			</p>
		</div>
		<button class="btn sm" onclick={add}>Add template</button>
	</header>

	{#if templates.items.length === 0}
		<p class="empty">
			No templates yet. Add one for anything you retype — a sign-off, a disclaimer, a stock set of
			hashtags.
		</p>
	{:else}
		<ul>
			{#each templates.items as template (template.id)}
				{@const open = expanded === template.id}
				<li class:open>
					<div class="top">
						<button
							class="twist"
							class:open
							onclick={() => toggle(template.id)}
							aria-expanded={open}
							aria-label={open ? 'Collapse template' : 'Expand template'}
						>
							<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
								<path
									d="M4.5 2.5 8 6l-3.5 3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.7"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>

						<input
							class="input name"
							placeholder="name (e.g. outro)"
							value={template.name}
							oninput={(e) => onName(template.id, e.currentTarget)}
						/>

						<button
							class="del"
							class:armed={armed === template.id}
							onclick={() => onDelete(template.id)}
							onblur={disarm}
							aria-label={armed === template.id ? 'Confirm delete' : 'Delete template'}
						>
							{#if armed === template.id}
								<span class="ask">?</span>
							{:else}
								<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
									><path
										d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
										fill="none"
										stroke="currentColor"
										stroke-width="1.4"
										stroke-linecap="round"
										stroke-linejoin="round"
									/></svg
								>
							{/if}
						</button>
					</div>

					{#if open}
						<textarea
							class="textarea body"
							placeholder="What this template inserts"
							value={template.content}
							oninput={(e) => templates.update(template.id, { content: e.currentTarget.value })}
						></textarea>

						{#if template.name.trim()}
							<p class="hint">
								Insert by typing <code>{'{'}{template.name.trim()}{'}'}</code>
							</p>
						{:else}
							<p class="hint warn">Give it a name to use the brace shortcut.</p>
						{/if}
					{:else}
						<p class="collapsed">
							{template.content.trim().split('\n')[0] || 'Empty'}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.editor header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}

	h4 {
		font-size: 13.5px;
	}

	header p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
		max-width: 58ch;
	}

	code {
		font-family: var(--mono);
		font-size: 11px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--pink-soft);
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
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
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		display: grid;
		gap: 8px;
		transition: border-color 0.15s;
	}

	li.open {
		border-color: var(--border-strong);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.twist {
		flex: none;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
		transition: transform 0.16s, color 0.14s, background 0.14s;
	}

	.twist:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	.twist.open {
		transform: rotate(90deg);
		color: var(--pink);
	}

	.name {
		flex: 1;
		min-width: 0;
		padding: 8px 11px;
		font-size: 13px;
		font-weight: 560;
	}

	.body {
		min-height: 92px;
		font-size: 12.5px;
	}

	.collapsed {
		margin: 0;
		padding-left: 32px;
		font-size: 11.5px;
		color: var(--text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
		transition: background 0.14s, color 0.14s;
	}

	.del:hover {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	/* Armed: the same hot pink the other confirmation gates use, with the row's
	   own background as the text colour. */
	.del.armed,
	.del.armed:hover {
		background: var(--pink-hot);
		color: var(--bg-elev);
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.ask {
		font-size: 14px;
		font-weight: 800;
		line-height: 1;
	}

	.hint {
		margin: 0;
		font-size: 11px;
		color: var(--text-faint);
	}

	.hint.warn {
		color: var(--warn);
	}

	@media (prefers-reduced-motion: reduce) {
		.twist {
			transition: color 0.14s, background 0.14s;
		}
	}
</style>
