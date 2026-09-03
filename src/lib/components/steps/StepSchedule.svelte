<script lang="ts">
	import PlatformIcon from '../PlatformIcon.svelte';
	import PostCard from '../PostCard.svelte';
	import Checkbox from '../Checkbox.svelte';
	import WeekCalendar from '../WeekCalendar.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { settings } from '$lib/stores/settings.svelte';
	import { draft } from '$lib/stores/draft.svelte';
	import { buildPlan, type PlanRow } from '$lib/plan';
	import { startOfWeek, isoDate, minuteOf, makeTime } from '$lib/format';
	import { isPlatformId } from '$lib/platforms';
	import type { PlatformId } from '$lib/types';

	let weekStart = $state(startOfWeek(new Date()));

	// The cards are the plan rows themselves, so what is dragged around here is
	// literally what the confirmation screen will list. The platform id doubles
	// as the drag payload, since there is exactly one card per platform.
	let all = $derived(buildPlan().map((row) => ({ ...row, id: row.platform })));
	// A platform releasing on pickup has no slot, so it has no card: placing one
	// at "now" would claim a release time that is never handed to the platform.
	let rows = $derived(all.filter((row) => !row.immediate));
	let nowRows = $derived(all.filter((row) => row.immediate));

	let weekDays = $derived(
		new Set(
			Array.from({ length: 7 }, (_, i) => {
				const d = new Date(weekStart);
				d.setDate(d.getDate() + i);
				return isoDate(d);
			})
		)
	);
	let offWeek = $derived(rows.filter((row) => !weekDays.has(row.date)));

	function onDropItem(id: string, date: string, hour: number) {
		if (!isPlatformId(id)) return;
		// The minutes ride along, so a profile's 21:30 stays :30 when it is moved
		// to another day — only the hour comes from the row it was dropped on.
		const current = draft.scheduleFor(id);
		draft.setSchedule(id, { date, time: makeTime(hour, minuteOf(current.time)) });
	}

	function jumpTo(iso: string) {
		const [y, m, d] = iso.split('-').map(Number);
		weekStart = startOfWeek(new Date(y, m - 1, d));
	}

	function profilesFor(id: PlatformId) {
		const config = settings.schedulingFor(id);
		return config.mode === 'profiles' ? config.profiles : [];
	}
</script>

<div class="stage">
	<WeekCalendar
		items={rows}
		bind:weekStart
		candrag={() => true}
		dense
		ondropitem={onDropItem}
		card={cardFor}
		marker={dayMarker}
		offscreen={jumpTo_}
		toolbar={tip}
	/>

	{#if offWeek.length > 0}
		<div class="offweek">
			<span>Scheduled outside this week:</span>
			{#each offWeek as row (row.platform)}
				<button class="jump" onclick={() => jumpTo(row.date)}>
					<PlatformIcon platform={row.platform} size={13} />
					{PLATFORMS[row.platform].label}
					<em>{row.date}</em>
				</button>
			{/each}
		</div>
	{/if}

	{#if nowRows.length > 0}
		<div class="offweek nowstrip">
			<span>Releasing on pickup, so not on the grid:</span>
			{#each nowRows as row (row.platform)}
				<span class="jump static">
					<PlatformIcon platform={row.platform} size={13} />
					{PLATFORMS[row.platform].label}
				</span>
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
				</div>

				<Checkbox
					checked={now}
					label="Release immediately"
					onchange={(next) => draft.setImmediate(id, next)}
				/>

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
	<span class="daymark {row.platform}" title={PLATFORMS[row.platform].label}>
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

{#snippet tip()}
	<p class="tip">Drag an icon to another day or hour. Hover one to read it.</p>
{/snippet}

<style>
	.stage {
		display: grid;
		gap: 14px;
	}

	.tip {
		margin: 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.daymark {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: var(--surface-3);
		border: 1px solid var(--border);
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

	.who {
		display: flex;
		align-items: center;
		gap: 8px;
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

	/* Not a button, so it must not borrow .jump's interactive hover. */
	.nowstrip .static,
	.nowstrip .static:hover {
		cursor: default;
		border-color: var(--border);
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

	.inputs {
		display: grid;
		grid-template-columns: 1fr 96px;
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
