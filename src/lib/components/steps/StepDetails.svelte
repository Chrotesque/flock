<script lang="ts">
	import { untrack } from 'svelte';
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
	import { templates, tokenOf } from '$lib/stores/templates.svelte';
	import { portal } from '$lib/portal';
	import type { PlatformId, TextTemplate } from '$lib/types';

	templates.load();

	let modalOpen = $state(false);
	let modalPlatform = $state<PlatformId | null>(null);

	function openModal(platform: PlatformId) {
		modalPlatform = platform;
		modalOpen = true;
	}

	/* ---- which platform is being composed ---- */

	/**
	 * Keeps the composed platform valid — on first render, and after the one
	 * being edited is unticked here or disabled in Settings.
	 *
	 * Depends on the active list only: reading `composing` as a dependency would
	 * re-run this every time it is written, which is the same shape as the
	 * PlatformModal and WeekCalendar loops. Hence the untrack.
	 */
	$effect(() => {
		const active = draft.activePlatforms;
		if (active.length === 0) return;
		const current = untrack(() => draft.composing);
		if (!current || !active.includes(current)) draft.composing = active[0];
	});

	let composing = $derived(
		draft.composing && draft.activePlatforms.includes(draft.composing) ? draft.composing : null
	);
	let def = $derived(composing ? PLATFORMS[composing] : null);
	let text = $derived(composing ? draft.textFor(composing) : { title: '', description: '' });

	let pills = $derived(
		draft.activePlatforms.map((platform) => ({
			platform,
			def: PLATFORMS[platform],
			complete: draft.isComplete(platform)
		}))
	);

	function compose(platform: PlatformId) {
		draft.composing = platform;
		// The new panel may not render a title at all, and its fields are fresh
		// anyway — start the caret somewhere that always exists.
		lastField = 'description';
		caret = { start: 0, end: 0 };
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
		if (!composing) return;
		draft.setText(composing, field, value);
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
		if (!composing) return;
		// A caption-only platform has no title element for the text to land in.
		const field: Field = lastField === 'title' && !def?.hasTitle ? 'description' : lastField;
		const value = draft.textFor(composing)[field];
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

	// One adaptation pass per platform, over that platform's own text, so the
	// rail can show at a glance what the rules will still do to what was typed.
	// Only platforms enabled in Settings appear here at all.
	let summaries = $derived(
		settings.available.map((entry) => {
			const platform = entry.platform;
			const own = draft.textFor(platform);
			const platformDef = PLATFORMS[platform];
			const result = adapt(own.title, own.description, entry.filters);
			return {
				platform,
				def: platformDef,
				hits: result.totalHits,
				errors: result.errors,
				overLimit:
					result.title.output.length > platformDef.titleLimit ||
					result.description.output.length > platformDef.descriptionLimit,
				overridden: Object.keys(draft.overrides[platform] ?? {}).length > 0,
				needsText: draft.selected[platform] && !draft.isComplete(platform)
			};
		})
	);
</script>

<div class="stage">
	<section class="main card">
		{#if pills.length > 0}
			<div class="pills" role="tablist" aria-label="Platform being composed">
				{#each pills as pill (pill.platform)}
					<button
						class="pilltab"
						class:on={composing === pill.platform}
						class:done={pill.complete}
						role="tab"
						aria-selected={composing === pill.platform}
						onclick={() => compose(pill.platform)}
					>
						<PlatformIcon platform={pill.platform} size={15} />
						<span class="pillname">{pill.def.label}</span>
						{#if pill.complete}
							<svg class="mark" viewBox="0 0 24 24" width="12" height="12" fill="none">
								<path
									d="M4 12.5 9.5 18 20 6.5"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						{:else}
							<span class="dot" aria-hidden="true"></span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if composing && def}
			{#if def.hasTitle}
				<div class="field">
					<div class="fieldhead">
						<label class="label" for="title">Title</label>
						<CharCount value={text.title} limit={def.titleLimit} />
					</div>
					<input
						id="title"
						class="input"
						bind:this={titleEl}
						value={text.title}
						oninput={(e) => onFieldInput('title', e)}
						onfocus={() => remember('title')}
						onclick={() => remember('title')}
						onkeyup={() => remember('title')}
						onselect={() => remember('title')}
						placeholder="Title for {def.label}"
						autocomplete="off"
					/>
				</div>
			{/if}

			<div class="field">
				<div class="fieldhead">
					<label class="label" for="description">
						{def.hasTitle ? 'Description' : 'Caption'}
					</label>
					<CharCount value={text.description} limit={def.descriptionLimit} />
				</div>
				<textarea
					id="description"
					class="textarea"
					bind:this={descEl}
					value={text.description}
					oninput={(e) => onFieldInput('description', e)}
					onfocus={() => remember('description')}
					onclick={() => remember('description')}
					onkeyup={() => remember('description')}
					onselect={() => remember('description')}
					placeholder="{def.hasTitle ? 'Description' : 'Caption'} for {def.label}"
				></textarea>
			</div>

			<p class="note">{def.fieldNote}</p>
		{:else}
			<p class="emptypanel">Tick a platform on the right to start composing.</p>
		{/if}
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
						disabled={!composing}
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
			{#if composing && def}
				<p class="target">
					Inserts into <strong>{def.label}</strong>'s
					<strong>
						{#if lastField === 'title' && def.hasTitle}title{:else if def.hasTitle}description{:else}caption{/if}
					</strong>.
				</p>
			{/if}
		{/if}
	</section>

	<div class="side">
		<aside class="rail card">
			<header>
				<h3>Platforms</h3>
				<span class="pill">{draft.activePlatforms.length} of {summaries.length}</span>
			</header>

			<p class="railnote">Tick which platforms this goes to. Click one to change its options.</p>

			<ul>
				{#each summaries as item (item.platform)}
					<li
						class:off={!draft.selected[item.platform]}
						class:active={composing === item.platform}
					>
						<button class="open" onclick={() => openModal(item.platform)}>
							<span class="ic"><PlatformIcon platform={item.platform} size={19} /></span>
							<span class="who">
								<span class="name">{item.def.label}</span>
								<span class="tags">
									{#if item.needsText}
										<span class="tag warn">needs text</span>
									{/if}
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
			{:else if draft.incompletePlatforms.length > 0}
				<div class="warnbox still">
					<span>Still to write</span>
					<span class="stillicons">
						{#each draft.incompletePlatforms as id (id)}
							<PlatformIcon platform={id} size={15} />
						{/each}
					</span>
				</div>
			{/if}
		</aside>

		<section class="videocard card">
			<span class="label">Video file</span>
			<VideoPicker bind:file={draft.file} bind:duration={draft.duration} />
		</section>
	</div>
</div>

{#if hovered}
	<div class="preview" style="left: {popX}px; top: {popY}px" role="tooltip" use:portal>
		<p class="previewname">
			{hovered.name.trim() || 'Unnamed'}
			{#if hovered.name.trim()}
				<span class="previewtoken">{'{'}{tokenOf(hovered.name)}{'}'}</span>
			{/if}
		</p>
		<p class="previewbody">{hovered.content || '(empty)'}</p>
	</div>
{/if}

<PlatformModal bind:open={modalOpen} platform={modalPlatform} />

<style>
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		column-gap: 20px;
		row-gap: 12px;
		align-items: start;
	}

	/* ---- compose panel ---- */

	.main {
		grid-column: 1;
		grid-row: 1;
		padding: 22px;
		display: grid;
		gap: 20px;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.pilltab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px 7px 11px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		color: var(--text-dim);
		font-size: 12.5px;
		font-weight: 570;
		transition: background 0.14s, color 0.14s, border-color 0.14s;
	}

	.pilltab:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.pilltab.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.pillname {
		line-height: 1;
	}

	.mark {
		flex: none;
		color: var(--ok);
	}

	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		border: 1.5px solid var(--text-faint);
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

	.note {
		margin: -6px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.45;
	}

	.emptypanel {
		margin: 0;
		padding: 26px 0;
		text-align: center;
		font-size: 13px;
		color: var(--text-faint);
	}

	/* ---- templates ---- */

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

	.chip:hover:not(:disabled) {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.chip:disabled {
		opacity: 0.45;
		cursor: not-allowed;
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

	/* ---- template preview ---- */

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
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin: 0 0 5px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.previewtoken {
		font-family: var(--mono);
		font-size: 10.5px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--pink-soft);
	}

	.previewbody {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		white-space: pre-wrap;
		max-height: 190px;
		overflow: hidden;
	}

	/* ---- right column: platforms, then the file ---- */

	.side {
		grid-column: 2;
		grid-row: 1 / span 2;
		display: grid;
		gap: 20px;
		align-content: start;
		position: sticky;
		top: 0;
	}

	.rail {
		padding: 18px 16px;
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

	li.active {
		border-color: var(--pink);
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

	/* Which platforms are outstanding, as icons pushed to the right edge. */
	.still {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.stillicons {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}

	.videocard {
		padding: 18px 16px;
		display: grid;
		gap: 4px;
	}

	@media (max-width: 1040px) {
		.stage {
			grid-template-columns: 1fr;
		}
		.main,
		.templates,
		.side {
			grid-column: auto;
			grid-row: auto;
		}
		.side {
			position: static;
		}
	}
</style>
