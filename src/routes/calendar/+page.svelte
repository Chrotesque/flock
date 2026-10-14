<script lang="ts">
	import WeekCalendar from '$lib/components/WeekCalendar.svelte';
	import PostCard from '$lib/components/PostCard.svelte';
	import DaysSelect from '$lib/components/DaysSelect.svelte';
	import { listTargets, rescheduleTarget, toInstant } from '$lib/repo';
	import { isPlatformId, PLATFORM_IDS } from '$lib/platforms';
	import { addDays, dayStart, isoDate, makeTime, minuteOf } from '$lib/format';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { DaysShown } from '$lib/stores/daysshown.svelte';
	import type { PlatformId, UploadTarget } from '$lib/types';

	brands.load();

	const FILTER_KEY = 'flock.calendar.brand';

	function loadFilter(): string {
		try {
			return localStorage.getItem(FILTER_KEY) ?? '';
		} catch {
			return '';
		}
	}

	/**
	 * Which brand's releases are shown, '' for all of them. Remembered per
	 * browser, like the zone, and separate from the brand in view elsewhere:
	 * looking at every brand's week is the point of a calendar.
	 */
	let brandFilter = $state(loadFilter());

	function setFilter(id: string) {
		brandFilter = id;
		try {
			localStorage.setItem(FILTER_KEY, id);
		} catch {
			// Private windows and blocked site data throw; the filter just is not kept.
		}
	}

	/** A remembered brand that has since been deleted shows everything. */
	let shownBrand = $derived(brandFilter && brands.byId(brandFilter) ? brandFilter : '');

	// Everything ever scheduled, from PocketBase — not just the upload in
	// progress. Opens read-only: these rows are already committed, so moving one
	// is gated behind the two-press Edit button below.
	interface Entry {
		id: string;
		/** The upload it belongs to: its posts in one hour share a box. */
		job: string;
		date: string;
		time: string;
		platform: PlatformId;
		title: string;
		description: string;
		status: UploadTarget['status'];
		/** The platform holds it, or its slot has passed: it stays put while editing. */
		locked: boolean;
		/**
		 * Its slot is behind us (or it was called off): its upload's box recedes
		 * as history. An upcoming post YouTube already holds is locked but not past.
		 */
		past: boolean;
		/**
		 * The job's brand; empty once that brand was deleted. The name is the one
		 * snapshotted with the job, shown only after a deletion — a living
		 * brand is shown by its current name, so a rename reaches old cards too.
		 */
		brand: string;
		brandName: string;
	}

	/**
	 * A rolling run of days that opens two days back, so the last two days'
	 * releases stay in sight beside what is coming; 7 to 14 days, like the
	 * schedule step (daysshown.svelte.ts).
	 */
	const LEAD = 2;
	const days = new DaysShown('flock.calendar.days');
	let weekStart = $state(addDays(dayStart(new Date()), -LEAD));
	let entries = $state<Entry[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	/* ---- edit mode ----
	 *
	 * The calendar opens read-only. Editing here rewrites rows that are already
	 * committed to PocketBase, so the button arms on the first press and only
	 * unlocks on a second within 2s — the same two-step gate as the upload
	 * confirmation, for the same reason.
	 */
	let editing = $state(false);
	let armed = $state(false);
	let armTimer: ReturnType<typeof setTimeout> | null = null;
	let moveError = $state<string | null>(null);

	function disarm() {
		armed = false;
		if (armTimer) clearTimeout(armTimer);
		armTimer = null;
	}

	function onEditClick() {
		if (editing) {
			editing = false;
			disarm();
			return;
		}
		if (armed) {
			disarm();
			editing = true;
			return;
		}
		armed = true;
		if (armTimer) clearTimeout(armTimer);
		armTimer = setTimeout(() => {
			armed = false;
			armTimer = null;
		}, 2000);
	}

	/** Released, held and past-due rows stay put even while editing. */
	function canMove(entry: Entry): boolean {
		return editing && !entry.locked;
	}

	async function onDropItem(id: string, date: string, hour: number) {
		const entry = entries.find((e) => e.id === id);
		if (!entry || entry.locked) return;

		const time = makeTime(hour, minuteOf(entry.time));
		const previous = { date: entry.date, time: entry.time };

		// Optimistic: the card follows the cursor immediately, and rolls back if
		// PocketBase rejects the write.
		entry.date = date;
		entry.time = time;
		moveError = null;

		try {
			await rescheduleTarget(id, toInstant(date, time));
		} catch (err) {
			entry.date = previous.date;
			entry.time = previous.time;
			moveError = err instanceof Error ? err.message : String(err);
		}
	}

	function toEntry(target: UploadTarget, now: number): Entry | null {
		if (!isPlatformId(target.platform)) return null;
		const at = new Date(target.scheduled_at);
		if (Number.isNaN(at.getTime())) return null;

		// Locked once the platform holds it: `published` is live, `scheduled` is
		// uploaded with its release time already handed over, so dragging the card
		// would only lie about what happens. A slot that has simply passed still
		// reads as history too — that half goes away once every platform has a
		// worker and past-due pending becomes a real fault instead.
		const passed = at.getTime() < now;
		const locked =
			target.status === 'published' ||
			target.status === 'scheduled' ||
			target.status === 'cancelled' ||
			(target.status === 'pending' && passed);

		return {
			id: target.id,
			job: target.job,
			date: isoDate(at),
			time: makeTime(at.getHours(), at.getMinutes()),
			platform: target.platform,
			title: target.title,
			description: target.description,
			status: target.status,
			locked,
			past: passed || target.status === 'cancelled',
			brand: target.brand ?? '',
			brandName: target.brand_name ?? ''
		};
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const now = Date.now();
			const targets = await listTargets();
			// In the registry's order, so an upload's icons always line up the same way.
			entries = targets
				.map((target) => toEntry(target, now))
				.filter((entry): entry is Entry => entry !== null)
				.sort((a, b) => PLATFORM_IDS.indexOf(a.platform) - PLATFORM_IDS.indexOf(b.platform));
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void load();
	});

	let ofBrand = $derived(shownBrand ? entries.filter((entry) => entry.brand === shownBrand) : entries);

	let upcoming = $derived(ofBrand.filter((entry) => !entry.past).length);
	let released = $derived(ofBrand.filter((entry) => entry.past).length);

	/** Named on the card only while cards of several brands share the grid. */
	let labelBrands = $derived(brands.multiple && !shownBrand);

	function statusLabel(entry: Entry): string {
		if (entry.status === 'published') return 'released';
		if (entry.status === 'scheduled') return 'on the platform';
		if (entry.status === 'publishing') return 'uploading';
		if (entry.status === 'failed') return 'failed';
		if (entry.status === 'cancelled') return 'cancelled';
		return entry.past ? 'past due' : '';
	}
</script>

<div class="page">
<DeviceGate what="The calendar">
		{#if error}
			<p class="banner error">
				Could not reach PocketBase — {error}
				<button class="btn sm" onclick={load} disabled={loading}>Try again</button>
			</p>
		{:else if loading && entries.length === 0}
			<p class="banner">Loading…</p>
		{:else}
			{#if editing}
				<p class="banner editing">
					<strong>EDITING SCHEDULE</strong> — Drag an upcoming release to another day or hour.
					Released and past-due posts are locked.
				</p>
			{/if}

			{#if moveError}
				<p class="banner error">Could not move that release — {moveError}</p>
			{/if}

			<WeekCalendar
				items={ofBrand}
				bind:weekStart
				dayCount={days.shown}
				rolling
				lead={LEAD}
				dense
				allHours
				groupOf={(entry) => entry.job}
				past={(entry) => entry.past}
				card={cardFor}
				center={actions}
				toolbar={legend}
				candrag={canMove}
				ondropitem={editing ? onDropItem : undefined}
			/>

			{#if entries.length === 0}
				<p class="banner empty">
					Nothing scheduled yet. Confirm an upload and its releases appear here.
				</p>
			{/if}
		{/if}
</DeviceGate>
</div>

{#snippet cardFor(entry: Entry)}
	<PostCard
		platform={entry.platform}
		time={entry.time}
		title={entry.title}
		description={entry.description}
		status={statusLabel(entry)}
		brand={labelBrands ? (brands.byId(entry.brand)?.name ?? entry.brandName) : ''}
		compact
		bare
		hoverDelay={300}
	/>
{/snippet}

<!-- In the middle of the week's bar: which brand, and the buttons. -->
{#snippet actions()}
	{#if brands.multiple}
		<div class="brands" role="radiogroup" aria-label="Brand shown">
			<button
				class="brandchip"
				class:on={!shownBrand}
				role="radio"
				aria-checked={!shownBrand}
				onclick={() => setFilter('')}
			>
				All
			</button>
			{#each brands.ordered as brand (brand.id)}
				<button
					class="brandchip"
					class:on={shownBrand === brand.id}
					role="radio"
					aria-checked={shownBrand === brand.id}
					onclick={() => setFilter(brand.id)}
				>
					{brand.name}
				</button>
			{/each}
		</div>
	{/if}
	<button class="btn sm" onclick={load} disabled={loading}>Refresh</button>
	<button class="btn sm edit" class:armed class:on={editing} onclick={onEditClick} onblur={disarm}>
		{#if editing}
			STOP
		{:else if armed}
			Edit?
		{:else}
			Edit
		{/if}
	</button>
{/snippet}

{#snippet legend()}
	<div class="legend">
		<span class="count">{upcoming} upcoming</span>
		{#if released > 0}
			<span class="sep">·</span>
			<span class="count muted">{released} past</span>
		{/if}
	</div>
	<DaysSelect {days} />
{/snippet}

<style>
	/* Full width, like the upload page: the days share whatever the window
	   gives, and the layout's own 40px keeps them off the edges. */
	.page {
		max-width: none;
		margin: 0;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-right: 6px;
	}

	.brandchip {
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		font-size: 11.5px;
		font-weight: 560;
		color: var(--text-dim);
		transition: border-color 0.14s, background 0.14s, color 0.14s;
	}

	.brandchip:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.brandchip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.edit.armed {
		background: var(--pink-hot);
		border-color: transparent;
		color: #fff;
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.edit.on {
		background: var(--accent-grad);
		border-color: transparent;
		color: #fff;
	}

	.banner.editing {
		margin-bottom: 12px;
		background: var(--pink);
		border-color: var(--pink);
		color: var(--bg);
		font-weight: 500;
	}

	.banner.editing strong {
		font-weight: 800;
		letter-spacing: 0.04em;
	}

	.banner {
		margin: 0;
		padding: 13px 15px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.empty {
		margin-top: 12px;
	}

	.banner.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
		border-color: rgba(248, 113, 113, 0.4);
		color: var(--danger);
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.count.muted {
		color: var(--text-faint);
	}

	.sep {
		opacity: 0.5;
	}
</style>
