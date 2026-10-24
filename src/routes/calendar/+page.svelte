<script lang="ts">
	import WeekCalendar from '$lib/components/WeekCalendar.svelte';
	import PostCard from '$lib/components/PostCard.svelte';
	import DaysSelect from '$lib/components/DaysSelect.svelte';
	import UploadTip from '$lib/components/UploadTip.svelte';
	import PostActionsMenu from '$lib/components/PostActionsMenu.svelte';
	import { actOnPosts, listTargets, rescheduleTargets, subscribeTargets, toInstant } from '$lib/repo';
	import { readRequest, type PostAction } from '$lib/postactions';
	import { uploadEdit } from '$lib/stores/uploadedit.svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { MoveRefused, isMoving, landReason, lockReason, moveRefusal } from '$lib/reschedule';
	import { isPlatformId, PLATFORMS, PLATFORM_IDS } from '$lib/platforms';
	import { productLabel } from '$lib/product';
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
	// is gated behind the two-press Edit button below. What may move, and
	// where to, is reschedule.ts's call — the same rules the write checks.
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
		/** As stored, for the move rules; `date` and `time` are its local reading. */
		scheduled_at: string;
		/** The worker's record, with the time a platform was handed (reschedule.ts). */
		handle: unknown;
		/** A release now or a delete the worker has yet to carry out (postactions.ts). */
		request: unknown;
		remote_url: string;
		/**
		 * Its slot is behind us (or it was called off): its upload's box recedes
		 * as history. An upcoming post YouTube already holds is not past.
		 */
		past: boolean;
		/**
		 * The job's brand; empty once that brand was deleted. The name is the one
		 * snapshotted with the job, shown only after a deletion — a living
		 * brand is shown by its current name, so a rename reaches old cards too.
		 */
		brand: string;
		brandName: string;
		/** The upload's product name as stored; shown under its box while editing (productLabel); '' for none. */
		product: string;
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
			menu = null;
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

	/* ---- the right-click menu: release at once, or delete ----
	 *
	 * Always the whole upload, wherever it was clicked — an icon or the box
	 * — and every post of it, in whichever hour each sits; the menu offers
	 * all of it or the platforms ticked.
	 */

	let menu = $state<{ job: string; x: number; y: number } | null>(null);
	const menuPosts = $derived(menu ? entries.filter((entry) => entry.job === menu!.job) : []);

	function openMenu(items: Entry[], x: number, y: number) {
		if (items.length > 0) menu = { job: items[0].job, x, y };
	}

	/** Throws for the menu to show; it closes itself once this succeeds. */
	async function act(action: PostAction, ids: string[]) {
		await actOnPosts(action, ids);
		void load();
	}

	/** The upload, opened in the wizard to be edited (uploadedit.svelte.ts). */
	function editUpload(job: string) {
		uploadEdit.offer(job);
		void goto(`${base}/upload`);
	}

	/** What may still move goes; the rest shakes when pressed and says why. */
	function canMove(entry: Entry): boolean {
		return editing && !lockReason(entry);
	}

	function landWhy(entry: Entry, date: string, time: string): string {
		return landReason(entry, new Date(toInstant(date, time)));
	}

	/** One platform's post, dragged by its icon. */
	function onDropItem(id: string, date: string, hour: number): Promise<string | void> {
		return move([id], date, hour);
	}

	/** A whole upload's posts in that hour, dragged by the box's grip. */
	function onDropGroup(ids: string[], date: string, hour: number): Promise<string | void> {
		return move(ids, date, hour);
	}

	/**
	 * Moves posts to another day and hour, each keeping its own minutes. A
	 * refusal comes back as the reason, for the grid to shake them with; none
	 * moves unless all may.
	 */
	async function move(ids: string[], date: string, hour: number): Promise<string | void> {
		const group = ids.map((id) => entries.find((e) => e.id === id)).filter((e): e is Entry => Boolean(e));
		const moves = group
			.map((entry) => ({ entry, time: makeTime(hour, minuteOf(entry.time)) }))
			.filter(({ entry, time }) => date !== entry.date || time !== entry.time)
			.map(({ entry, time }) => ({ entry, time, at: toInstant(date, time) }));
		if (moves.length === 0) return;
		for (const { entry, at } of moves) {
			const refused = lockReason(entry) || landReason(entry, new Date(at));
			if (refused) return refused;
		}
		const previous = moves.map(({ entry }) => ({ date: entry.date, time: entry.time, scheduled_at: entry.scheduled_at }));

		// Optimistic: the cards follow the cursor immediately, and roll back if
		// PocketBase rejects the write. A post a platform holds then shows as
		// moving until the worker has told the platform.
		for (const { entry, time, at } of moves) {
			entry.date = date;
			entry.time = time;
			entry.scheduled_at = at;
		}
		moveError = null;

		try {
			await rescheduleTargets(moves.map(({ entry, at }) => ({ id: entry.id, scheduledAt: at })));
		} catch (err) {
			moves.forEach(({ entry }, i) => Object.assign(entry, previous[i]));
			if (err instanceof MoveRefused) return err.message;
			moveError = err instanceof Error ? err.message : String(err);
			// Anything written before the failure is back from PocketBase.
			void load();
			return 'Not saved.';
		}
	}

	function toEntry(target: UploadTarget, now: number): Entry | null {
		if (!isPlatformId(target.platform)) return null;
		const at = new Date(target.scheduled_at);
		if (Number.isNaN(at.getTime())) return null;

		const passed = at.getTime() < now;

		return {
			id: target.id,
			job: target.job,
			date: isoDate(at),
			time: makeTime(at.getHours(), at.getMinutes()),
			platform: target.platform,
			title: target.title,
			description: target.description,
			status: target.status,
			scheduled_at: target.scheduled_at,
			handle: target.handle,
			request: target.request ?? null,
			remote_url: target.remote_url ?? '',
			past: passed || target.status === 'cancelled',
			brand: target.brand ?? '',
			brandName: target.brand_name ?? '',
			product: target.product ?? ''
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

	// Live: the worker settling a move (or turning one down), a post going
	// out, a confirm elsewhere. A burst of changes reads once.
	$effect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const stop = subscribeTargets(() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => void load(), 500);
		});
		return () => {
			if (timer) clearTimeout(timer);
			stop();
		};
	});

	let ofBrand = $derived(shownBrand ? entries.filter((entry) => entry.brand === shownBrand) : entries);

	let upcoming = $derived(ofBrand.filter((entry) => !entry.past).length);
	let released = $derived(ofBrand.filter((entry) => entry.past).length);

	/** Named on the card only while cards of several brands share the grid. */
	let labelBrands = $derived(brands.multiple && !shownBrand);

	/** A living brand by its current name, a deleted one by the job's snapshot. */
	function brandOf(entry: Entry): string {
		return brands.byId(entry.brand)?.name ?? entry.brandName;
	}

	/** What is under way with a post, or went wrong, for its icon's dot and the hover card. */
	function moveNote(entry: Entry): { note: string; noteKind: '' | 'busy' | 'warn' } {
		const label = PLATFORMS[entry.platform].label;
		const request = readRequest(entry.request);
		if (request?.kind === 'release') return { note: `Releasing: the worker is putting it out on ${label} now.`, noteKind: 'busy' };
		if (request?.kind === 'delete') return { note: `Deleting: the worker is deleting it from ${label}.`, noteKind: 'busy' };
		if (request?.kind === 'edit') return { note: `Editing: the worker is changing it on ${label}.`, noteKind: 'busy' };
		if (isMoving(entry)) return { note: 'Moving: the worker is telling the platform the new time.', noteKind: 'busy' };
		const refused = moveRefusal(entry);
		if (refused) return { note: refused, noteKind: 'warn' };
		return { note: '', noteKind: '' };
	}

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
					<strong>EDITING SCHEDULE</strong> — Drag an icon to move that platform's post, or a
					box's grip (left edge) to move the whole upload — at least 15 minutes ahead; YouTube and
					Facebook are told by the worker within seconds. Right-click a post or a box to edit the upload
					in Upload, release it at once or delete it. A post that can no longer move shakes and says why.
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
				rowSpace={4}
				allHours
				groupOf={(entry) => entry.job}
				past={(entry) => entry.past}
				groupTip={uploadTip}
				groupLabel={editing ? (items) => productLabel(items[0]?.product ?? '') : undefined}
				card={cardFor}
				center={actions}
				toolbar={legend}
				candrag={canMove}
				lockedWhy={(entry) => lockReason(entry)}
				{landWhy}
				ondropitem={editing ? onDropItem : undefined}
				ondropgroup={editing ? onDropGroup : undefined}
				oncontext={editing ? openMenu : undefined}
			/>

			{#if entries.length === 0}
				<p class="banner empty">
					Nothing scheduled yet. Confirm an upload and its releases appear here.
				</p>
			{/if}
		{/if}
</DeviceGate>
</div>

{#if menu && menuPosts.length > 0}
	<PostActionsMenu
		job={menu.job}
		posts={menuPosts}
		x={menu.x}
		y={menu.y}
		onact={act}
		onedit={() => editUpload(menu!.job)}
		close={() => (menu = null)}
	/>
{/if}

{#snippet cardFor(entry: Entry)}
	<PostCard
		platform={entry.platform}
		time={entry.time}
		title={entry.title}
		description={entry.description}
		status={statusLabel(entry)}
		brand={labelBrands ? brandOf(entry) : ''}
		badge={moveNote(entry).noteKind}
		compact
		bare
	/>
{/snippet}

<!-- Hovering an upload's box: every post of that upload, wherever it sits. -->
{#snippet uploadTip(items: Entry[])}
	{@const first = items[0]}
	<UploadTip
		date={first.date}
		posts={entries
			.filter((entry) => entry.job === first.job)
			.map((entry) => ({ ...entry, status: statusLabel(entry), ...moveNote(entry) }))}
		brand={labelBrands ? brandOf(first) : ''}
		product={editing ? productLabel(first.product) : ''}
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
