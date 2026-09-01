<script lang="ts">
	import { templates } from '$lib/stores/templates.svelte';
</script>

<div class="editor">
	<header>
		<div>
			<h4>Text templates</h4>
			<p>
				Blocks of text you reuse. On the upload screen they appear under the details, and typing a
				template's name in braces — <code>{'{'}Outro{'}'}</code> — swaps it in as you write.
			</p>
		</div>
		<button class="btn sm" onclick={() => templates.add()}>Add template</button>
	</header>

	{#if templates.items.length === 0}
		<p class="empty">
			No templates yet. Add one for anything you retype — a sign-off, a disclaimer, a stock set of
			hashtags.
		</p>
	{:else}
		<ul>
			{#each templates.items as template (template.id)}
				<li>
					<div class="top">
						<input
							class="input name"
							placeholder="Name (e.g. Outro)"
							value={template.name}
							oninput={(e) => templates.update(template.id, { name: e.currentTarget.value })}
						/>
						<button
							class="del"
							onclick={() => templates.remove(template.id)}
							aria-label="Delete template"
						>
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
					</div>

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
		gap: 10px;
	}

	li {
		padding: 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		display: grid;
		gap: 8px;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 8px;
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
		margin: 0;
		font-size: 11px;
		color: var(--text-faint);
	}

	.hint.warn {
		color: var(--warn);
	}
</style>
