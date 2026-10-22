<script lang="ts">
	import PlatformIcon from '../PlatformIcon.svelte';
	import PostCard from '../PostCard.svelte';
	import Checkbox from '../Checkbox.svelte';
	import WeekCalendar from '../WeekCalendar.svelte';
	import DaysSelect from '../DaysSelect.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { settings } from '$lib/stores/settings.svelte';
	import { draft } from '$lib/stores/draft.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { takenHours } from '$lib/stores/takenhours.svelte';
	import { hourKey, takenWhy } from '$lib/takenhours';
	import { DaysShown } from '$lib/stores/daysshown.svelte';
	import { buildPlan, type PlanRow } from '$lib/plan';
	import { addDays, dayStart, isoDate, minuteOf, makeTime } from '$lib/format';
	import { isPlatformId } from '$lib/platforms';
	import type { PlatformId } from '$lib/types';

	// Not a week but a run of days from today (the user's layout), 7 to 14
	// of them (daysshown.svelte.ts).
	const days = new DaysShown('flock.schedule.days');
	let shownDays = $derived(days.shown);
	let weekStart = $state(dayStart(new Date()));

	// The cards are the plan rows themselves, so what is dragged around here is
	// literally what the confirmation screen will list. The platform id doubles
	// as the drag payload, since there is exactly one card per platform.
	let all = $derived(buildPlan().map((row) => ({ ...row, id: row.platform })));
	// A platform releasing on pickup has no slot, so it has no card: placing one
	// at "now" would claim a release time that is never handed to the platform.
	// It is marked in today's head instead, in no hour.
	let rows = $derived(all.filter((row) => !row.immediate));
	let headRows = $derived(
		all.map((row) => (row.immediate ? { ...row, date: isoDate(new Date()) } : row))
	);

	// An hour another video of this brand goes out in is closed to this one
	// (takenhours.ts): striped, and a drop there is refused. Followed live,
	// so a confirm on another machine closes its hour here too.
	$effect(() => takenHours.follow());
	let taken = $derived(takenHours.for(brands.currentId, draft.queuedJobs));

	function blocked(date: string, hour: number): string {
		const posts = taken.get(hourKey(date, hour));
		return posts ? takenWhy(posts) : '';
	}

	let weekDays = $derived(new Set(Array.from({ length: shownDays }, (_, i) => isoDate(addDays(weekStart, i)))));
	let offWeek = $derived(rows.filter((row) => !weekDays.has(row.date)));

	function onDropItem(id: string, date: string, hour: number, minute?: number) {
		if (!isPlatformId(id)) return;
		// The minutes ride along on the drop, so a profile's 21:30 stays :30 when
		// it is moved to another day; the grid's quarter picker then calls again
		// with the minute chosen.
		const current = draft.scheduleFor(id);
		draft.setSchedule(id, { date, time: makeTime(hour, minute ?? minuteOf(current.time)) });
	}

	/** Brings a day into view: as the first day when it is earlier, the last when later. */
	function jumpTo(iso: string) {
		const [y, m, d] = iso.split('-').map(Number);
		const day = new Date(y, m - 1, d);
		weekStart = day < weekStart ? day : addDays(day, -(shownDays - 1));
	}

	function profilesFor(id: PlatformId) {
		const config = settings.schedulingFor(id);
		return config.mode === 'profiles' ? config.profiles : [];
	}
</script>

<div class="stage">
	<WeekCalendar
		items={rows}
		headItems={headRows}
		bind:weekStart
		dayCount={shownDays}
		rolling
		candrag={() => true}
		{blocked}
		overridden={draft.overrideTaken}
		dense
		quarters
		ondropitem={onDropItem}
		card={cardFor}
		marker={dayMarker}
		offscreen={jumpTo_}
		toolbar={tip}
		start={override}
	/>

	{#if offWeek.length > 0}
		<div class="offweek">
			<span>Scheduled outside these {shownDays} days:</span>
			{#each offWeek as row (row.platform)}
				<button class="jump" onclick={() => jumpTo(row.date)}>
					<PlatformIcon platform={row.platform} size={13} />
					{PLATFORMS[row.platform].label}
					<em>{row.date}</em>
				</button>
			{/each}
		</div>
	{/if}

	<div class="strip">
		{#each draft.activePlatforms as id (id)}
			{@const entry = draft.scheduleFor(id)}
			{@const profiles = profilesFor(id)}
			{@const now = draft.isImmediate(id)}
			<div class="ctrl card" class:now>
				<div class="who">
					<span class="ic"><PlatformIcon platform={id} size={16} /></span>
					<span class="name">{PLATFORMS[id].label}</span>
					<span class="nowtick">
						<Checkbox
							checked={now}
							label="Release immediately"
							onchange={(next) => draft.setImmediate(id, next)}
						/>
					</span>
				</div>

				{#if now}
					<p class="nownote">
						Published as soon as the worker picks it up, at the visibility set in this platform's
						options — no release time is handed over.
					</p>
				{:else}
					{#if profiles.length > 0}
						{@const active = draft.profileFor(id)}
						<div class="chips">
							{#each profiles as profile (profile.id)}
								<button
									class="chip"
									class:on={active?.id === profile.id}
									onclick={() => draft.applyProfile(id, profile.id)}
								>
									{profile.name || 'Unnamed'}
								</button>
							{/each}
						</div>
					{/if}

					<div class="inputs">
						<input
							class="input sm"
							type="date"
							value={entry.date}
							onchange={(e) => draft.setSchedule(id, { date: e.currentTarget.value })}
						/>
						<input
							class="input sm time"
							type="time"
							value={entry.time}
							onchange={(e) => draft.setSchedule(id, { time: e.currentTarget.value })}
						/>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

{#snippet cardFor(row: PlanRow & { id: string })}
	<PostCard
		platform={row.platform}
		time={row.time}
		title={row.title}
		description={row.description}
		compact
	/>
{/snippet}

{#snippet dayMarker(row: PlanRow & { id: string })}
	<span
		class="daymark {row.platform}"
		class:now={row.immediate}
		title="{PLATFORMS[row.platform].label} · {row.immediate ? 'released on pickup' : row.time}"
	>
		<PlatformIcon platform={row.platform} size={13} />
	</span>
{/snippet}

{#snippet jumpTo_(row: PlanRow & { id: string }, direction: 'up' | 'down', center: () => void)}
	<button
		class="jumpto {row.platform}"
		onclick={center}
		aria-label="Scroll to {PLATFORMS[row.platform].label} at {row.time}"
		title="{PLATFORMS[row.platform].label} · {row.time}"
	>
		<PlatformIcon platform={row.platform} size={13} />
		<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
			{#if direction === 'up'}
				<path
					d="M6 9.5V2.5M2.8 5.7 6 2.5l3.2 3.2"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{:else}
				<path
					d="M6 2.5v7M2.8 6.3 6 9.5l3.2-3.2"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/if}
		</svg>
	</button>
{/snippet}

{#snippet override()}
	<span class="override" title="Lets this upload go out in hours another video of the brand already takes">
		<Checkbox
			checked={draft.overrideTaken}
			label="Override"
			onchange={(next) => (draft.overrideTaken = next)}
		/>
	</span>
{/snippet}

{#snippet tip()}
	<p class="tip">
		Drag an icon to another day or hour, then pick the minutes. Hover one to read it. Striped hours are
		taken by another video of {brands.current?.name ?? 'this brand'}.
	</p>
	<DaysSelect {days} />
{/snippet}

<style>
	.stage {
		display: grid;
		gap: 14px;
	}

	.override {
		font-size: 12px;
	}

	.tip {
		margin: 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	/* Sized by the grid's `--marker`, so four fit beside each other on a day. */
	.daymark {
		flex: none;
		display: grid;
		place-items: center;
		width: var(--marker, 20px);
		aspect-ratio: 1;
		border-radius: 5px;
		background: var(--surface-3);
		border: 1px solid var(--border);
	}

	.daymark :global(svg) {
		width: 66%;
		height: 66%;
	}

	/* Released on pickup: in today's head and no hour, outlined like its
	   box below. */
	.daymark.now {
		border-color: var(--pink);
	}

	/* Tinted with the platform's own colour so the arrow says *which* card is
	   off screen, not merely that one is. */
	.jumpto {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border-radius: 999px;
		background: var(--surface-3);
		border: 1px solid var(--brandline);
		box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
		color: var(--brandline);
		transition: background 0.14s, transform 0.08s;
	}

	.jumpto:hover {
		background: var(--surface-2);
		transform: translateY(-1px);
	}

	.jumpto:active {
		transform: translateY(0);
	}

	.youtube {
		--brandline: #e8484a;
	}
	.instagram {
		--brandline: #d6558f;
	}
	.tiktok {
		--brandline: #3de0dc;
	}
	.facebook {
		--brandline: #3b82f6;
	}

	.offweek {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
		padding: 9px 12px;
		border-radius: var(--radius);
		background: rgba(251, 191, 36, 0.08);
		border: 1px solid rgba(251, 191, 36, 0.28);
		font-size: 11.5px;
		color: var(--warn);
	}

	.jump {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text);
		font-size: 11px;
		font-weight: 560;
	}

	.jump:hover {
		border-color: var(--pink);
	}

	.jump em {
		font-style: normal;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 10px;
	}

	.ctrl {
		padding: 11px 12px;
		display: grid;
		gap: 8px;
		align-content: start;
	}

	/* The name left, the release tick right; a narrow box puts the tick under. */
	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
	}

	.nowtick {
		margin-left: auto;
		font-size: 12px;
	}

	.ic {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 8px;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	.name {
		font-size: 12.5px;
		font-weight: 570;
	}

	.ctrl.now {
		border-color: var(--pink);
	}

	.nownote {
		margin: 0;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.chip {
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		font-size: 10.5px;
		font-weight: 570;
		transition: background 0.14s, color 0.14s, border-color 0.14s;
	}

	.chip:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.chip.on {
		background: var(--accent-grad);
		border-color: transparent;
		color: #fff;
	}

	/* Date and time the same width. */
	.inputs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.inputs .input {
		padding: 6px 8px;
		font-size: 12px;
	}

	.time {
		text-align: center;
	}
</style>
