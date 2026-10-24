<script lang="ts">
	import { base } from '$app/paths';
	import VideoPicker from '../VideoPicker.svelte';
	import VideoPreview from '../VideoPreview.svelte';
	import PlatformIcon from '../PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { draft, type VideoSlot } from '$lib/stores/draft.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { projects } from '$lib/stores/projects.svelte';
	import { workers } from '$lib/stores/workers.svelte';
	import { paste } from '$lib/stores/paste.svelte';
	import {
		loadWatchIndex,
		loadLocalIndex,
		loadUsedSources,
		isUsed,
		type UsedIndex
	} from '$lib/repo';
	import { formatBytes } from '$lib/format';
	import { folderKind, folderName, parentName } from '$lib/folders';
	import { readVideos } from '$lib/projects';
	import type { PlatformId, WatchFile, WatchIndex } from '$lib/types';

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
	 * The file lists are drag sources, not pickers: a file is dragged onto
	 * the box it belongs in. The payload names the list and the file's path
	 * under a type of flock's own, so a drag from anywhere else is never
	 * mistaken for one. An OS file dropped on a box is still the VideoPicker's
	 * business; the slot only takes files itself while it shows a listed pick
	 * instead, since the picker is not rendered then.
	 */

	const DRAG_TYPE = 'application/x-flock-nas';

	type Source = 'watch' | 'project';

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
		if (!carriesListed(event) && !(files && (draft.videos[slot].nasFile || draft.videos[slot].kept))) return;
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
			const list = drag.source === 'project' ? projectVideos : pooled;
			const entry = list.find((file) => file.path === drag.path);
			if (entry && usable(entry)) draft.chooseNasFile(slot, entry);
			return;
		}
		if (!draft.videos[slot].nasFile && !draft.videos[slot].kept) return;
		const file = event.dataTransfer?.files?.[0];
		if (!file || !file.type.startsWith('video/')) return;
		event.preventDefault();
		draft.chooseFile(slot, file);
	}

	/* ---- the watch folders ----
	 *
	 * One list in Settings, two listings here: the browser cannot read a
	 * filesystem, so both come from the workers by way of PocketBase — the
	 * LAN folders from the one that publishes, the local ones from the PC's.
	 * They are pooled into one list, newest first. Each is as fresh as its
	 * worker's last poll, which is why the scan time is shown, not implied.
	 */

	let watchIndex = $state<WatchIndex | null>(null);
	let localIndex = $state<WatchIndex | null>(null);
	let loading = $state(false);

	let configured = $derived(general.value.watchFolders.map((f) => f.path.trim()).filter(Boolean));
	let hasNetwork = $derived(configured.some((p) => folderKind(p) === 'network'));
	let hasLocal = $derived(configured.some((p) => folderKind(p) === 'local'));

	async function refresh() {
		loading = true;
		try {
			const [watch, local, gone] = await Promise.all([
				hasNetwork ? loadWatchIndex() : Promise.resolve(null),
				hasLocal ? loadLocalIndex() : Promise.resolve(null),
				loadUsedSources()
			]);
			watchIndex = watch;
			localIndex = local;
			used = gone;
		} catch {
			// The box says what it is missing.
		} finally {
			loading = false;
		}
	}

	// Depends on the configured folders only: changing one in Settings should
	// make its list appear without a reload, and nothing here writes those.
	$effect(() => {
		void configured.join('|');
		void refresh();
	});

	/** Both listings as one, newest first; a local file says so, for the copy it needs. */
	let pooled = $derived(
		[
			...(watchIndex?.files ?? []),
			...(localIndex?.files ?? []).map((file) => ({ ...file, local: true }))
		].sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
	);

	let folderErrors = $derived(
		[...(watchIndex?.folders ?? []), ...(localIndex?.folders ?? [])].filter((f) => f.error)
	);

	/**
	 * A local file is copied onto the network before it publishes, so it needs
	 * a LAN watch folder to go into — unless a single `all` worker both lists
	 * and publishes, which uses it where it lies.
	 */
	let canImport = $derived(Boolean(general.importFolder) || workers.view.dots.some((d) => d.role === 'all'));

	function usable(file: WatchFile): boolean {
		return !file.local || canImport;
	}

	/* ---- the project open in this upload ----
	 *
	 * Its folder's videos, listed by the worker on the project row. A local
	 * project's videos are copied onto the network like any local pick.
	 */

	let project = $derived(projects.byId(draft.project));
	let projectVideos = $derived(
		readVideos(project?.videos).map((file) => (project?.local ? { ...file, local: true } : file))
	);
	let fileChanged = $derived(
		Boolean(project && draft.projectBase && project.manifest_modified && project.manifest_modified !== draft.projectBase)
	);

	let dismissArmed = $state(false);
	let dismissTimer: ReturnType<typeof setTimeout> | null = null;

	/** Two presses within two seconds, as everywhere a click cannot be undone. */
	async function dismiss() {
		if (!project) return;
		if (!dismissArmed) {
			dismissArmed = true;
			dismissTimer = setTimeout(() => (dismissArmed = false), 2000);
			return;
		}
		if (dismissTimer) clearTimeout(dismissTimer);
		dismissArmed = false;
		try {
			await projects.dismiss(project.id);
			paste.cancel();
			draft.reset();
		} catch (err) {
			paste.refuse(err instanceof Error ? err.message : String(err));
		}
	}

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
	let showUsed = $state(false);

	function listing(files: WatchFile[], hide: boolean) {
		const gone = files.filter((file) => isUsed(used, file));
		const shown =
			showUsed || !hide ? files : files.filter((file) => !isUsed(used, file) || usedBy(file.path).length > 0);
		return { shown, hidden: hide ? gone.length : 0 };
	}

	let watchList = $derived(listing(pooled, true));
	// A project's own videos are all shown: it is the place to find them.
	let projectList = $derived(listing(projectVideos, false));

	/* ---- playing a listed file ----
	 *
	 * A right-click on either list plays the file in a dialog, so a take can be
	 * told from the next before it is dragged anywhere. Neither folder is
	 * readable from a browser, so the worker streams it — see VideoPreview.
	 */

	let playing = $state<WatchFile | null>(null);
	let playerOpen = $state(false);

	function play(event: MouseEvent, file: WatchFile) {
		event.preventDefault();
		playing = file;
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

					{#if video.kept}
						<!-- The edited upload's own video: stored already, so nothing
						     goes up again unless another one is picked over it. -->
						<div class="picked">
							<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
								<path
									d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v11A2.5 2.5 0 0 1 13.5 20h-7A2.5 2.5 0 0 1 4 17.5v-11ZM16 9.5l4-2.2v9.4l-4-2.2"
									stroke="currentColor"
									stroke-width="1.7"
									stroke-linejoin="round"
								/>
							</svg>
							<div class="pickedmeta">
								<p class="pickedname">{video.kept.name}</p>
								<p class="sub">
									{formatBytes(video.kept.size)} · the queued upload's video — kept, nothing is sent again
								</p>
							</div>
							<button
								class="btn btn-ghost sm"
								title="Pick another video for this upload's posts: a file, or one from a folder on the right"
								onclick={() => draft.keepVideo(entry.slot, null)}
							>
								Replace
							</button>
						</div>
					{:else if video.nasFile}
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
		{#if project}
			<section class="card files project">
				<header class="nashead">
					<span class="label">Project Folder · <span class="pname">{project.name}</span></span>
					<span class="for">drag onto a video box, right-click to play</span>
				</header>
				<p class="nasnote faint" title={project.path}>
					In {folderName(project.root)} · {project.manifest_name || 'flock JSON'} · {project.local ? 'local' : 'LAN'}
				</p>

				{#if fileChanged}
					<p class="nasnote warn">
						{project.manifest_name || 'The project file'} has changed since this upload was filled from it.
						<button class="relink" onclick={() => projects.refill()}>Fill from it again</button>
					</p>
				{/if}
				{#if project.missing}
					<p class="nasnote bad">The project file is no longer in the folder.</p>
				{/if}
				{#if project.error}
					<p class="nasnote bad">{project.error}</p>
				{/if}
				{#if project.local && projectVideos.length > 0 && !canImport}
					<p class="nasnote bad">
						These are on the PC, and are copied into a LAN watch folder before publishing — add one in
						<a href="{base}/settings">Settings</a> to use them.
					</p>
				{/if}

				{@render fileList(projectList, 'project')}
				{#if projectVideos.length === 0}
					<p class="nasnote">No videos in this folder yet — the worker lists them as they arrive.</p>
				{/if}

				<button class="relink toggle drop" class:armed={dismissArmed} onclick={dismiss}>
					{dismissArmed ? 'Press again to take it off the list' : 'Not uploading this one? Take it off the list'}
				</button>
			</section>
		{/if}

		<section class="card files">
			<header class="nashead">
				<span class="label">Watch folders</span>
				<span class="for">drag onto a video box, right-click to play</span>
			</header>

			{#if configured.length === 0}
				<p class="nasnote">
					No watch folders set — add some in <a href="{base}/settings">Settings</a> to list videos on
					the NAS or on this PC here.
				</p>
			{:else if loading && !watchIndex && !localIndex}
				<p class="nasnote">Looking…</p>
			{:else}
				{#if hasNetwork && !watchIndex}
					<p class="nasnote">The worker has not scanned the LAN folders yet.</p>
				{/if}
				{#if hasLocal && !localIndex}
					<p class="nasnote">The worker on this PC has not scanned the local folders yet.</p>
				{/if}
				{#each folderErrors as folder (folder.folder)}
					<p class="nasnote bad">{folder.error}</p>
				{/each}
				{#if pooled.some((file) => file.local) && !canImport}
					<p class="nasnote bad">
						Local videos are copied into a LAN watch folder before publishing, and none is set — add one
						in <a href="{base}/settings">Settings</a> to use them.
					</p>
				{/if}
				{@render fileList(watchList, 'watch')}
				{#if (watchIndex || localIndex) && pooled.length === 0}
					<p class="nasnote">Nothing in the watch folders right now.</p>
				{/if}
				{#if watchIndex || localIndex}
					<p class="nasnote faint">
						{#if watchIndex && localIndex}
							LAN scanned {scannedAgo(watchIndex.scannedAt)}, local {scannedAgo(localIndex.scannedAt)}.
						{:else}
							Scanned {scannedAgo((watchIndex ?? localIndex)?.scannedAt)}.
						{/if}
						<button class="relink" onclick={refresh}>Refresh</button>
					</p>
				{/if}
			{/if}
		</section>
	</div>
</div>

<VideoPreview bind:open={playerOpen} file={playing} source={playing?.local ? 'local' : 'nas'} />

{#snippet fileList(list: { shown: WatchFile[]; hidden: number }, source: Source)}
	{#if list.shown.length > 0}
		<ul class="naslist">
			{#each list.shown as file (file.path)}
				{@const users = usedBy(file.path)}
				{@const gone = isUsed(used, file)}
				{@const ok = usable(file)}
				<li>
					<div
						class="nasitem"
						class:on={users.length > 0}
						class:gone
						class:locked={!ok}
						draggable={ok}
						role="listitem"
						title={ok ? 'Drag onto a video box, right-click to play' : 'Right-click to play'}
						ondragstart={(e) => onDragStart(e, source, file.path)}
						oncontextmenu={(e) => play(e, file)}
					>
						<span class="nasname">{file.name}</span>
						<span class="nasmeta">
							{formatBytes(file.size)}
							{#if source === 'watch' && parentName(file.path)}
								<span class="where">{parentName(file.path)}</span>
							{/if}
							{#if file.local}<span class="tag">local</span>{/if}
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
		<button class="relink toggle" onclick={() => (showUsed = !showUsed)}>
			{showUsed ? `Hide ${list.hidden} uploaded before` : `Show ${list.hidden} uploaded before`}
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

	.nasnote.warn {
		color: var(--warn);
	}

	.project {
		border: 1px solid rgba(255, 77, 158, 0.35);
	}

	.pname {
		text-transform: none;
		letter-spacing: 0;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text);
	}

	.drop {
		color: var(--text-faint);
	}

	.drop.armed {
		color: var(--danger);
	}

	.where {
		max-width: 18ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nasnote a,
	.warnbox a {
		color: var(--pink-soft);
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
