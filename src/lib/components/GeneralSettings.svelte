<script lang="ts">
	import { general } from '$lib/stores/general.svelte';
	import DeviceInfo from './DeviceInfo.svelte';

	// App-wide settings. Anything that is not tied to one platform lands here,
	// which for now means only where finished videos go on the NAS — release
	// timing moved to the individual platforms.
	let value = $derived(general.value);
</script>

<div class="general">
	<section>
		<div class="subhead">
			<div>
				<h4>NAS destinations</h4>
				<p>
					Folders a finished video is copied into — the original is left where it is. The default is
					recorded on each upload, so changing this list later never redirects something already
					queued.
				</p>
			</div>
			<button class="btn sm" onclick={() => general.addDestination()}>Add destination</button>
		</div>

		{#if value.destinations.length === 0}
			<p class="empty">
				No destinations yet. Add one so uploads have somewhere to land — for example a share path
				like <code>\\nas\media\uploads</code> or a path relative to the PocketBase data directory.
			</p>
		{:else}
			<ul>
				{#each value.destinations as destination (destination.id)}
					<li class:isdefault={value.defaultDestinationId === destination.id}>
						<button
							class="radio"
							role="radio"
							aria-checked={value.defaultDestinationId === destination.id}
							aria-label="Make {destination.label || 'this destination'} the default"
							onclick={() => general.setDefaultDestination(destination.id)}
						>
							<span class="dot"></span>
						</button>

						<div class="fields">
							<input
								class="input label-input"
								placeholder="Name (e.g. Finished uploads)"
								value={destination.label}
								oninput={(e) =>
									general.updateDestination(destination.id, { label: e.currentTarget.value })}
							/>
							<input
								class="input path-input"
								placeholder="Path on the NAS"
								value={destination.path}
								oninput={(e) =>
									general.updateDestination(destination.id, { path: e.currentTarget.value })}
							/>
						</div>

						<button
							class="del"
							onclick={() => general.removeDestination(destination.id)}
							aria-label="Remove destination"
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
					</li>
				{/each}
			</ul>

			<p class="hint">
				The filled circle marks the default. Nothing copies files yet — the destination is stored on
				the upload for the publishing worker to act on once it exists.
			</p>
		{/if}
	</section>

	<section>
		<div class="subhead">
			<div>
				<h4>This device</h4>
				<p>
					The name this browser records in the Log. Browsers cannot read the machine's hostname, so
					it is chosen once when flock first opens and stored on this device only. Names are unique
					across every machine, and cannot be changed afterwards — the Log already attributes past
					entries to this one.
				</p>
			</div>
		</div>

		<DeviceInfo />
	</section>
</div>

<style>
	.general {
		display: grid;
		gap: 28px;
	}

	.subhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 16px;
	}

	h4 {
		font-size: 13.5px;
	}

	.subhead p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		max-width: 58ch;
		line-height: 1.5;
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

	.empty code {
		font-family: var(--mono);
		font-size: 11.5px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface-2);
		color: var(--text-dim);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.15s;
	}

	li.isdefault {
		border-color: rgba(255, 77, 158, 0.4);
	}

	.radio {
		flex: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
		display: grid;
		place-items: center;
		transition: border-color 0.15s;
	}

	.radio:hover {
		border-color: var(--pink-soft);
	}

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: transparent;
		transition: background 0.15s;
	}

	li.isdefault .radio {
		border-color: var(--pink);
	}

	li.isdefault .dot {
		background: var(--accent-grad);
	}

	.fields {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
		gap: 8px;
	}

	.fields .input {
		padding: 7px 10px;
		font-size: 12.5px;
	}

	.path-input {
		font-family: var(--mono);
		font-size: 12px;
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

	.hint {
		margin: 12px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	@media (max-width: 720px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
