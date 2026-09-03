<script lang="ts">
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import VideoPicker from '../VideoPicker.svelte';
	import PlatformIcon from '../PlatformIcon.svelte';
	import Checkbox from '../Checkbox.svelte';
	import TagInput from '../TagInput.svelte';
	import PlatformModal from '../PlatformModal.svelte';
	import CharCount from '../CharCount.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { adapt } from '$lib/filters';
	import { draft } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { templates, tokenOf } from '$lib/stores/templates.svelte';
	import { loadWatchIndex, loadRecentTags } from '$lib/repo';
	import { tagSets } from '$lib/stores/tagsets.svelte';
	import { formatBytes, mergeTagGroups, tagListLength, parseTagList } from '$lib/format';
	import { portal } from '$lib/portal';
	import type { PlatformId, TextTemplate, WatchIndex } from '$lib/types';

	templates.load();
	general.load();
	tagSets.load();

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

	/* ---- videos already sitting on the NAS ----
	 *
	 * The browser cannot read a filesystem, so the listing comes from the worker
	 * by way of PocketBase. It is therefore as fresh as the worker's last poll,
	 * which is why the scan time is shown rather than implied.
	 */

	let watchIndex = $state<WatchIndex | null>(null);
	let watchLoading = $state(false);

	async function refreshWatch() {
		if (!general.value.watchFolder) return;
		watchLoading = true;
		try {
			watchIndex = await loadWatchIndex();
		} catch {
			watchIndex = null;
		} finally {
			watchLoading = false;
		}
	}

	// Depends on the configured folder only: setting one in Settings should make
	// the list appear without a reload, but nothing here writes what it reads.
	$effect(() => {
		void general.value.watchFolder;
		void refreshWatch();
	});

	let scannedLabel = $derived.by(() => {
		if (!watchIndex?.scannedAt) return 'never';
		const at = new Date(watchIndex.scannedAt);
		if (Number.isNaN(at.getTime())) return 'never';
		const mins = Math.round((Date.now() - at.getTime()) / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins} min ago`;
		return at.toLocaleString();
	});

	function compose(platform: PlatformId) {
		draft.composing = platform;
		// The new panel may not render a title at all, and its fields are fresh
		// anyway — start the caret somewhere that always exists.
		lastField = 'description';
		caret = { start: 0, end: 0 };
	}

	/* ---- the promoted option field ----
	 *
	 * A platform may pull one of its options onto this screen via `composeField`
	 * in the registry; today only YouTube does, for its tags. The card only
	 * appears for those platforms, so everyone else keeps the templates box at
	 * full width.
	 */

	// What the last upload for each platform went out with. Read once: the
	// compose screen is not where tags are edited between uploads.
	let recentTags = $state<Partial<Record<PlatformId, Record<string, string[]>>>>({});
	void loadRecentTags().then((found) => (recentTags = found));

	/** The tag boxes this platform promotes, in registry order. */
	let tagFields = $derived(
		(def?.composeFields ?? [])
			.map((key) => def?.fields.find((f) => f.key === key))
			.filter((f): f is NonNullable<typeof f> => Boolean(f) && f!.type === 'tags')
	);

	/** Which box an inserted set lands in — the last one focused. */
	let lastTagKey = $state<string | null>(null);

	/** Which tag tab is showing. "final" is the merged, read-only view. */
	let tagTab = $state<string>('final');

	let activeBoxLabel = $derived(
		tagFields.find((f) => f.key === lastTagKey)?.label ?? tagFields[0]?.label ?? '—'
	);

	// Keeps the target valid when the platform changes. Depends on the field list
	// only and reads the current key through untrack: the same shape as the
	// composing effect above, for the same reason.
	$effect(() => {
		const keys = tagFields.map((f) => f.key);
		if (keys.length === 0) return;
		const current = untrack(() => lastTagKey);
		if (!current || !keys.includes(current)) lastTagKey = keys[0];
		const tab = untrack(() => tagTab);
		if (tab !== 'final' && !keys.includes(tab)) tagTab = 'final';
	});

	/**
	 * Read straight through rather than into local state. Seeding a copy is what
	 * needs the untrack dance in PlatformModal, and there is nothing to gain from
	 * it here: the override map is already the only home this value has.
	 *
	 * Override first — an empty array is a deliberate "no tags" and must not fall
	 * through. Then the list this box went out with last time, which is the whole
	 * point of remembering it. The saved default is the fallback on a fresh
	 * install.
	 */
	function tagValue(key: string): string[] {
		if (!composing) return [];
		const raw =
			draft.overrides[composing]?.[key] ??
			recentTags[composing]?.[key] ??
			settings.defaultsFor(composing)[key];
		return Array.isArray(raw) ? raw : [];
	}

	function setTagField(key: string, next: string[]) {
		if (!composing) return;
		draft.overrides[composing] = { ...(draft.overrides[composing] ?? {}), [key]: next };
	}

	/** Drops a saved set into the box that was last focused. */
	function applySet(tags: string[]) {
		const key = lastTagKey ?? tagFields[0]?.key;
		if (!key) return;
		const current = tagValue(key);
		const added = parseTagList(tags.join(','), current);
		if (added.length > 0) setTagField(key, [...current, ...added]);
	}

	function clearAllTags() {
		for (const field of tagFields) setTagField(field.key, []);
	}

	/** Which box a merged tag came from, for the tooltip on the Final tab. */
	function sourceOf(tag: string): string {
		const key = tag.toLowerCase();
		return (
			tagFields.find((f) => tagValue(f.key).some((t) => t.toLowerCase() === key))?.label ?? ''
		);
	}

	/**
	 * Deleting from the Final tab removes the tag from the box it actually lives
	 * in. Every box, in fact: the merge is case-insensitive, so a tag sitting in
	 * two boxes appears once here — taking it out of only the first would leave
	 * it to reappear the moment the list rebuilt.
	 */
	function removeEverywhere(tag: string) {
		const key = tag.toLowerCase();
		for (const field of tagFields) {
			const current = tagValue(field.key);
			const next = current.filter((t) => t.toLowerCase() !== key);
			if (next.length !== current.length) setTagField(field.key, next);
		}
	}

	/**
	 * One budget across every box, because YouTube's 500 characters cover the
	 * whole list. Counted off the *merged* list, so a tag repeated between boxes
	 * is charged once — exactly as it will be when published.
	 */
	let tagsMerged = $derived(
		mergeTagGroups(
			Object.fromEntries(tagFields.map((f) => [f.key, tagValue(f.key)])),
			tagFields.map((f) => f.key)
		)
	);
	let tagsUsed = $derived(tagListLength(tagsMerged));
	let tagsOver = $derived(tagsUsed > (def?.tagBudget?.limit ?? Infinity));

	/** True while every box still shows what the last upload used, untouched. */
	let showingRecent = $derived(
		Boolean(
			composing &&
				tagFields.length > 0 &&
				tagFields.every((f) => draft.overrides[composing!]?.[f.key] === undefined) &&
				tagFields.some((f) => (recentTags[composing!]?.[f.key]?.length ?? 0) > 0)
		)
	);

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

{#snippet pencil()}
	<svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
		<path
			d="M4.5 19.5h4L19 9l-4-4L4.5 15.5v4Z"
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linejoin="round"
		/>
	</svg>
{/snippet}

<div class="stage">
	<div class="col">
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

				<!-- Templates belong to the text, so they live in the same card as it
				     — which is also what frees the row below for a full-width tags
				     box. -->
				<div class="tpl">
					<header class="tplhead">
						<span class="label">Templates</span>
						<a
							class="edit"
							href="{base}/settings?section=templates"
							title="Edit templates"
							aria-label="Edit templates"
						>
							{@render pencil()}
						</a>
						<span class="tplnote">
							Click to drop one in at the cursor, or type its name in braces.
						</span>
					</header>

					{#if templates.loading}
						<p class="tplempty">Loading…</p>
					{:else if templates.items.length === 0}
						<p class="tplempty">
							None yet — add reusable text in
							<a href="{base}/settings?section=templates">Settings</a>.
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
							Inserts into <strong>{def.label}</strong>'s
							<strong>
								{#if lastField === 'title' && def.hasTitle}title{:else if def.hasTitle}description{:else}caption{/if}
							</strong>.
						</p>
					{/if}
				</div>
			{:else}
				<p class="emptypanel">Tick a platform on the right to start composing.</p>
			{/if}
		</section>

		{#if tagFields.length > 0 && def && composing}
			<section class="tagcard card">
				<header class="taghead">
					<span class="label">Tags</span>
					<a
						class="edit"
						href="{base}/settings?platform={composing}&tab=tags"
						title="Edit tag sets"
						aria-label="Edit tag sets"
					>
						{@render pencil()}
					</a>

					<span class="tagbudget" class:over={tagsOver}>
						{tagsUsed} / {def.tagBudget?.limit} characters
						<span class="tagtotal">· {tagsMerged.length} tags in total</span>
					</span>
				</header>

				{#if tagsOver}
					<p class="tagwarn">
						Over {def.label}'s limit — the upload would be rejected. A tag containing a space is
						counted as though it were quoted, and the separators count too.
					</p>
				{/if}

				<!--
					One box at a time, full width. Four side by side left each too
					narrow to read a filled list in; tabs give the whole width to
					whichever group is being worked on. "Final" is the merged result —
					read-only, because it is computed, and copyable because that is the
					only reason to look at it.
				-->
				<div class="tagtabs" role="tablist">
					<button
						class="tagtab"
						class:on={tagTab === 'final'}
						role="tab"
						aria-selected={tagTab === 'final'}
						onclick={() => (tagTab = 'final')}
					>
						Final Tags
						<em>{tagsMerged.length}</em>
					</button>
					{#each tagFields as field (field.key)}
						<button
							class="tagtab"
							class:on={tagTab === field.key}
							role="tab"
							aria-selected={tagTab === field.key}
							onclick={() => {
								tagTab = field.key;
								lastTagKey = field.key;
							}}
						>
							{field.label}
							<em>{tagValue(field.key).length}</em>
						</button>
					{/each}
				</div>

				{#if tagTab === 'final'}
					<div class="finalbox">
						{#if tagsMerged.length === 0}
							<p class="finalempty">
								Nothing yet. Fill any of the other tabs and the combined list appears here.
							</p>
						{:else}
							<div class="finaltags">
								{#each tagsMerged as tag (tag.toLowerCase())}
									{@const from = sourceOf(tag)}
									<span class="tag" title={from ? `From ${from}` : ''}>
										{tag}
										<button onclick={() => removeEverywhere(tag)} aria-label="Remove {tag}">
											<svg viewBox="0 0 12 12" width="9" height="9">
												<path
													d="M3 3l6 6M9 3l-6 6"
													stroke="currentColor"
													stroke-width="1.7"
													stroke-linecap="round"
												/>
											</svg>
										</button>
									</span>
								{/each}
							</div>
							<p class="finalnote">
								The single list {def.label} receives — every box merged, in tab order, with
								duplicates removed. Removing one here takes it out of whichever box it came
								from; hover a tag to see which.
							</p>
						{/if}
					</div>
				{:else}
					{#each tagFields as field (field.key)}
						{#if tagTab === field.key}
							<div class="tagbox">
								<TagInput
									value={tagValue(field.key)}
									placeholder="Paste a comma-separated list, or type one and press Enter"
									clearable
									label={field.label}
									big
									onfocus={() => (lastTagKey = field.key)}
									onchange={(next) => setTagField(field.key, next)}
								/>
							</div>
						{/if}
					{/each}
				{/if}

				{#if tagSets.items.length > 0}
					<div class="tagsets">
						<span class="setlabel">Add a set</span>
						{#each tagSets.items as set (set.id)}
							<button
								class="chip"
								disabled={set.tags.length === 0 || tagTab === 'final'}
								onclick={() => applySet(set.tags)}
								title="{set.tags.length} tags into {activeBoxLabel}"
							>
								{set.name.trim() || 'Unnamed'}
								<em>{set.tags.length}</em>
							</button>
						{/each}
						<span class="settarget">
							{#if tagTab === 'final'}
								pick a box first
							{:else}
								into <strong>{activeBoxLabel}</strong>
							{/if}
						</span>
					</div>
				{/if}

				{#if showingRecent}
					<p class="reused">
						Carried over from your last {def.label} upload.
						<button class="relink" onclick={clearAllTags}>Clear all</button>
					</p>
				{/if}
			</section>
		{/if}
	</div>

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
			<VideoPicker
				bind:file={draft.file}
				bind:duration={draft.duration}
				onchange={() => draft.chooseNasFile(null)}
			/>

			<div class="onnas">
				<span class="label">Or pick one off the NAS</span>

				{#if !general.value.watchFolder}
					<p class="nasnote">
						No watch folder set — add one in <a href="{base}/settings">Settings</a> to drop videos
						straight onto the NAS instead of uploading them here.
					</p>
				{:else if watchLoading}
					<p class="nasnote">Looking…</p>
				{:else if !watchIndex}
					<p class="nasnote">
						The worker has not scanned <code>{general.value.watchFolder}</code> yet.
					</p>
				{:else if watchIndex.error}
					<p class="nasnote bad">{watchIndex.error}</p>
				{:else if watchIndex.files.length === 0}
					<p class="nasnote">Nothing in <code>{watchIndex.folder}</code> right now.</p>
				{:else}
					<ul class="naslist">
						{#each watchIndex.files as entry (entry.path)}
							<li>
								<button
									class="nasitem"
									class:on={draft.nasFile?.path === entry.path}
									onclick={() => draft.chooseNasFile(entry)}
								>
									<span class="nasname">{entry.name}</span>
									<span class="nasmeta">{formatBytes(entry.size)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if watchIndex && !watchIndex.error}
					<p class="nasnote faint">
						Scanned {scannedLabel}.
						<button class="relink" onclick={refreshWatch}>Refresh</button>
					</p>
				{/if}
			</div>
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
		gap: 20px;
		align-items: start;
	}

	/* The compose card and the boxes under it, as their own column.
	   They used to be two rows of .stage that .side spanned — and a spanning
	   item taller than the rows it covers has its excess distributed into them,
	   which silently reopened the gap here to 60px however small row-gap was
	   set. Separate columns cannot inflate each other. */
	.col {
		min-width: 0;
		display: grid;
		gap: 12px;
		align-content: start;
	}

	/* ---- compose panel ---- */

	.main {
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

	/* Templates now sit inside the compose card, below the text they insert
	   into — which is also what frees the row beneath for full-width tags. */
	.tpl {
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	/* ---- tags: full width, one shared budget ---- */

	.tagcard {
		padding: 16px 18px 18px;
	}

	.taghead {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}

	.taghead .label {
		margin-bottom: 0;
	}

	.tagbudget {
		margin-left: auto;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.tagbudget.over {
		color: var(--danger);
	}

	.tagtotal {
		font-weight: 400;
		color: var(--text-faint);
	}

	.tagwarn {
		margin: 0 0 12px;
		padding: 8px 11px;
		border-radius: var(--radius-sm);
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
		color: var(--danger);
		font-size: 11.5px;
		line-height: 1.45;
	}

	/* ---- one tag box at a time ---- */

	.tagtabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 3px;
		margin-bottom: 14px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 10px;
	}

	.tagtab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text-dim);
		transition: background 0.15s, color 0.15s;
	}

	.tagtab:hover {
		color: var(--text);
	}

	.tagtab.on {
		background: var(--surface-3);
		color: var(--text);
	}

	.tagtab em {
		font-style: normal;
		min-width: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--surface-2);
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text-faint);
		text-align: center;
	}

	.tagtab.on em {
		background: var(--accent-grad-soft);
		color: var(--pink-soft);
	}

	/* The merged result. Selectable so it can be copied out, but not editable —
	   it is computed from the boxes. */
	.finalbox {
		min-height: 150px;
		padding: 11px 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
	}

	.finaltags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	/* Matches the boxes' own chips, so the merged view reads as the same
	   material rather than a different kind of thing. */
	.finaltags .tag {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 6px 3px 9px;
		border-radius: 7px;
		font-size: 12px;
		background: var(--accent-grad-soft);
		border: 1px solid rgba(255, 77, 158, 0.28);
		color: var(--pink-soft);
	}

	.finaltags .tag button {
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		border-radius: 4px;
		color: inherit;
		opacity: 0.7;
	}

	.finaltags .tag button:hover {
		opacity: 1;
		background: rgba(255, 77, 158, 0.2);
	}

	.finalnote,
	.finalempty {
		margin: 10px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.finalempty {
		margin: 0;
	}

	/* Only rendered when sets exist, so the row takes no space otherwise. */
	.tagsets {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}

	.setlabel,
	.settarget {
		font-size: 11px;
		color: var(--text-faint);
	}

	.settarget strong {
		color: var(--pink-soft);
		font-weight: 600;
	}

	.chip em {
		font-style: normal;
		margin-left: 5px;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text-faint);
	}

	.tagbox {
		min-width: 0;
	}

	/* An edit link back to wherever the thing is actually managed. */
	/* Icon only — the tooltip carries the wording. */
	.edit {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 1px solid var(--border);
		color: var(--text-faint);
		transition: color 0.14s, border-color 0.14s;
	}

	.edit:hover {
		color: var(--pink-soft);
		border-color: var(--pink);
	}

	.reused {
		margin: 12px 0 0;
		font-size: 11px;
		color: var(--text-faint);
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
		min-width: 0;
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

	/* ---- videos already on the NAS ---- */

	.onnas {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}

	.nasnote {
		margin: 8px 0 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.nasnote.bad {
		color: var(--danger);
	}

	.nasnote a {
		color: var(--pink-soft);
	}

	.nasnote code {
		font-family: var(--mono);
		font-size: 10.5px;
		overflow-wrap: anywhere;
	}

	.relink {
		color: var(--pink-soft);
		font-size: 11.5px;
		text-decoration: underline;
	}

	.naslist {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		display: grid;
		gap: 5px;
		max-height: 210px;
		overflow-y: auto;
	}

	.nasitem {
		width: 100%;
		display: grid;
		gap: 1px;
		padding: 7px 9px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elev);
		text-align: left;
		transition: border-color 0.14s, background 0.14s;
	}

	.nasitem:hover {
		border-color: var(--pink-soft);
	}

	.nasitem.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
	}

	.nasname {
		font-size: 12px;
		font-weight: 560;
		color: var(--text);
		/* File names have no spaces to break at. */
		overflow-wrap: anywhere;
	}

	.nasmeta {
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.videocard {
		padding: 18px 16px;
		display: grid;
		gap: 4px;
		/* Grid items default to min-width: auto, which let a long file name push
		   this card straight out of its 320px track. */
		min-width: 0;
	}

	@media (max-width: 1040px) {
		.stage {
			grid-template-columns: 1fr;
		}
		.side {
			position: static;
		}
	}
</style>
