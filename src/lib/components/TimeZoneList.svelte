<script lang="ts">
	import { general } from '$lib/stores/general.svelte';
	import { isValidZone } from '$lib/timezones';

	// Extra zones for the calendar's second clock, beside the built-in US West
	// and US East. A zone is an IANA name; one the browser does not know is
	// flagged here and left out of the dropdown rather than shown as a wrong
	// clock.
</script>

<div class="zones">
	<div class="zonehead">
		<h3>Extra time zones</h3>
		<button class="btn sm" onclick={() => general.addTimeZone()}>Add</button>
	</div>
	<p class="hint">
		Offered in the calendar's time-zone dropdown beside US West and US East. The zone is an
		IANA name such as <code>Asia/Tokyo</code>.
	</p>

	{#each general.value.timeZones as tz (tz.id)}
		{@const known = isValidZone(tz.zone)}
		<div class="row">
			<input
				class="input"
				placeholder="Label, e.g. Tokyo"
				value={tz.label}
				oninput={(e) => general.updateTimeZone(tz.id, { label: e.currentTarget.value })}
			/>
			<input
				class="input mono"
				class:bad={Boolean(tz.zone.trim()) && !known}
				placeholder="Region/City"
				value={tz.zone}
				title={tz.zone.trim() && !known ? 'This browser does not know that zone.' : ''}
				oninput={(e) => general.updateTimeZone(tz.id, { zone: e.currentTarget.value })}
			/>
			<button class="btn btn-ghost sm" onclick={() => general.removeTimeZone(tz.id)}>Remove</button>
		</div>
	{/each}

	{#if general.value.timeZones.length === 0}
		<p class="hint faint">None added. US West and US East are always offered.</p>
	{/if}
</div>

<style>
	.zones {
		margin-top: 22px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}

	.zonehead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.zonehead h3 {
		margin: 0;
		font-size: 14px;
	}

	.hint {
		margin: 6px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.hint.faint {
		color: var(--text-faint);
	}

	.hint code {
		font-family: var(--mono);
		font-size: 11.5px;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}

	.mono {
		font-family: var(--mono);
		font-size: 12.5px;
	}

	.input.bad {
		border-color: var(--danger);
	}

	.sm {
		padding: 6px 12px;
		font-size: 12px;
	}
</style>
