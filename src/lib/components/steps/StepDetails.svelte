<script lang="ts">
	import { base } from '$app/paths';
	import VideoPicker from '../VideoPicker.svelte';
	import PlatformIcon from '../PlatformIcon.svelte';
	import Checkbox from '../Checkbox.svelte';
	import PlatformModal from '../PlatformModal.svelte';
	import CharCount from '../CharCount.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { adapt } from '$lib/filters';
	import { draft } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { templates } from '$lib/stores/templates.svelte';
	import { portal } from '$lib/portal';
	import type { PlatformId, TextTemplate } from '$lib/types';

	templates.load();

	let modalOpen = $state(false);
	let modalPlatform = $state<PlatformId | null>(null);

	function openModal(platform: PlatformId) {
		modalPlatform = platform;
		modalOpen = true;
	}

	/* ---- template insertion ----
	 *
	 * A template lands wherever the caret last was, which means remembering the
	 * field and offsets before the click moves focus to the button.
	 */

	type Field = 'title' | 'description';

	let titleEl = $state<HTMLInputElement | null>(null);
	let descEl = $state<HTMLTextAreaElement | null>(null);
	let lastField = $state<Field>('description');
	let caret = { start: 0, end: 0 };

	function elementFor(field: Field) {
		return field === 'title' ? titleEl : descEl;
	}

	function remember(field: Field) {
		const el = elementFor(field);
		if (!el) return;
		lastField = field;
		caret = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
	}

	/**
	 * Writes the element as well as the store. These are controlled inputs, so
	 * Svelte only touches the DOM when the bound value actually changes — and an
	 * expansion can land on the exact string already bound (retyping the same
	 * `{name}` over the text it produced last time). The field would then keep
	 * showing the raw braces forever.
	 */
	function setField(field: Field, value: string) {
		if (field === 'title') draft.title = value;
		else draft.description = value;
		const el = elementFor(field);
		if (el && el.value !== value) el.value = value;
	}

	function place(field: Field, at: number) {
		const el = elementFor(field);
		if (!el) return;
		// After the DOM has taken the new value, or the caret jumps to the end.
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(at, at);
			caret = { start: at, end: at };
		});
	}

	function insert(template: TextTemplate) {
		const field = lastField;
		const value = field === 'title' ? draft.title : draft.description;
		const next = value.slice(0, caret.start) + template.content + value.slice(caret.end);
		setField(field, next);
		place(field, caret.start + template.content.length);
	}

	/**
	 * Swaps the first `{name}` that matches a template as it is typed. Unknown
	 * names are left alone, so braces stay usable as ordinary text.
	 */
	function onFieldInput(field: Field, event: Event) {
		const el = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		const value = el.value;
		setField(field, value);
		remember(field);

		for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
			const template = templates.byName(match[1]);
			if (!template || match.index === undefined) continue;
			const next =
				value.slice(0, match.index) + template.content + value.slice(match.index + match[0].length);
			setField(field, next);
			place(field, match.index + template.content.length);
			return;
		}
	}

	/* ---- template preview on hover ---- */

	let hovered = $state<TextTemplate | null>(null);
	let popX = $state(0);
	let popY = $state(0);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function previewOn(event: MouseEvent, template: TextTemplate) {
		const el = event.currentTarget as HTMLElement;
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => {
			const rect = el.getBoundingClientRect();
			popX = rect.left + rect.width / 2;
			popY = rect.top - 8;
			hovered = template;
		}, 300);
	}

	function previewOff() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = null;
		hovered = null;
	}

	$effect(() => () => {
		if (hoverTimer) clearTimeout(hoverTimer);
	});

	// One adaptation pass per platform, so the rail can show at a glance how
	// much each platform's text differs from what was typed. Only platforms
	// enabled in Settings appear here at all.
	let summaries = $derived(
		settings.available.map((entry) => {
			const def = PLATFORMS[entry.platform];
			const result = adapt(draft.title, draft.description, entry.filters);
			return {
				platform: entry.platform,
				def,
				hits: result.totalHits,
				errors: result.errors,
				overLimit:
					result.title.output.length > def.titleLimit ||
					result.description.output.length > def.descriptionLimit,
				overridden: Object.keys(draft.overrides[entry.platform] ?? {}).length > 0
			};
		})
	);
</script>

<div class="stage">
	<section class="main card">
		<div class="field">
			<div class="fieldhead">
				<label class="label" for="title">Title</label>
				<CharCount value={draft.title} limit={100} />
			</div>
			<input
				id="title"
				class="input"
				bind:this={titleEl}
				value={draft.title}
				oninput={(e) => onFieldInput('title', e)}
				onfocus={() => remember('title')}
				onclick={() => remember('title')}
				onkeyup={() => remember('title')}
				onselect={() => remember('title')}
				placeholder="One title — each platform adapts it"
				autocomplete="off"
			/>
		</div>

		<div class="field">
			<div class="fieldhead">
				<label class="label" for="description">Description</label>
				<CharCount value={draft.description} limit={5000} />
			</div>
			<textarea
				id="description"
				class="textarea"
				bind:this={descEl}
				value={draft.description}
				oninput={(e) => onFieldInput('description', e)}
				onfocus={() => remember('description')}
				onclick={() => remember('description')}
				onkeyup={() => remember('description')}
				onselect={() => remember('description')}
				placeholder="One description. Platform-specific quirks are handled by the adaptation rules in Settings."
			></textarea>
		</div>

		<div class="field">
			<span class="label">Video file</span>
			<VideoPicker bind:file={draft.file} bind:duration={draft.duration} />
		</div>
	</section>

	<section class="templates card">
		<header class="tplhead">
			<span class="label">Templates</span>
			<span class="tplnote">
				Click to drop one in at the cursor, or type its name in braces.
			</span>
		</header>

		{#if templates.loading}
			<p class="tplempty">Loading…</p>
		{:else if templates.items.length === 0}
			<p class="tplempty">
				None yet — add reusable text in <a href="{base}/settings">Settings</a>.
			</p>
		{:else}
			<div class="chips">
				{#each templates.items as template (template.id)}
					<button
						class="chip"
						onclick={() => insert(template)}
						onmouseenter={(e) => previewOn(e, template)}
						onmouseleave={previewOff}
						onfocus={(e) => previewOn(e as unknown as MouseEvent, template)}
						onblur={previewOff}
					>
						{template.name.trim() || 'Unnamed'}
					</button>
				{/each}
			</div>
			<p class="target">
				Inserts into the <strong>{lastField === 'title' ? 'title' : 'description'}</strong>.
			</p>
		{/if}
	</section>

	<aside class="rail card">
		<header>
			<h3>Platforms</h3>
			<span class="pill">{draft.activePlatforms.length} of {summaries.length}</span>
		</header>

		<p class="railnote">Click a platform to review its options and adapted text.</p>

		<ul>
			{#each summaries as item (item.platform)}
				<li class:off={!draft.selected[item.platform]}>
					<button class="open" onclick={() => openModal(item.platform)}>
						<span class="ic"><PlatformIcon platform={item.platform} size={19} /></span>
						<span class="who">
							<span class="name">{item.def.label}</span>
							<span class="tags">
								{#if item.errors > 0}
									<span class="tag bad">rule error</span>
								{:else if item.hits > 0}
									<span class="tag">{item.hits} adapted</span>
								{/if}
								{#if item.overLimit}
									<span class="tag warn">over limit</span>
								{/if}
								{#if item.overridden}
									<span class="tag alt">custom</span>
								{/if}
							</span>
						</span>
						<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
							<path
								d="M9 6l6 6-6 6"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<span class="check">
						<Checkbox
							checked={draft.selected[item.platform]}
							onchange={(next) => (draft.selected[item.platform] = next)}
						/>
					</span>
				</li>
			{/each}
		</ul>

		{#if summaries.length === 0}
			<p class="warnbox">
				No platforms are enabled. Turn one on in <a href="{base}/settings">Settings</a>.
			</p>
		{:else if draft.activePlatforms.length === 0}
			<p class="warnbox">Select at least one platform to continue.</p>
		{/if}
	</aside>
</div>

{#if hovered}
	<div class="preview" style="left: {popX}px; top: {popY}px" role="tooltip" use:portal>
		<p class="previewname">{hovered.name.trim() || 'Unnamed'}</p>
		<p class="previewbody">{hovered.content || '(empty)'}</p>
	</div>
{/if}

<PlatformModal bind:open={modalOpen} platform={modalPlatform} />

<style>
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 20px;
		align-items: start;
	}

	.templates {
		grid-column: 1;
		grid-row: 2;
		padding: 16px 18px;
	}

	.tplhead {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.tplhead .label {
		margin-bottom: 0;
	}

	.tplnote {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.tplempty {
		margin: 10px 0 0;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	.tplempty a {
		color: var(--pink-soft);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}

	.chip {
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		color: var(--text-dim);
		font-size: 12px;
		font-weight: 570;
		transition: background 0.14s, color 0.14s, border-color 0.14s;
	}

	.chip:hover {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.target {
		margin: 10px 0 0;
		font-size: 11px;
		color: var(--text-faint);
	}

	.target strong {
		color: var(--pink-soft);
		font-weight: 600;
	}

	.preview {
		position: fixed;
		z-index: 40;
		width: 300px;
		transform: translate(-50%, -100%);
		padding: 11px 13px;
		border-radius: var(--radius);
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
		pointer-events: none;
	}

	.previewname {
		margin: 0 0 5px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.previewbody {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		white-space: pre-wrap;
		max-height: 190px;
		overflow: hidden;
	}

	.main {
		grid-column: 1;
		grid-row: 1;
		padding: 22px;
		display: grid;
		gap: 20px;
	}

	.fieldhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.fieldhead .label {
		margin-bottom: 8px;
	}

	.rail {
		grid-column: 2;
		grid-row: 1 / span 2;
		padding: 18px 16px;
		position: sticky;
		top: 0;
	}

	.rail header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	h3 {
		font-size: 14px;
	}

	.railnote {
		margin: 0 0 14px;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.45;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 7px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px 4px 4px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.16s, opacity 0.16s, background 0.16s;
	}

	li:hover {
		border-color: var(--border-strong);
	}

	li.off {
		opacity: 0.42;
	}

	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 4px 8px 7px;
		color: var(--text-dim);
		text-align: left;
	}

	.open:hover {
		color: var(--text);
	}

	.ic {
		flex: none;
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	.who {
		min-width: 0;
		flex: 1;
	}

	.name {
		display: block;
		font-size: 13px;
		font-weight: 570;
		color: var(--text);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}

	.tag {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 999px;
		background: rgba(168, 85, 247, 0.16);
		color: #cfa8fb;
	}

	.tag.alt {
		background: rgba(255, 77, 158, 0.16);
		color: var(--pink-soft);
	}

	.tag.warn {
		background: rgba(251, 191, 36, 0.16);
		color: var(--warn);
	}

	.tag.bad {
		background: rgba(248, 113, 113, 0.16);
		color: var(--danger);
	}

	.check {
		flex: none;
	}

	.warnbox {
		margin: 14px 0 0;
		padding: 9px 11px;
		border-radius: var(--radius-sm);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		color: var(--warn);
		font-size: 11.5px;
	}

	.warnbox a {
		color: inherit;
		font-weight: 600;
	}

	@media (max-width: 1040px) {
		.stage {
			grid-template-columns: 1fr;
		}
		.main,
		.templates,
		.rail {
			grid-column: auto;
			grid-row: auto;
		}
		.rail {
			position: static;
		}
	}
</style>
