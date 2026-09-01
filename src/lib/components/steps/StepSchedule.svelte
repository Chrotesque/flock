<script lang="ts">
	import PlatformIcon from '../PlatformIcon.svelte';
	import PostCard from '../PostCard.svelte';
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
	let rows = $derived(buildPlan().map((row) => ({ ...row, id: row.platform })));

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
		ondropitem={onDropItem}
		card={cardFor}
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

	<div class="strip">
		{#each draft.activePlatforms as id (id)}
			{@const entry = draft.scheduleFor(id)}
			{@const profiles = profilesFor(id)}
			<div class="ctrl card">
				<div class="who">
					<span class="ic"><PlatformIcon platform={id} size={16} /></span>
					<span class="name">{PLATFORMS[id].label}</span>
				</div>

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
	/>
{/snippet}

{#snippet tip()}
	<p class="tip">Drag a card to another day or hour.</p>
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
