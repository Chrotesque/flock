<script lang="ts">
	import PlatformIcon from '../PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { settings } from '$lib/stores/settings.svelte';
	import { draft } from '$lib/stores/draft.svelte';
	import { isoDate, MONTH_NAMES, formatSchedule } from '$lib/format';
	import type { PlatformId } from '$lib/types';

	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	// The calendar assigns a date to whichever platform is focused, so one
	// click per platform is enough; the time inputs stay on the right.
	let focused = $state<PlatformId | null>(null);
	let cursor = $state(new Date());

	$effect(() => {
		const active = draft.activePlatforms;
		if (active.length && (!focused || !active.includes(focused))) focused = active[0];
	});

	// Seed a default date/time for every selected platform, so "continue" is
	// never blocked by a field the user never touched.
	$effect(() => {
		for (const id of draft.activePlatforms) {
			if (!draft.schedule[id]) draft.setSchedule(id, draft.scheduleFor(id));
		}
	});

	/** Profiles offered for a platform, empty unless it is in profiles mode. */
	function profilesFor(id: PlatformId) {
		const config = settings.schedulingFor(id);
		return config.mode === 'profiles' ? config.profiles : [];
	}

	const today = isoDate(new Date());

	let weeks = $derived.by(() => {
		const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
		// Monday-first grid.
		const offset = (first.getDay() + 6) % 7;
		const start = new Date(first);
		start.setDate(first.getDate() - offset);

		const result: { date: Date; iso: string; outside: boolean }[][] = [];
		const walker = new Date(start);
		for (let w = 0; w < 6; w++) {
			const week = [];
			for (let d = 0; d < 7; d++) {
				week.push({
					date: new Date(walker),
					iso: isoDate(walker),
					outside: walker.getMonth() !== cursor.getMonth()
				});
				walker.setDate(walker.getDate() + 1);
			}
			result.push(week);
		}
		return result;
	});

	function platformsOn(iso: string): PlatformId[] {
		return draft.activePlatforms.filter((id) => draft.schedule[id]?.date === iso);
	}

	function pick(iso: string) {
		if (!focused) return;
		draft.setSchedule(focused, { date: iso });
		// Advance to the next platform, so a staggered rollout is one click per
		// platform rather than a click-and-select each time.
		const active = draft.activePlatforms;
		if (active.length > 1) focused = active[(active.indexOf(focused) + 1) % active.length];
	}

	function shiftMonth(delta: number) {
		cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
	}

	function applyToAll() {
		if (!focused) return;
		const source = draft.scheduleFor(focused);
		for (const id of draft.activePlatforms) draft.setSchedule(id, { ...source });
	}
</script>

<div class="stage">
	<section class="cal card">
		<header>
			<button class="nav" onclick={() => shiftMonth(-1)} aria-label="Previous month">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none"
					><path
						d="M15 6l-6 6 6 6"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</button>
			<h3>{MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}</h3>
			<button class="nav" onclick={() => shiftMonth(1)} aria-label="Next month">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none"
					><path
						d="M9 6l6 6-6 6"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</button>
		</header>

		<div class="dow">
			{#each WEEKDAYS as day (day)}
				<span>{day}</span>
			{/each}
		</div>

		<div class="grid">
			{#each weeks as week, wi (wi)}
				{#each week as cell (cell.iso)}
					{@const on = platformsOn(cell.iso)}
					<button
						class="day"
						class:outside={cell.outside}
						class:today={cell.iso === today}
						class:past={cell.iso < today}
						class:has={on.length > 0}
						onclick={() => pick(cell.iso)}
					>
						<span class="num">{cell.date.getDate()}</span>
						{#if on.length}
							<span class="marks">
								{#each on as id (id)}
									<PlatformIcon platform={id} size={13} />
								{/each}
							</span>
						{/if}
					</button>
				{/each}
			{/each}
		</div>

		<p class="hint">
			{#if focused}
				Click a day to schedule <strong>{PLATFORMS[focused].label}</strong>. Past days are allowed —
				the worker publishes them on its next pass.
			{:else}
				No platforms selected.
			{/if}
		</p>
	</section>

	<aside class="side card">
		<header class="sidehead">
			<h3>Release times</h3>
			{#if draft.activePlatforms.length > 1}
				<button class="btn btn-ghost sm" onclick={applyToAll}>Match all to focused</button>
			{/if}
		</header>

		<ul>
			{#each draft.activePlatforms as id (id)}
				{@const entry = draft.scheduleFor(id)}
				<li class:focused={focused === id}>
					<button class="who" onclick={() => (focused = id)}>
						<span class="ic"><PlatformIcon platform={id} size={18} /></span>
						<span>
							<span class="name">{PLATFORMS[id].label}</span>
							<span class="when">{formatSchedule(entry.date, entry.time)}</span>
						</span>
					</button>
					{#if profilesFor(id).length > 0}
						{@const active = draft.profileFor(id)}
						<div class="profiles">
							{#each profilesFor(id) as profile (profile.id)}
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
				</li>
			{/each}
		</ul>
	</aside>
</div>

<style>
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 20px;
		align-items: start;
	}

	.cal {
		padding: 20px;
	}

	.cal header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	h3 {
		font-size: 14.5px;
	}

	.nav {
		width: 30px;
		height: 30px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		color: var(--text-dim);
		border: 1px solid var(--border);
	}

	.nav:hover {
		background: var(--surface-2);
		color: var(--text);
		border-color: var(--border-strong);
	}

	.dow {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 5px;
		margin-bottom: 6px;
	}

	.dow span {
		text-align: center;
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 5px;
	}

	.day {
		position: relative;
		aspect-ratio: 1.15;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		border-radius: 10px;
		border: 1px solid transparent;
		background: var(--bg-elev);
		color: var(--text-dim);
		transition: background 0.14s, border-color 0.14s, color 0.14s;
	}

	.day:hover {
		background: var(--surface-2);
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.day.outside {
		opacity: 0.32;
	}

	.day.past .num {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.day.today {
		border-color: var(--border-strong);
	}

	.day.today .num {
		color: var(--pink);
		font-weight: 700;
	}

	.day.has {
		background: var(--accent-grad-soft);
		border-color: rgba(255, 77, 158, 0.3);
		color: var(--text);
	}

	.num {
		font-size: 12.5px;
		font-weight: 550;
	}

	.marks {
		display: flex;
		gap: 2px;
	}

	.hint {
		margin: 16px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.hint strong {
		color: var(--pink-soft);
		font-weight: 600;
	}

	.side {
		padding: 18px 16px;
	}

	.sidehead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 14px;
	}

	.sm {
		padding: 5px 9px;
		font-size: 11.5px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	li {
		padding: 10px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	li.focused {
		border-color: rgba(255, 77, 158, 0.45);
		box-shadow: 0 0 0 1px rgba(255, 77, 158, 0.18);
	}

	.who {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		text-align: left;
		margin-bottom: 9px;
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

	.name {
		display: block;
		font-size: 13px;
		font-weight: 570;
	}

	.when {
		display: block;
		font-size: 11px;
		color: var(--text-faint);
	}

	.profiles {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-bottom: 8px;
	}

	.chip {
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		font-size: 11px;
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
		grid-template-columns: 1fr 108px;
		gap: 6px;
	}

	.inputs .input {
		padding: 7px 9px;
		font-size: 12.5px;
	}

	.time {
		text-align: center;
	}

	@media (max-width: 1040px) {
		.stage {
			grid-template-columns: 1fr;
		}
	}
</style>
