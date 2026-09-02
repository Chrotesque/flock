<script lang="ts">
	import WeekCalendar from '$lib/components/WeekCalendar.svelte';
	import PostCard from '$lib/components/PostCard.svelte';
	import Checkbox from '$lib/components/Checkbox.svelte';
	import { listTargets, rescheduleTarget, toInstant } from '$lib/repo';
	import { isPlatformId } from '$lib/platforms';
	import { startOfWeek, isoDate, makeTime, minuteOf } from '$lib/format';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import type { PlatformId, UploadTarget } from '$lib/types';

	// Everything ever scheduled, from PocketBase — not just the upload in
	// progress. Opens read-only: these rows are already committed, so moving one
	// is gated behind the two-press Edit button below.
	interface Entry {
		id: string;
		date: string;
		time: string;
		platform: PlatformId;
		title: string;
		description: string;
		status: UploadTarget['status'];
		/** Released, or past its slot — either way it is history. */
		done: boolean;
	}

	let weekStart = $state(startOfWeek(new Date()));
	let entries = $state<Entry[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showDone = $state(true);

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

	/** Released and past-due rows are history — they stay put even while editing. */
	function canMove(entry: Entry): boolean {
		return editing && !entry.done;
	}

	async function onDropItem(id: string, date: string, hour: number) {
		const entry = entries.find((e) => e.id === id);
		if (!entry || entry.done) return;

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
		const done =
			target.status === 'published' ||
			target.status === 'scheduled' ||
			target.status === 'cancelled' ||
			(target.status === 'pending' && at.getTime() < now);

		return {
			id: target.id,
			date: isoDate(at),
			time: makeTime(at.getHours(), at.getMinutes()),
			platform: target.platform,
			title: target.title,
			description: target.description,
			status: target.status,
			done
		};
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const now = Date.now();
			const targets = await listTargets();
			entries = targets
				.map((target) => toEntry(target, now))
				.filter((entry): entry is Entry => entry !== null);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void load();
	});

	let visible = $derived(showDone ? entries : entries.filter((entry) => !entry.done));

	let upcoming = $derived(entries.filter((entry) => !entry.done).length);
	let released = $derived(entries.filter((entry) => entry.done).length);

	function statusLabel(entry: Entry): string {
		if (entry.status === 'published') return 'released';
		if (entry.status === 'scheduled') return 'on the platform';
		if (entry.status === 'publishing') return 'uploading';
		if (entry.status === 'failed') return 'failed';
		if (entry.status === 'cancelled') return 'cancelled';
		return entry.done ? 'past due' : '';
	}
</script>

<div class="page">
<DeviceGate what="The calendar">
		<header class="head">
			<div>
				<h1>Calendar</h1>
				<p>Everything scheduled, across every upload.</p>
			</div>
			<div class="actions">
				<button class="btn sm" onclick={load} disabled={loading}>Refresh</button>
				<button
					class="btn sm edit"
					class:armed
					class:on={editing}
					onclick={onEditClick}
					onblur={disarm}
				>
					{#if editing}
						STOP
					{:else if armed}
						Edit?
					{:else}
						Edit
					{/if}
				</button>
			</div>
		</header>

		{#if error}
			<p class="banner error">Could not reach PocketBase — {error}</p>
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
				items={visible}
				bind:weekStart
				card={cardFor}
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
		muted={entry.done}
		status={statusLabel(entry)}
	/>
{/snippet}

{#snippet legend()}
	<div class="legend">
		<span class="count">{upcoming} upcoming</span>
		{#if released > 0}
			<span class="sep">·</span>
			<span class="count muted">{released} past</span>
			<Checkbox checked={showDone} label="Show past" onchange={(next) => (showDone = next)} />
		{/if}
	</div>
{/snippet}

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 22px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.actions {
		display: flex;
		gap: 8px;
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
