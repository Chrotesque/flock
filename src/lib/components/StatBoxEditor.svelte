<script lang="ts">
	import { onMount, tick } from 'svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import StatBoxCard from './StatBoxCard.svelte';
	import ConfirmButton from './ConfirmButton.svelte';
	import { newId } from '$lib/id';
	import { isoDate } from '$lib/format';
	import { PLATFORMS } from '$lib/platforms';
	import { KIND_LABELS, KIND_ORDER } from '$lib/videokind';
	import { PERIOD_KEYS, PERIOD_LABELS, STAT_PLATFORMS } from '$lib/releases';
	import { statBoxes } from '$lib/stores/statboxes.svelte';
	import { users } from '$lib/stores/users.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { dashData } from '$lib/stores/dashdata.svelte';
	import { hiddenVideos } from '$lib/stores/hiddenvideos.svelte';
	import { brandSet } from '$lib/brandset';
	import {
		BOX_HOWS,
		BOX_METRICS,
		HOW_LABELS,
		MAX_BOX_DAYS,
		METRIC_LABELS,
		NAME_MAX,
		boxName,
		boxSummary,
		canEditBox,
		copyBox,
		creatorWords,
		howRefusal,
		isFlockBox,
		layoutFor,
		metricFits,
		moveMetric,
		newBox,
		suggestedName,
		toggleIn,
		toggleMetric,
		twinOf,
		withHow,
		withTimeframe,
		type BoxMetric,
		type BoxTimeframe,
		type StatBox
	} from '$lib/statbox';

	/**
	 * Settings → Dashboard → Stat boxes: every box every profile made, who made
	 * it, and the builder (statbox.ts). flock's own can only be copied; a box
	 * is changed or deleted by the profile that made it, or by anyone once that
	 * profile is gone. Boxes are placed on the Dashboard in its Edit mode.
	 */
	onMount(() => {
		void statBoxes.load();
		void users.load();
		// The preview's numbers: the Dashboard's data, read once if it is not in yet.
		if (!dashData.loaded) void dashData.refresh();
		void accounts.load();
		void hiddenVideos.load().catch(() => {});
		return statBoxes.subscribe();
	});

	/* The preview counts one brand's videos: the brand in view until another is
	   picked under it; with one brand, that one. */
	let previewBrandId = $state('');
	const previewBrand = $derived(
		brands.list.some((b) => b.id === previewBrandId) ? previewBrandId : (brands.currentId || brands.list[0]?.id || '')
	);
	const previewReady = $derived(dashData.loaded && accounts.loaded);
	const preview = $derived(
		previewReady
			? brandSet(
					dashData,
					previewBrand,
					(p) => accounts.forBrand(p, previewBrand),
					(p) => !accounts.forBrand(p, previewBrand) && !brands.multiple && accounts.forPlatform(p).length <= 1,
					hiddenVideos.marks,
					brands.multiple
				)
			: { releases: [], followers: [] }
	);

	const me = $derived(users.current);
	const profileIds = $derived(users.list.map((u) => u.id));
	// The brand in view's row: where the list says a box is placed.
	const onMine = $derived(new Set(layoutFor(general.value.dashboardBoxes, brands.currentId)));

	/** The box in the builder, and whether it is new (not saved yet). */
	let draft = $state<StatBox | null>(null);
	let isNew = $state(false);
	let saving = $state(false);
	let error = $state('');

	const creator = $derived({ id: me?.id ?? '', name: me?.name ?? '' });

	function startNew() {
		draft = newBox(newId(), creator);
		isNew = true;
		error = '';
	}

	function startCopy(box: StatBox) {
		draft = copyBox(box, newId(), creator);
		isNew = true;
		error = '';
	}

	function startEdit(box: StatBox) {
		draft = $state.snapshot(box) as StatBox;
		isNew = false;
		error = '';
	}

	async function save() {
		if (!draft) return;
		saving = true;
		error = '';
		try {
			await statBoxes.save(draft);
			draft = null;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	async function remove(box: StatBox) {
		try {
			await statBoxes.remove(box.id);
			if (draft?.id === box.id) draft = null;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	}

	/* ---- the timeframe: a period, the last N days, or from a date ---- */

	type FrameChoice = (typeof PERIOD_KEYS)[number] | 'days' | 'range';
	const frameChoice = $derived<FrameChoice | ''>(
		!draft ? '' : draft.timeframe.kind === 'period' ? draft.timeframe.period : draft.timeframe.kind
	);
	const today = $derived(isoDate(new Date()));

	function setTimeframe(t: BoxTimeframe) {
		if (draft) draft = withTimeframe(draft, t);
	}

	function pickFrame(choice: FrameChoice) {
		if (!draft) return;
		if (choice === 'days') setTimeframe({ kind: 'days', days: draft.timeframe.kind === 'days' ? draft.timeframe.days : 30 });
		else if (choice === 'range') {
			const back = new Date();
			back.setDate(back.getDate() - 29);
			setTimeframe(draft.timeframe.kind === 'range' ? draft.timeframe : { kind: 'range', from: isoDate(back), to: 'today' });
		} else setTimeframe({ kind: 'period', period: choice });
	}

	function setDays(value: string) {
		const days = Math.round(Number(value));
		if (days >= 1 && days <= MAX_BOX_DAYS) setTimeframe({ kind: 'days', days });
	}

	function setFrom(value: string) {
		if (!draft || draft.timeframe.kind !== 'range' || !value) return;
		const from = value > today ? today : value;
		const to = draft.timeframe.to;
		setTimeframe({ kind: 'range', from, to: to !== 'today' && to < from ? from : to });
	}

	function setTo(value: string) {
		if (!draft || draft.timeframe.kind !== 'range' || !value) return;
		const from = draft.timeframe.from;
		setTimeframe({ kind: 'range', from, to: value === 'today' ? 'today' : value < from ? from : value });
	}

	const unchosen = $derived(draft ? BOX_METRICS.filter((m) => !draft!.metrics.includes(m)) : []);

	function metric(m: BoxMetric) {
		if (draft) draft = toggleMetric(draft, m);
	}

	/* The numbers' pills: dragged into order; a first click picks one (its
	   outline brightens), a second, not ending a drag, takes it out. */
	let pickedMetric = $state<BoxMetric | null>(null);
	let heldMetric = $state<BoxMetric | null>(null);
	let moved = $state(false);
	let downAt: [number, number] = [0, 0];
	let justDragged = false;

	function pillDown(event: PointerEvent, m: BoxMetric) {
		if (event.button !== 0) return;
		heldMetric = m;
		moved = false;
		downAt = [event.clientX, event.clientY];
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function pillMove(event: PointerEvent) {
		if (!heldMetric || !draft) return;
		if (!moved && Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) < 5) return;
		moved = true;
		const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.pill.on[data-metric]');
		const over = under?.dataset.metric as BoxMetric | undefined;
		if (!under || !over || over === heldMetric) return;
		const rect = under.getBoundingClientRect();
		const others = draft.metrics.filter((x) => x !== heldMetric);
		const at = others.indexOf(over) + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
		const metrics = [...others.slice(0, at), heldMetric, ...others.slice(at)];
		if (metrics.join() !== draft.metrics.join()) draft = { ...draft, metrics };
	}

	function pillUp() {
		justDragged = moved;
		heldMetric = null;
		moved = false;
	}

	function pillClick(m: BoxMetric) {
		if (justDragged) {
			justDragged = false;
			return;
		}
		if (pickedMetric !== m) {
			pickedMetric = m;
			return;
		}
		if (draft && draft.metrics.length > 1) draft = toggleMetric(draft, m);
		pickedMetric = null;
	}

	function pillKey(event: KeyboardEvent, m: BoxMetric) {
		const by = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (!by || !draft) return;
		event.preventDefault();
		draft = moveMetric(draft, m, by);
		void tick().then(() => document.querySelector<HTMLElement>(`.pill.on[data-metric="${m}"]`)?.focus());
	}

	function onWindowPointer(event: PointerEvent) {
		if (pickedMetric && !(event.target as HTMLElement).closest?.('.metrics')) pickedMetric = null;
	}

	/** A box counting exactly as the one in the builder does: making it would only add a copy. */
	const twin = $derived(draft ? twinOf(draft, statBoxes.all) : undefined);

	const sorted = $derived([
		...statBoxes.all.filter((b) => isFlockBox(b)),
		...statBoxes.all.filter((b) => !isFlockBox(b) && b.creator === me?.id),
		...statBoxes.all.filter((b) => !isFlockBox(b) && b.creator !== me?.id)
	]);
	const now = $derived(new Date());
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="boxes">
	{#if !draft}
	<div class="library">
		<div class="libhead">
			<p class="lead">
				Every stat box anyone made, shared by every profile. Place them on the Dashboard in its Edit mode, for each brand on its own; what
				each counts is set here, and never by the Dashboard's filter.
			</p>
			<button class="btn btn-primary small" type="button" onclick={startNew} disabled={!me}>New stat box</button>
		</div>
		{#if !statBoxes.loaded}
			<p class="banner">Loading…</p>
		{/if}
		<ul>
			{#each sorted as b (b.id)}
				{@const mine = canEditBox(b, me?.id ?? '', profileIds)}
				<li>
					<div class="who">
						<span class="name">{boxName(b)}</span>
						<span class="by" class:flock={isFlockBox(b)} class:own={b.creator === me?.id}
							>{b.creator === me?.id ? 'by you' : `by ${creatorWords(b, users.list)}`}</span
						>
						{#if onMine.has(b.id)}<span class="placed" title="On your Dashboard for the brand in view">on {brands.multiple ? `${brands.current?.name ?? "the brand"}'s` : "your"} Dashboard</span>{/if}
					</div>
					<p class="sum">{boxSummary(b)}</p>
					<div class="acts">
						{#if mine}
							<button class="btn small" type="button" onclick={() => startEdit(b)}>Edit</button>
						{/if}
						<button class="btn small" type="button" onclick={() => startCopy(b)} disabled={!me}>Copy</button>
						{#if mine}
							<ConfirmButton
								label="Delete"
								danger
								title="Deletes it for everyone, and takes it off every Dashboard"
								onconfirm={() => remove(b)}
							/>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</div>
	{:else}
		<div class="builder card">
			<h3>{isNew ? 'New stat box' : 'Edit stat box'} <span class="maker">made by {draft.creator === me?.id ? 'you' : creatorWords(draft, users.list)}</span></h3>

			<div class="cols">
			<div class="col">
			<label class="field">
				<span class="flabel">Name</span>
				<input
					class="input"
					type="text"
					maxlength={NAME_MAX}
					placeholder={suggestedName(draft)}
					bind:value={draft.name}
				/>
				<span class="hint">What the Dashboard shows over it. Empty is “{suggestedName(draft)}”.</span>
			</label>

			<div class="field">
				<span class="flabel">Timeframe</span>
				<div class="row">
					<select class="input select" value={frameChoice} onchange={(e) => pickFrame(e.currentTarget.value as FrameChoice)}>
						{#each PERIOD_KEYS as k (k)}
							<option value={k}>{PERIOD_LABELS[k]}</option>
						{/each}
						<option value="days">The last … days</option>
						<option value="range">From a date</option>
					</select>
					{#if draft.timeframe.kind === 'days'}
						<label class="inline">
							<input
								class="input days"
								type="number"
								min="1"
								max={MAX_BOX_DAYS}
								value={draft.timeframe.days}
								onchange={(e) => setDays(e.currentTarget.value)}
							/>
							days, today the last
						</label>
					{:else if draft.timeframe.kind === 'range'}
						<span class="inline">
							<input class="input" type="date" max={today} value={draft.timeframe.from} onchange={(e) => setFrom(e.currentTarget.value)} />
							to
							<button
								class="chip"
								type="button"
								class:on={draft.timeframe.to === 'today'}
								aria-pressed={draft.timeframe.to === 'today'}
								title="Up to whatever day it is: moves on by itself"
								onclick={() => setTo('today')}>Today</button
							>
							<input
								class="input"
								type="date"
								aria-label="To a date"
								class:on={draft.timeframe.to !== 'today'}
								min={draft.timeframe.from}
								max={today}
								value={draft.timeframe.to === 'today' ? '' : draft.timeframe.to}
								onchange={(e) => setTo(e.currentTarget.value)}
							/>
						</span>
					{/if}
				</div>
			</div>

			<div class="field">
				<span class="flabel">How</span>
				<div class="row" role="radiogroup" aria-label="How the numbers are taken">
					{#each BOX_HOWS as h (h)}
						{@const why = howRefusal(h, draft.timeframe)}
						<button
							class="chip"
							type="button"
							role="radio"
							aria-checked={draft.how === h}
							class:on={draft.how === h}
							disabled={Boolean(why)}
							title={why ||
								(h === 'total'
									? 'Everything in the timeframe added up'
									: h === 'average'
										? 'An average of the whole periods so far: the running one is left out'
										: 'Shared over the videos that went out')}
							onclick={() => draft && (draft = withHow(draft, h))}>{HOW_LABELS[h]}</button
						>
					{/each}
				</div>
			</div>

			<div class="field">
				<span class="flabel">Numbers, in order</span>
				<div class="metrics" role="group" aria-label="The numbers shown, in order">
					{#each draft.metrics as m (m)}
						<button
							class="pill on"
							class:picked={pickedMetric === m}
							class:held={heldMetric === m && moved}
							type="button"
							data-metric={m}
							aria-pressed={pickedMetric === m}
							title={pickedMetric === m
								? draft.metrics.length > 1
									? 'Click again to take it out; drag to move it'
									: 'The last number stays'
								: 'Drag to move it (or arrow keys); click twice to take it out'}
							onpointerdown={(e) => pillDown(e, m)}
							onpointermove={pillMove}
							onpointerup={pillUp}
							onpointercancel={pillUp}
							onclick={() => pillClick(m)}
							onkeydown={(e) => pillKey(e, m)}>{METRIC_LABELS[m]}</button
						>
					{/each}
					{#each unchosen as m (m)}
						<button
							class="pill add"
							type="button"
							disabled={!metricFits(m, draft.how)}
							title={metricFits(m, draft.how) ? `Add ${METRIC_LABELS[m]}` : 'An average video is one video: it has no count of videos'}
							onclick={() => metric(m)}>+ {METRIC_LABELS[m]}</button
						>
					{/each}
				</div>
				<span class="hint">Drag the numbers into order. Click one to pick it and again to take it out; a dashed one is added with a click.</span>
			</div>

			</div>
			<div class="col">
			<div class="field">
				<span class="flabel">Platforms</span>
				<div class="row">
					{#each STAT_PLATFORMS as p (p)}
						<button
							class="chip icon"
							type="button"
							aria-pressed={draft.platforms.includes(p)}
							class:on={draft.platforms.includes(p)}
							title={PLATFORMS[p].label}
							onclick={() => draft && (draft = { ...draft, platforms: toggleIn(draft.platforms, p, STAT_PLATFORMS) })}
						>
							<PlatformIcon platform={p} size={14} />
							{PLATFORMS[p].label}
						</button>
					{/each}
				</div>
			</div>

			<div class="field">
				<span class="flabel">Kinds of video</span>
				<div class="row">
					{#each KIND_ORDER as k (k)}
						<button
							class="chip"
							type="button"
							aria-pressed={draft.kinds.includes(k)}
							class:on={draft.kinds.includes(k)}
							onclick={() => draft && (draft = { ...draft, kinds: toggleIn(draft.kinds, k, KIND_ORDER) })}>{KIND_LABELS[k]}</button
						>
					{/each}
				</div>
				<span class="hint">Public videos only; ones hidden on the Dashboard never count.</span>
			</div>

			<div class="field">
				<span class="flabel">How it looks</span>
				<div class="preview card">
					<StatBoxCard
						box={draft}
						{now}
						sample={!previewReady}
						releases={preview.releases}
						followers={preview.followers}
					/>
				</div>
				{#if brands.list.length > 1}
					<div class="row previewfrom">
						<span class="hint">Preview with data from:</span>
						{#each brands.list as b (b.id)}
							<button
								class="chip"
								type="button"
								aria-pressed={previewBrand === b.id}
								class:on={previewBrand === b.id}
								onclick={() => (previewBrandId = b.id)}>{b.name}</button
							>
						{/each}
					</div>
				{/if}
			</div>

			</div>
			</div>

			{#if error}<p class="banner bad">{error}</p>{/if}
			<div class="foot">
				{#if twin}
					<p class="twin">
						The same as <strong>“{boxName(twin)}”</strong>
						({twin.creator === me?.id ? 'yours' : `by ${creatorWords(twin, users.list)}`}) — change something to make one
						of its own.
					</p>
				{/if}
				<button class="btn small" type="button" onclick={() => (draft = null)}>Cancel</button>
				<button
					class="btn btn-primary small"
					type="button"
					onclick={save}
					disabled={saving || Boolean(twin)}
					title={twin ? `It would only copy “${boxName(twin)}”` : undefined}
				>
					{saving ? 'Saving…' : isNew ? 'Make it' : 'Save'}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.boxes {
		display: grid;
		gap: 24px;
	}

	/* The builder takes the panel's whole width: its fields in two columns. */
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
		gap: 16px 36px;
		align-items: start;
	}

	.col {
		display: grid;
		gap: 16px;
		min-width: 0;
	}

	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pill {
		padding: 5px 12px;
		border: 1px solid var(--pink);
		border-radius: 999px;
		background: rgba(255, 77, 158, 0.12);
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		cursor: grab;
		touch-action: none;
		user-select: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}

	/* Picked: a brighter shade of its outline, waiting for the second click. */
	.pill.picked {
		border-color: #ffb3d6;
		box-shadow:
			0 0 0 1px #ffb3d6,
			0 0 10px rgba(255, 140, 200, 0.45);
	}

	.pill.held {
		cursor: grabbing;
		opacity: 0.85;
	}

	.pill.add {
		border: 1px dashed var(--border-strong);
		background: none;
		color: var(--text-faint);
		cursor: pointer;
	}

	.pill.add:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--text-faint);
	}

	.pill.add:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.twin {
		margin: 0 auto 0 0;
		font-size: 12.5px;
		color: var(--warn);
	}

	.twin strong {
		color: var(--text);
	}

	.libhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 12px;
	}

	.lead {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px 12px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		min-width: 0;
	}

	.name {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
	}

	.by {
		font-size: 11.5px;
		color: var(--warn);
	}

	.by.flock {
		color: var(--text-faint);
	}

	.by.own {
		color: var(--ok);
	}

	.placed {
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 10.5px;
		color: var(--text-dim);
	}

	.sum {
		grid-column: 1;
		margin: 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.acts {
		grid-column: 2;
		grid-row: 1 / span 2;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.builder {
		display: grid;
		gap: 16px;
		padding: 18px 20px;
	}

	h3 {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin: 0;
		font-size: 14px;
	}

	.maker {
		font-size: 11.5px;
		font-weight: 500;
		color: var(--text-faint);
	}

	.field {
		display: grid;
		gap: 6px;
	}

	.flabel {
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.hint {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.inline {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.input.days {
		width: 80px;
	}

	input[type='date'] {
		color-scheme: dark;
	}

	input[type='date'].on {
		border-color: var(--pink);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 11px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: none;
		color: var(--text-dim);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}

	.chip:hover:not(:disabled) {
		color: var(--text);
	}

	.chip.on {
		background: rgba(255, 77, 158, 0.12);
		border-color: var(--pink);
		color: var(--text);
	}

	.chip:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.previewfrom {
		gap: 6px;
	}

	.previewfrom .hint {
		margin-right: 4px;
	}

	.preview {
		display: flex;
		padding: 14px 0;
		max-width: 520px;
	}

	.small {
		flex: none;
		padding: 6px 13px;
		font-size: 12.5px;
		white-space: nowrap;
	}

	.banner {
		margin: 0;
		padding: 9px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.bad {
		border-color: var(--warn);
		color: var(--warn);
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
