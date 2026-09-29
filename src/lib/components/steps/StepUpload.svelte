<script lang="ts">
	import { base } from '$app/paths';
	import VideoPicker from '../VideoPicker.svelte';
	import VideoPreview from '../VideoPreview.svelte';
	import PlatformIcon from '../PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { draft, type VideoSlot } from '$lib/stores/draft.svelte';
	import { general } from '$lib/stores/general.svelte';
	import {
		loadWatchIndex,
		loadLocalIndex,
		loadUsedSources,
		isUsed,
		type UsedIndex
	} from '$lib/repo';
	import { formatBytes } from '$lib/format';
	import type { LocalIndex, PlatformId, WatchFile, WatchIndex } from '$lib/types';

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

	function split(platform: PlatformId, own: boolean) {
		draft.setSplit(platform, own);
	}

	/* ---- dragging a listed file onto a video box ----
	 *
	 * The two file lists are drag sources, not pickers: a file is dragged onto
	 * the box it belongs in. The payload names the list and the file's path
	 * under a type of flock's own, so a drag from anywhere else is never
	 * mistaken for one. An OS file dropped on a box is still the VideoPicker's
	 * business; the slot only takes files itself while it shows a listed pick
	 * instead, since the picker is not rendered then.
	 */

	const DRAG_TYPE = 'application/x-flock-nas';

	type Source = 'nas' | 'local';

	/** The slot a drag is currently over, for the highlight. */
	let over = $state<VideoSlot | null>(null);

	function carriesListed(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes(DRAG_TYPE) ?? false;
	}

	function onDragStart(event: DragEvent, source: Source, path: string) {
		event.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ source, path }));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}

	function onDragOver(event: DragEvent, slot: VideoSlot) {
		const files = event.dataTransfer?.types.includes('Files') ?? false;
		if (!carriesListed(event) && !(files && draft.videos[slot].nasFile)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		over = slot;
	}

	function onDragLeave(event: DragEvent, slot: VideoSlot) {
		// Leaving for a child of the same box is not leaving the box.
		const into = event.relatedTarget as Node | null;
		if (into && (event.currentTarget as HTMLElement).contains(into)) return;
		if (over === slot) over = null;
	}

	function onDrop(event: DragEvent, slot: VideoSlot) {
		over = null;
		const payload = event.dataTransfer?.getData(DRAG_TYPE);
		if (payload) {
			event.preventDefault();
			let drag: { source?: Source; path?: string } = {};
			try {
				drag = JSON.parse(payload);
			} catch {
				return;
			}
			const list = drag.source === 'local' ? localIndex?.files : watchIndex?.files;
			const entry = list?.find((file) => file.path === drag.path);
			if (entry) draft.chooseNasFile(slot, drag.source === 'local' ? { ...entry, local: true } : entry);
			return;
		}
		if (!draft.videos[slot].nasFile) return;
		const file = event.dataTransfer?.files?.[0];
		if (!file || !file.type.startsWith('video/')) return;
		event.preventDefault();
		draft.chooseFile(slot, file);
	}

	/* ---- the two listings ----
	 *
	 * The browser cannot read a filesystem, so both come from the worker by
	 * way of PocketBase: the NAS watch folder, and the local folders pooled
	 * into one list. Each is as fresh as the worker's last poll, which is why
	 * the scan time is shown rather than implied.
	 */

	let watchIndex = $state<WatchIndex | null>(null);
	let localIndex = $state<LocalIndex | null>(null);
	let loading = $state(false);

	let hasLocal = $derived(general.value.localFolders.some((f) => f.path.trim()));

	async function refresh() {
		loading = true;
		try {
			const [watch, local, gone] = await Promise.all([
				general.value.watchFolder ? loadWatchIndex() : Promise.resolve(null),
				hasLocal ? loadLocalIndex() : Promise.resolve(null),
				loadUsedSources()
			]);
			watchIndex = watch;
			localIndex = local;
			used = gone;
		} catch {
			// Each box says what it is missing.
		} finally {
			loading = false;
		}
	}

	// Depends on the configured folders only: setting one in Settings should
	// make its list appear without a reload, and nothing here writes those.
	$effect(() => {
		void general.value.watchFolder;
		void hasLocal;
		void refresh();
	});

	function scannedAgo(iso: string | undefined): string {
		if (!iso) return 'never';
		const at = new Date(iso);
		if (Number.isNaN(at.getTime())) return 'never';
		const mins = Math.round((Date.now() - at.getTime()) / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins} min ago`;
		return at.toLocaleString();
	}

	/** The platforms whose slot currently holds a given listed file. */
	function usedBy(path: string): PlatformId[] {
		return slots
			.filter((entry) => draft.videos[entry.slot].nasFile?.path === path)
			.flatMap((entry) => entry.platforms);
	}

	/* ---- files that already went out ----
	 *
	 * Hidden from both lists (see `loadUsedSources` for what counts), with a
	 * toggle per list to show them again. A file picked for this upload stays
	 * visible regardless, so a pick never vanishes from under the pointer.
	 */

	let used = $state<UsedIndex>({ paths: new Set(), keys: new Set() });
	let showUsed = $state<Record<Source, boolean>>({ nas: false, local: false });

	function listing(files: WatchFile[], source: Source) {
		const gone = files.filter((file) => isUsed(used, file));
		const shown = showUsed[source]
			? files
			: files.filter((file) => !isUsed(used, file) || usedBy(file.path).length > 0);
		return { shown, hidden: gone.length };
	}

	let nasList = $derived(listing(watchIndex?.files ?? [], 'nas'));
	let localList = $derived(listing(localIndex?.files ?? [], 'local'));

	/* ---- playing a listed file ----
	 *
	 * A right-click on either list plays the file in a dialog, so a take can be
	 * told from the next before it is dragged anywhere. Neither folder is
	 * readable from a browser, so the worker streams it — see VideoPreview.
	 */

	let playing = $state<{ file: WatchFile; source: Source } | null>(null);
	let playerOpen = $state(false);

	function play(event: MouseEvent, source: Source, file: WatchFile) {
		event.preventDefault();
		playing = { file, source };
		playerOpen = true;
	}
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
				<section
					class="card slot"
					class:over={over === entry.slot}
					aria-label="Video for {slotLabel(entry.slot, entry.platforms)}"
					ondragover={(e) => onDragOver(e, entry.slot)}
					ondragleave={(e) => onDragLeave(e, entry.slot)}
					ondrop={(e) => onDrop(e, entry.slot)}
				>
					<header>
						<span class="icons">
							{#each entry.platforms as id (id)}
								<PlatformIcon platform={id} size={16} />
							{/each}
						</span>
						<span class="slotname">{slotLabel(entry.slot, entry.platforms)}</span>
						{#if entry.slot !== 'all'}
							<button class="relink" onclick={() => split(entry.slot as PlatformId, false)}>
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
								<p class="sub">
								{formatBytes(video.nasFile.size)} · {video.nasFile.local
									? 'local — the worker copies it to the NAS'
									: 'already on the NAS'}
							</p>
							</div>
							<button class="btn btn-ghost sm" onclick={() => draft.chooseNasFile(entry.slot, null)}>
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

	<div class="right">
		<section class="card files">
			<header class="nashead">
				<span class="label">Locally</span>
				<span class="for">drag onto a video box, right-click to play</span>
			</header>

			{#if !hasLocal}
				<p class="nasnote">
					No local folders set — add some in <a href="{base}/settings">Settings</a> to list the
					videos on this PC here.
				</p>
			{:else if loading && !localIndex}
				<p class="nasnote">Looking…</p>
			{:else if !localIndex}
				<p class="nasnote">The worker has not scanned the local folders yet.</p>
			{:else}
				{#each localIndex.folders.filter((f) => f.error) as folder (folder.folder)}
					<p class="nasnote bad">{folder.error}</p>
				{/each}
				{#if !general.value.watchFolder}
					<p class="nasnote bad">
						Local videos are copied into the NAS watch folder, and none is set — add one in
						<a href="{base}/settings">Settings</a> to use these.
					</p>
				{/if}
				{@render fileList(localList, 'local', Boolean(general.value.watchFolder))}
				{#if localIndex.files.length === 0}
					<p class="nasnote">Nothing in the local folders right now.</p>
				{/if}
				<p class="nasnote faint">
					Scanned {scannedAgo(localIndex.scannedAt)}.
					<button class="relink" onclick={refresh}>Refresh</button>
				</p>
			{/if}
		</section>

		<section class="card files">
			<header class="nashead">
				<span class="label">On the NAS</span>
				<span class="for">drag onto a video box, right-click to play</span>
			</header>

			{#if !general.value.watchFolder}
				<p class="nasnote">
					No watch folder set — add one in <a href="{base}/settings">Settings</a> to drop videos
					straight onto the NAS instead of uploading them here.
				</p>
			{:else if loading && !watchIndex}
				<p class="nasnote">Looking…</p>
			{:else if !watchIndex}
				<p class="nasnote">
					The worker has not scanned <code>{general.value.watchFolder}</code> yet.
				</p>
			{:else if watchIndex.error}
				<p class="nasnote bad">{watchIndex.error}</p>
			{:else}
				{@render fileList(nasList, 'nas', true)}
				{#if watchIndex.files.length === 0}
					<p class="nasnote">Nothing in <code>{watchIndex.folder}</code> right now.</p>
				{/if}
				<p class="nasnote faint">
					Scanned {scannedAgo(watchIndex.scannedAt)}.
					<button class="relink" onclick={refresh}>Refresh</button>
				</p>
			{/if}
		</section>
	</div>
</div>

<VideoPreview bind:open={playerOpen} file={playing?.file ?? null} source={playing?.source ?? 'nas'} />

{#snippet fileList(list: { shown: WatchFile[]; hidden: number }, source: Source, usable: boolean)}
	{#if list.shown.length > 0}
		<ul class="naslist">
			{#each list.shown as file (file.path)}
				{@const users = usedBy(file.path)}
				{@const gone = isUsed(used, file)}
				<li>
					<div
						class="nasitem"
						class:on={users.length > 0}
						class:gone
						class:locked={!usable}
						draggable={usable}
						role="listitem"
						title={usable ? 'Drag onto a video box, right-click to play' : 'Right-click to play'}
						ondragstart={(e) => onDragStart(e, source, file.path)}
						oncontextmenu={(e) => play(e, source, file)}
					>
						<span class="nasname">{file.name}</span>
						<span class="nasmeta">
							{formatBytes(file.size)}
							{#if gone}<span class="tag">uploaded before</span>{/if}
							{#if users.length > 0}
								<span class="users">
									{#each users as id (id)}
										<PlatformIcon platform={id} size={12} />
									{/each}
								</span>
							{/if}
						</span>
					</div>
				</li>
			{/each}
		</ul>
	{:else if list.hidden > 0}
		<p class="nasnote">Everything here has been uploaded before.</p>
	{/if}
	{#if list.hidden > 0}
		<button class="relink toggle" onclick={() => (showUsed[source] = !showUsed[source])}>
			{showUsed[source]
				? `Hide ${list.hidden} uploaded before`
				: `Show ${list.hidden} uploaded before`}
		</button>
	{/if}
{/snippet}

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

	.slot.over {
		border-color: var(--pink);
		background: rgba(255, 77, 158, 0.06);
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

	.right {
		min-width: 0;
		display: grid;
		gap: 16px;
		align-content: start;
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
		max-height: calc(50vh - 150px);
		min-height: 60px;
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
		cursor: grab;
		user-select: none;
		transition: border-color 0.14s, background 0.14s;
	}

	.nasitem:active {
		cursor: grabbing;
	}

	.nasitem.gone {
		opacity: 0.55;
	}

	.nasitem.locked {
		cursor: not-allowed;
	}

	.tag {
		padding: 0 6px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-dim);
	}

	.toggle {
		display: block;
		margin-top: 10px;
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
		.right {
			position: static;
		}
	}
</style>
