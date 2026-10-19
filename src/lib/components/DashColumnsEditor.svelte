<script lang="ts">
	import Checkbox from './Checkbox.svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import { general } from '$lib/stores/general.svelte';
	import {
		COLUMNS,
		DEFAULT_COLUMNS,
		available,
		columnWords,
		moveBefore,
		moveBy,
		setShown,
		shownColumns,
		type ColumnId,
		type DashColumn
	} from '$lib/dashcolumns';

	/**
	 * Settings → Dashboard: the list of videos' columns. On top, the list's
	 * header as the Dashboard will draw it, whose columns can be dragged into
	 * place (or moved with the arrow keys); below it every column, to move one
	 * place at a time and to show or hide. The thumbnail and the title lead
	 * every row and stay where they are (dashcolumns.ts).
	 */

	const layout = $derived(general.value.dashboardColumns);
	const jestr = $derived(general.value.jestrIntegration);
	const shown = $derived(shownColumns(layout, { jestr }));

	function save(next: DashColumn[]) {
		if (next !== layout) general.setDashboardColumns(next);
	}

	const isDefault = $derived(columnWords(layout) === columnWords(DEFAULT_COLUMNS));

	/* ---- dragging in the preview: pointer events, as the Calendar's cards ---- */

	let drag = $state<{ id: ColumnId; x0: number; dx: number; before: ColumnId | null; moved: boolean } | null>(null);
	const chips: Partial<Record<ColumnId, HTMLElement>> = {};

	function register(node: HTMLElement, id: ColumnId) {
		chips[id] = node;
		return {
			destroy() {
				if (chips[id] === node) delete chips[id];
			}
		};
	}

	/** The column a drop at `x` lands in front of; null past the last one. */
	function beforeAt(x: number, dragging: ColumnId): ColumnId | null {
		for (const id of shown) {
			if (id === dragging) continue;
			const box = chips[id]?.getBoundingClientRect();
			if (box && x < box.left + box.width / 2) return COLUMNS[id].fixed ? (shown.find((c) => !COLUMNS[c].fixed && c !== dragging) ?? null) : id;
		}
		return null;
	}

	function onDown(event: PointerEvent, id: ColumnId) {
		if (COLUMNS[id].fixed || event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { id, x0: event.clientX, dx: 0, before: null, moved: false };
	}

	function onMove(event: PointerEvent) {
		if (!drag) return;
		const dx = event.clientX - drag.x0;
		drag = { ...drag, dx, moved: drag.moved || Math.abs(dx) > 4, before: beforeAt(event.clientX, drag.id) };
	}

	function onUp() {
		if (!drag) return;
		const { id, before, moved } = drag;
		drag = null;
		if (moved) save(moveBefore(layout, id, before));
	}

	/** Arrow keys move the focused column one place among those shown. */
	function onKey(event: KeyboardEvent, id: ColumnId) {
		if (COLUMNS[id].fixed || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const at = shown.indexOf(id);
		if (event.key === 'ArrowLeft') {
			const prev = shown[at - 1];
			if (prev && !COLUMNS[prev].fixed) save(moveBefore(layout, id, prev));
		} else {
			const next = shown[at + 1];
			if (next) save(moveBefore(layout, id, shown[at + 2] ?? null));
		}
		queueMicrotask(() => chips[id]?.focus());
	}
</script>

<div class="editor">
	<section class="previewbox" aria-label="Preview of the list's header">
		<div class="previewhead">
			<h3>Preview</h3>
			<p>Drag a column into place, or focus it and use the arrow keys.</p>
		</div>
		<!-- Each column is its header with a row's worth of placeholder under it, so the two always line up. -->
		<div class="preview" class:dragging={Boolean(drag?.moved)}>
			{#each shown as id (id)}
				{@const def = COLUMNS[id]}
				{@const held = drag?.id === id && drag.moved}
				<div
					class="pcol"
					class:wide={id === 'video'}
					class:held
					style:transform={held ? `translateX(${drag?.dx ?? 0}px)` : undefined}
					use:register={id}
				>
					<button
						class="chip"
						class:fixed={def.fixed}
						class:target={Boolean(drag?.moved) && drag?.before === id}
						class:num={id !== 'video' && id !== 'curve' && id !== 'thumb'}
						onpointerdown={(e) => onDown(e, id)}
						onpointermove={onMove}
						onpointerup={onUp}
						onpointercancel={() => (drag = null)}
						onkeydown={(e) => onKey(e, id)}
						title={def.fixed ? `${def.label} leads every row` : `${def.label} — drag to move`}
						aria-label={def.fixed ? `${def.label}, fixed` : `${def.label}, column ${shown.indexOf(id) + 1}: arrow keys move it`}
					>
						{#if id === 'thumb'}
							<span class="thumbmock" aria-hidden="true"></span>
						{:else}
							{#if id === 'skip'}<PlatformIcon platform="instagram" size={10} />{/if}
							<span class="clabel">{def.label}</span>
						{/if}
					</button>
					<span class="mock" aria-hidden="true">
						{#if id === 'thumb'}<i class="mthumb"></i>{:else if id === 'video'}<i class="mtitle"></i><i class="mmeta"></i>{:else}<i class="mnum"></i>{/if}
					</span>
				</div>
			{/each}
			<span class="end" class:target={Boolean(drag?.moved) && drag?.before === null} aria-hidden="true"></span>
		</div>
	</section>

	<section aria-label="Every column">
		<div class="listhead">
			<h3>Columns</h3>
			<button class="btn btn-ghost reset" onclick={() => save(DEFAULT_COLUMNS.map((c) => ({ ...c })))} disabled={isDefault}>
				Back to the default
			</button>
		</div>
		<ol class="columns">
			{#each layout as column, index (column.id)}
				{@const def = COLUMNS[column.id]}
				{@const here = available(column.id, { jestr })}
				<li class:off={!column.on || !here}>
					<div class="order">
						<button
							onclick={() => save(moveBy(layout, column.id, -1))}
							disabled={def.fixed || index === 0 || Boolean(COLUMNS[layout[index - 1]?.id]?.fixed)}
							aria-label="Move {def.label} left"
						>
							<svg viewBox="0 0 12 12" width="10" height="10"
								><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg
							>
						</button>
						<button
							onclick={() => save(moveBy(layout, column.id, 1))}
							disabled={def.fixed || index === layout.length - 1}
							aria-label="Move {def.label} right"
						>
							<svg viewBox="0 0 12 12" width="10" height="10"
								><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg
							>
						</button>
					</div>
					<div class="what">
						<span class="name">{def.label}{#if def.fixed}<span class="tag">fixed</span>{/if}</span>
						<span class="about">
							{def.about}{#if !here}. Shown once the Jestr integration is on, under Other.{/if}{#if def.mid === null}. Left out
								below 1,200 px.{:else if def.narrow === null}. Left out below 760 px.{/if}
						</span>
					</div>
					<Checkbox
						checked={column.on}
						disabled={def.required}
						ariaLabel={def.required ? `${def.label} is always shown` : `Show ${def.label}`}
						onchange={(next) => save(setShown(layout, column.id, next))}
					/>
				</li>
			{/each}
		</ol>
		<p class="hint">
			Applies to every computer using flock. A narrow window leaves out likes, comments and the skip rate, and below 760 px
			the followers and the curve too; an opened video still lists them.
		</p>
	</section>
</div>

<style>
	.editor {
		display: grid;
		gap: 22px;
		padding: 4px 0 8px;
	}

	h3 {
		margin: 0;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.previewhead,
	.listhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
	}

	.reset {
		padding: 4px 10px;
		font-size: 12px;
	}

	.previewhead p {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.previewbox {
		padding: 12px 14px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
		overflow: hidden;
	}

	/* The list's header, the same face as the Dashboard's: each column as wide
	   as its name, the title taking what is left. */
	.preview {
		position: relative;
		display: flex;
		align-items: stretch;
		gap: 5px;
		overflow-x: auto;
		padding: 4px 4px 2px;
		touch-action: none;
	}

	.pcol {
		position: relative;
		flex: none;
		display: grid;
		grid-template-rows: auto auto;
		gap: 9px;
	}

	.pcol.wide {
		flex: 1 1 auto;
		min-width: 90px;
	}

	.pcol.held {
		z-index: 2;
	}

	.chip {
		position: relative;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		padding: 0 7px;
		border: 1px dashed var(--border-strong);
		border-radius: 7px;
		background: var(--surface);
		color: var(--text-faint);
		font: inherit;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
		cursor: grab;
		user-select: none;
		transition:
			border-color 0.12s,
			color 0.12s,
			box-shadow 0.12s;
	}

	.chip.num {
		justify-content: flex-end;
	}

	.clabel {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip:hover:not(.fixed),
	.chip:focus-visible {
		border-color: var(--pink);
		color: var(--text);
	}

	.chip.fixed {
		border-style: solid;
		border-color: transparent;
		background: none;
		cursor: default;
	}

	.held .chip {
		border-style: solid;
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
		cursor: grabbing;
		transition: none;
	}

	.dragging .chip {
		cursor: grabbing;
	}

	/* Where the column lands: a bar in front of the column it goes before. */
	.chip.target::before,
	.end.target::before {
		content: '';
		position: absolute;
		top: -3px;
		bottom: -3px;
		left: -5px;
		width: 3px;
		border-radius: 2px;
		background: var(--pink);
	}

	.end {
		position: relative;
		width: 4px;
		height: 30px;
		flex: none;
	}

	.end.target::before {
		left: 0;
	}

	.thumbmock {
		display: block;
		width: 34px;
		height: 16px;
		border-radius: 3px;
		background: var(--border);
	}

	.mock {
		display: grid;
		align-content: start;
		gap: 4px;
		justify-items: end;
		padding: 9px 2px 2px;
		border-top: 1px solid var(--border);
	}

	.mock i {
		display: block;
		height: 7px;
		border-radius: 4px;
		background: var(--border);
	}

	.mthumb {
		justify-self: stretch;
		height: 22px !important;
	}

	.mtitle {
		justify-self: stretch;
		width: 80%;
	}

	.mmeta {
		justify-self: start;
		width: 50%;
		opacity: 0.6;
	}

	.mnum {
		width: 55%;
	}

	.columns {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.columns li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 7px 10px;
		border-radius: 8px;
	}

	.columns li:hover {
		background: var(--surface-2);
	}

	.columns li.off .name {
		color: var(--text-faint);
	}

	.order {
		display: grid;
		gap: 2px;
	}

	.order button {
		display: grid;
		place-items: center;
		width: 22px;
		height: 15px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text-dim);
	}

	/* The list is vertical, the columns run left to right: up is left. */
	.order button svg {
		transform: rotate(-90deg);
	}

	.order button:hover:not(:disabled) {
		border-color: var(--pink);
		color: var(--text);
	}

	.order button:disabled {
		opacity: 0.3;
	}

	.what {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-weight: 600;
		color: var(--text);
	}

	.tag {
		margin-left: 8px;
		padding: 1px 6px;
		border-radius: 5px;
		background: var(--surface-2);
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-faint);
	}

	.about {
		font-size: 12px;
		color: var(--text-faint);
	}

	.hint {
		margin: 12px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-faint);
	}
</style>
