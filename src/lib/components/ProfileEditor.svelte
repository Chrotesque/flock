<script lang="ts">
	import { newId } from '$lib/id';
	import Checkbox from './Checkbox.svelte';
	import { WEEK_ORDER, dayLabel } from '$lib/format';
	import type { SchedulingProfile } from '$lib/types';

	// Named release patterns for one platform — "Horror goes out Friday at 21:00".
	// Time and days are independently switchable, so a profile can set only one
	// of them and leave the other to the normal default.
	let {
		profiles,
		label,
		onchange
	}: {
		profiles: SchedulingProfile[];
		label: string;
		onchange: (next: SchedulingProfile[]) => void;
	} = $props();

	function update(id: string, patch: Partial<SchedulingProfile>) {
		onchange(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
	}

	function toggleDay(profile: SchedulingProfile, day: number) {
		const days = profile.days.includes(day)
			? profile.days.filter((d) => d !== day)
			: [...profile.days, day].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
		update(profile.id, { days });
	}

	function add() {
		onchange([
			...profiles,
			{
				id: newId(),
				name: '',
				useTime: true,
				time: '09:00',
				useDays: false,
				days: []
			}
		]);
	}
</script>

<div class="editor">
	<header>
		<div>
			<h4>Profiles</h4>
			<p>
				Named release patterns for {label}. Pick one on the schedule step and it fills in the day
				and time for you.
			</p>
		</div>
		<button class="btn sm" onclick={add}>Add profile</button>
	</header>

	{#if profiles.length === 0}
		<p class="empty">
			No profiles yet. Add one for a kind of video you post on a rhythm — a name like
			<em>Horror</em>, a release time, and the days it usually goes out.
		</p>
	{:else}
		<ul>
			{#each profiles as profile (profile.id)}
				<li>
					<div class="top">
						<input
							class="input name"
							placeholder="Profile name (e.g. Horror)"
							value={profile.name}
							oninput={(e) => update(profile.id, { name: e.currentTarget.value })}
						/>
						<button
							class="del"
							onclick={() => onchange(profiles.filter((p) => p.id !== profile.id))}
							aria-label="Delete profile"
						>
							<svg viewBox="0 0 16 16" width="13" height="13"
								><path
									d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
									fill="none"
									stroke="currentColor"
									stroke-width="1.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</button>
					</div>

					<div class="opt">
						<Checkbox
							checked={profile.useTime}
							label="Default time"
							onchange={(next) => update(profile.id, { useTime: next })}
						/>
						<input
							class="input time"
							type="time"
							disabled={!profile.useTime}
							value={profile.time}
							onchange={(e) => update(profile.id, { time: e.currentTarget.value })}
						/>
					</div>

					<div class="opt days">
						<Checkbox
							checked={profile.useDays}
							label="Default days"
							onchange={(next) => update(profile.id, { useDays: next })}
						/>
						<div class="daypicker" class:disabled={!profile.useDays}>
							{#each WEEK_ORDER as day (day)}
								<button
									class="day"
									class:on={profile.days.includes(day)}
									disabled={!profile.useDays}
									aria-pressed={profile.days.includes(day)}
									onclick={() => toggleDay(profile, day)}
								>
									{dayLabel(day)}
								</button>
							{/each}
						</div>
					</div>

					{#if profile.useDays && profile.days.length === 0}
						<p class="warn">Pick at least one day, or this profile will not move the date.</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.editor header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}

	h4 {
		font-size: 13.5px;
	}

	header p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
		max-width: 56ch;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.empty {
		margin: 0;
		padding: 16px;
		border-radius: var(--radius);
		border: 1px dashed var(--border-strong);
		font-size: 12.5px;
		color: var(--text-faint);
		line-height: 1.6;
	}

	.empty em {
		color: var(--pink-soft);
		font-style: normal;
		font-weight: 600;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 9px;
	}

	li {
		padding: 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		display: grid;
		gap: 11px;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.name {
		flex: 1;
		min-width: 0;
		padding: 8px 11px;
		font-size: 13px;
		font-weight: 560;
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
	}

	.del:hover {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.opt {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.opt :global(.wrap) {
		width: 118px;
		flex: none;
	}

	.time {
		width: 118px;
		padding: 6px 10px;
		font-size: 12.5px;
		text-align: center;
	}

	.time:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.daypicker {
		display: flex;
		gap: 4px;
		transition: opacity 0.15s;
	}

	.daypicker.disabled {
		opacity: 0.4;
	}

	.day {
		width: 38px;
		padding: 5px 0;
		border-radius: 7px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-faint);
		font-size: 11px;
		font-weight: 600;
		transition: background 0.14s, color 0.14s, border-color 0.14s;
	}

	.day:hover:not(:disabled) {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.day.on {
		background: var(--accent-grad);
		border-color: transparent;
		color: #fff;
	}

	.warn {
		margin: 0;
		font-size: 11px;
		color: var(--warn);
	}

	@media (max-width: 760px) {
		.opt.days {
			align-items: flex-start;
			flex-direction: column;
			gap: 8px;
		}
	}
</style>
