<script lang="ts">
	import { base } from '$app/paths';
	import VideoPicker from '../VideoPicker.svelte';
	import PlatformIcon from '../PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { draft, type VideoSlot } from '$lib/stores/draft.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { loadWatchIndex } from '$lib/repo';
	import { formatBytes } from '$lib/format';
	import type { PlatformId, WatchIndex } from '$lib/types';

	general.load();

	/* ---- which video goes where ----
	 *
	 * One video serves every platform by default. Splitting a platform off
	 * gives it a slot of its own, one platform at a time, so a slightly
	 * different cut can go to one of them within the same upload. The split
	 * is remembered per browser until it is changed again.
	 */

	let slots = $derived(draft.slots);

	function slotLabel(slot: VideoSlot, platforms: PlatformId[]): string {
		if (slot !== 'all') return `${PLATFORMS[slot].label} only`;
		return slots.length === 1 ? 'Every platform' : platforms.map((id) => PLATFORMS[id].label).join(', ');
	}

	/**
	 * Which slot a click in the NAS list fills. Falls back to the first slot
	 * when the one picked stops existing (merged back, or unticked).
	 */
	let target = $state<VideoSlot>('all');
	let shownTarget = $derived(
		slots.some((entry) => entry.slot === target) ? target : (slots[0]?.slot ?? 'all')
	);

	function split(platform: PlatformId, own: boolean) {
		draft.setSplit(platform, own);
		// The new slot is the one that needs a file next.
		target = own ? platform : 'all';
	}

	/* ---- videos already sitting on the NAS ----
	 *
	 * The browser cannot read a filesystem, so the listing comes from the worker
	 * by way of PocketBase. It is therefore as fresh as the worker's last poll,
	 * which is why the scan time is shown rather than implied.
	 */

	let watchIndex = $state<WatchIndex | null>(null);
	let watchLoading = $state(false);

	async function refreshWatch() {
		if (!general.value.watchFolder) return;
		watchLoading = true;
		try {
			watchIndex = await loadWatchIndex();
		} catch {
			watchIndex = null;
		} finally {
			watchLoading = false;
		}
	}

	// Depends on the configured folder only: setting one in Settings should make
	// the list appear without a reload, but nothing here writes what it reads.
	$effect(() => {
		void general.value.watchFolder;
		void refreshWatch();
	});

	let scannedLabel = $derived.by(() => {
		if (!watchIndex?.scannedAt) return 'never';
		const at = new Date(watchIndex.scannedAt);
		if (Number.isNaN(at.getTime())) return 'never';
		const mins = Math.round((Date.now() - at.getTime()) / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins} min ago`;
		return at.toLocaleString();
	});

	/** The platforms whose slot currently holds a given NAS file. */
	function usedBy(path: string): PlatformId[] {
		return slots
			.filter((entry) => draft.videos[entry.slot].nasFile?.path === path)
			.flatMap((entry) => entry.platforms);
	}

	let targetPlatforms = $derived(slots.find((entry) => entry.slot === shownTarget)?.platforms ?? []);
</script>

<div class="stage">
	<div class="left">
		{#if draft.activePlatforms.length === 0}
			<p class="warnbox">
				No platforms are selected for this upload. Tick one on the Details step, or turn one on in
				<a href="{base}/settings">Settings</a>.
			</p>
		{:else}
			<section class="card splitcard">
				<div class="splithead">
					<span class="label">Own file</span>
					<p class="hint">
						Give a platform a video of its own; the rest keep sharing one. Remembered for the
						next upload.
					</p>
				</div>
				<div class="chips">
					{#each draft.activePlatforms as id (id)}
						{@const own = draft.split.includes(id)}
						<button
							class="chip"
							class:on={own}
							aria-pressed={own}
							title={own ? `${PLATFORMS[id].label} has its own file` : `Give ${PLATFORMS[id].label} its own file`}
							onclick={() => split(id, !own)}
						>
							<PlatformIcon platform={id} size={16} />
							<span>{PLATFORMS[id].label}</span>
						</button>
					{/each}
				</div>
			</section>

			{#each slots as entry (entry.slot)}
				{@const video = draft.videos[entry.slot]}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<section
					class="card slot"
					class:target={slots.length > 1 && shownTarget === entry.slot}
					onclick={() => (target = entry.slot)}
				>
					<header>
						<span class="icons">
							{#each entry.platforms as id (id)}
								<PlatformIcon platform={id} size={16} />
							{/each}
						</span>
						<span class="slotname">{slotLabel(entry.slot, entry.platforms)}</span>
						{#if entry.slot !== 'all'}
							<button
								class="relink"
								onclick={(e) => {
									e.stopPropagation();
									split(entry.slot as PlatformId, false);
								}}
							>
								Use the shared file
							</button>
						{/if}
					</header>

					{#if video.nasFile}
						<div class="picked">
							<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
								<path
									d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2h6A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
									stroke="currentColor"
									stroke-width="1.7"
									stroke-linejoin="round"
								/>
							</svg>
							<div class="pickedmeta">
								<p class="pickedname">{video.nasFile.name}</p>
								<p class="sub">{formatBytes(video.nasFile.size)} · already on the NAS</p>
							</div>
							<button
								class="btn btn-ghost sm"
								onclick={(e) => {
									e.stopPropagation();
									draft.chooseNasFile(entry.slot, null);
								}}
							>
								Remove
							</button>
						</div>
					{:else}
						<VideoPicker
							bind:file={draft.videos[entry.slot].file}
							bind:duration={draft.videos[entry.slot].duration}
							onchange={(next) => draft.chooseFile(entry.slot, next)}
						/>
					{/if}
				</section>
			{/each}
		{/if}
	</div>

	<section class="card nas">
		<header class="nashead">
			<span class="label">On the NAS</span>
			{#if slots.length > 1 && targetPlatforms.length > 0}
				<span class="for">
					picking for
					{#each targetPlatforms as id (id)}
						<PlatformIcon platform={id} size={13} />
					{/each}
				</span>
			{/if}
		</header>

		{#if !general.value.watchFolder}
			<p class="nasnote">
				No watch folder set — add one in <a href="{base}/settings">Settings</a> to drop videos
				straight onto the NAS instead of uploading them here.
			</p>
		{:else if watchLoading && !watchIndex}
			<p class="nasnote">Looking…</p>
		{:else if !watchIndex}
			<p class="nasnote">
				The worker has not scanned <code>{general.value.watchFolder}</code> yet.
			</p>
		{:else if watchIndex.error}
			<p class="nasnote bad">{watchIndex.error}</p>
		{:else if watchIndex.files.length === 0}
			<p class="nasnote">Nothing in <code>{watchIndex.folder}</code> right now.</p>
		{:else}
			<ul class="naslist">
				{#each watchIndex.files as file (file.path)}
					{@const users = usedBy(file.path)}
					<li>
						<button
							class="nasitem"
							class:on={users.length > 0}
							disabled={slots.length === 0}
							onclick={() => draft.chooseNasFile(shownTarget, file)}
						>
							<span class="nasname">{file.name}</span>
							<span class="nasmeta">
								{formatBytes(file.size)}
								{#if users.length > 0}
									<span class="users">
										{#each users as id (id)}
											<PlatformIcon platform={id} size={12} />
										{/each}
									</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if watchIndex && !watchIndex.error}
			<p class="nasnote faint">
				Scanned {scannedLabel}.
				<button class="relink" onclick={refreshWatch}>Refresh</button>
			</p>
		{/if}
	</section>
</div>

<style>
	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 20px;
		align-items: start;
	}

	.left {
		min-width: 0;
		display: grid;
		gap: 16px;
		align-content: start;
	}

	.card {
		min-width: 0;
		padding: 18px 16px;
	}

	.label {
		display: block;
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px 7px 10px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		color: var(--text-dim);
		font-size: 12.5px;
		font-weight: 570;
		transition: background 0.14s, color 0.14s, border-color 0.14s;
	}

	.chip:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.chip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.slot {
		display: grid;
		gap: 12px;
		border: 1px solid var(--border);
		transition: border-color 0.14s;
	}

	.slot.target {
		border-color: var(--pink);
	}

	.slot header {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.icons,
	.users,
	.for {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.slotname {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		font-weight: 580;
	}

	.picked {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
		padding: 16px 18px;
		border-radius: var(--radius-lg);
		border: 1.5px solid var(--border-strong);
		background: var(--bg-elev);
		color: var(--pink);
	}

	.pickedmeta {
		min-width: 0;
	}

	.pickedname {
		margin: 0 0 3px;
		font-weight: 580;
		font-size: 13.5px;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.sub {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.sm {
		padding: 5px 10px;
		font-size: 12px;
	}

	.nas {
		position: sticky;
		top: 0;
	}

	.nashead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.for {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.nasnote {
		margin: 10px 0 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.nasnote.bad {
		color: var(--danger);
	}

	.nasnote a,
	.warnbox a {
		color: var(--pink-soft);
	}

	.nasnote code {
		font-family: var(--mono);
		font-size: 10.5px;
		overflow-wrap: anywhere;
	}

	.relink {
		color: var(--pink-soft);
		font-size: 11.5px;
		text-decoration: underline;
	}

	.naslist {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: grid;
		gap: 5px;
		max-height: calc(100vh - 260px);
		overflow-y: auto;
	}

	.nasitem {
		width: 100%;
		display: grid;
		gap: 1px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-elev);
		text-align: left;
		transition: border-color 0.14s, background 0.14s;
	}

	.nasitem:hover {
		border-color: var(--pink-soft);
	}

	.nasitem.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
	}

	.nasname {
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text);
		/* File names have no spaces to break at. */
		overflow-wrap: anywhere;
	}

	.nasmeta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.warnbox {
		margin: 0;
		padding: 9px 11px;
		border-radius: var(--radius-sm);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		color: var(--warn);
		font-size: 12px;
	}

	@media (max-width: 1040px) {
		.stage {
			grid-template-columns: 1fr;
		}
		.nas {
			position: static;
		}
	}
</style>
