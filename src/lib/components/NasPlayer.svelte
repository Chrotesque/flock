<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { loadPlayerJob, loadStoredPlayer, playerJobFileUrl } from '$lib/repo';
	import { previewCheckUrl, previewVideoUrl } from '$lib/preview';
	import { formatBytes, formatDuration } from '$lib/format';
	import {
		NOT_FLOCK,
		NO_DESTINATION,
		NO_PLAYER,
		blockedAddress,
		copyOf,
		mixedContent,
		notAnswering,
		playbackReason,
		playerBox,
		readVolume,
		shortPath,
		stepVolume,
		storedProblem,
		VOLUME_KEY,
		type Reason
	} from '$lib/storedcopy';

	/**
	 * An opened Dashboard row's video, played from its upload's copy on the
	 * NAS — the publishing worker streams it — or, when that cannot play, the
	 * file PocketBase still holds for a browser upload (see storedcopy.ts).
	 * The thumbnail stands in until it is started; the corner button, the
	 * bar's, a double-click or F put the whole box in full screen, bar and
	 * all.
	 */
	let {
		job,
		title,
		poster = '',
		upright = false,
		duration = 0,
		watch = null
	}: {
		/** The flock upload, '' for a video that went out some other way. */
		job: string;
		title: string;
		poster?: string;
		/** The shape to assume until the video says (a Short). */
		upright?: boolean;
		/** Seconds, for the chip until the video says. */
		duration?: number;
		/** Where else to watch it, for a video with no copy. */
		watch?: { label: string; url: string } | null;
	} = $props();

	type Phase =
		| { kind: 'asking' }
		| { kind: 'ready'; src: string; from: 'nas' | 'flock'; path: string; size: number; note: string }
		| { kind: 'blocked'; reason: Reason; link: { label: string; url: string } | null };

	let phase = $state<Phase>({ kind: 'asking' });
	/** Width ÷ height, once the video's metadata is read. */
	let ratio = $state(0);
	let started = $state(false);
	let paused = $state(true);
	let muted = $state(false);
	/** 0 to 1, bound to the video and remembered by this browser. */
	let volume = $state(storedVolume());
	let awake = $state(false);
	let fullscreen = $state(false);
	let current = $state(0);
	let length = $state(0);
	let buffered = $state(0);
	let scrubbing = $state(false);

	let box = $state<HTMLDivElement>();
	let video = $state<HTMLVideoElement>();
	let scrubber = $state<HTMLDivElement>();

	const size = $derived(playerBox(ratio || (upright ? 9 / 16 : 16 / 9)));
	/** What is heard: nothing while muted. */
	const level = $derived(muted ? 0 : volume);
	const shown = $derived(length || duration);
	const progress = $derived(shown > 0 ? Math.min(1, current / shown) : 0);

	// The prop reads through the Dashboard's row, which is rebuilt with every
	// refresh; a derived only passes the id on when it really changes.
	const jobId = $derived(job);

	// Depends on the upload alone: everything else connect reads is untracked,
	// so the Dashboard refreshing its numbers never restarts a playing video.
	$effect(() => {
		const id = jobId;
		const controller = new AbortController();
		untrack(() => void connect(id, controller.signal));
		return () => {
			controller.abort();
			phase = { kind: 'asking' };
			ratio = 0;
			started = false;
			paused = true;
			current = 0;
			length = 0;
			buffered = 0;
		};
	});

	async function connect(id: string, signal: AbortSignal) {
		if (!id) {
			phase = { kind: 'blocked', reason: NOT_FLOCK, link: watch };
			return;
		}
		let row;
		try {
			row = await loadPlayerJob(id);
		} catch {
			if (!signal.aborted) {
				phase = { kind: 'blocked', reason: { title: 'Can’t play right now', text: 'Its upload could not be read.' }, link: null };
			}
			return;
		}
		if (signal.aborted) return;
		if (!row) {
			phase = { kind: 'blocked', reason: storedProblem('no-job'), link: watch };
			return;
		}

		const copy = copyOf(row);
		let reason: Reason = copy.state === 'none' ? NO_DESTINATION : storedProblem('not-stored');
		if (copy.state === 'stored') {
			const answer = await askWorker(id, signal);
			if (signal.aborted) return;
			if ('src' in answer) {
				phase = { kind: 'ready', src: answer.src, from: 'nas', path: copy.path, size: answer.size || row.video_size, note: '' };
				return;
			}
			reason = answer.reason;
		}
		// A browser upload's own file, which needs no worker.
		if (row.video) {
			phase = {
				kind: 'ready',
				src: playerJobFileUrl(row),
				from: 'flock',
				path: '',
				size: row.video_size,
				note: `${reason.title}: ${reason.text}`
			};
			return;
		}
		phase = { kind: 'blocked', reason, link: null };
	}

	async function askWorker(id: string, signal: AbortSignal): Promise<{ src: string; size: number } | { reason: Reason }> {
		const server = await loadStoredPlayer().catch(() => null);
		if (!server) return { reason: NO_PLAYER };
		if (mixedContent(location.protocol, server.url)) return { reason: blockedAddress(server.url) };
		try {
			const res = await fetch(previewCheckUrl(server.url, 'stored', id), {
				cache: 'no-store',
				signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
			});
			const answer: { ok?: boolean; error?: string; size?: number } = await res.json();
			if (answer.ok) return { src: previewVideoUrl(server.url, 'stored', id), size: Number(answer.size) || 0 };
			return { reason: storedProblem(answer.error) };
		} catch {
			return { reason: notAnswering(server.url) };
		}
	}

	/* ---- playing ---- */

	let sleep: ReturnType<typeof setTimeout> | undefined;
	function wake() {
		awake = true;
		clearTimeout(sleep);
		sleep = setTimeout(() => (awake = false), 2200);
	}

	function start() {
		if (phase.kind !== 'ready' || !video) return;
		started = true;
		void video.play().catch(() => {});
		wake();
	}

	function toggle() {
		if (!video || phase.kind !== 'ready') return;
		if (!started) return start();
		if (video.paused) void video.play().catch(() => {});
		else video.pause();
		wake();
	}

	function storedVolume(): number {
		try {
			return readVolume(localStorage.getItem(VOLUME_KEY));
		} catch {
			return 1;
		}
	}

	$effect(() => {
		const value = volume;
		try {
			localStorage.setItem(VOLUME_KEY, String(value));
		} catch {
			// A private window or blocked site data: it just is not remembered.
		}
	});

	/** Muting from silence brings the sound back at half, not at nothing. */
	function toggleMute() {
		if (level > 0) muted = true;
		else {
			muted = false;
			if (volume === 0) volume = 0.5;
		}
		wake();
	}

	function setLevel(value: number) {
		volume = value;
		if (value > 0) muted = false;
		wake();
	}

	function toggleFullscreen() {
		if (phase.kind !== 'ready' || !box) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => {});
			return;
		}
		if (!started) start();
		void box.requestFullscreen?.().catch(() => {});
	}

	function seekBy(seconds: number) {
		if (!video || !shown) return;
		video.currentTime = Math.max(0, Math.min(shown, video.currentTime + seconds));
		wake();
	}

	// One click plays or pauses, two go full screen: the single waits a moment
	// so the first click of a double does not also pause.
	let clickTimer: ReturnType<typeof setTimeout> | undefined;
	function onSurfaceClick() {
		clearTimeout(clickTimer);
		clickTimer = setTimeout(toggle, 220);
	}
	function onSurfaceDouble() {
		clearTimeout(clickTimer);
		toggleFullscreen();
	}

	function onKey(event: KeyboardEvent) {
		if (phase.kind !== 'ready' || event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.key.toLowerCase();
		// The volume slider moves itself with the arrows.
		if (key.startsWith('arrow') && event.target instanceof HTMLInputElement) return;
		if (key === 'f') toggleFullscreen();
		else if (key === 'm') toggleMute();
		else if (key === 'k') toggle();
		else if (key === 'arrowright') seekBy(5);
		else if (key === 'arrowleft') seekBy(-5);
		else if (key === 'arrowup') setLevel(stepVolume(level, 0.1));
		else if (key === 'arrowdown') setLevel(stepVolume(level, -0.1));
		else return;
		event.preventDefault();
	}

	// On the box rather than in markup: the box is a group, not a control.
	$effect(() => {
		const node = box;
		if (!node) return;
		node.addEventListener('keydown', onKey);
		return () => node.removeEventListener('keydown', onKey);
	});

	function onMeta() {
		if (!video) return;
		length = Number.isFinite(video.duration) ? video.duration : 0;
		if (video.videoWidth && video.videoHeight) ratio = video.videoWidth / video.videoHeight;
	}

	function onProgress() {
		if (!video || !shown || video.buffered.length === 0) return;
		buffered = Math.min(1, video.buffered.end(video.buffered.length - 1) / shown);
	}

	function onError() {
		if (!video) return;
		phase = { kind: 'blocked', reason: playbackReason(video.error?.code), link: null };
		started = false;
	}

	/* ---- the seek bar ---- */

	function seekTo(event: PointerEvent) {
		if (!scrubber || !video || !shown) return;
		const rect = scrubber.getBoundingClientRect();
		const at = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		current = at * shown;
		video.currentTime = current;
	}

	function onScrubDown(event: PointerEvent) {
		scrubbing = true;
		scrubber?.setPointerCapture(event.pointerId);
		seekTo(event);
		wake();
	}

	function onScrubMove(event: PointerEvent) {
		if (!scrubbing) return;
		seekTo(event);
		wake();
	}

	function onScrubKey(event: KeyboardEvent) {
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			event.stopPropagation();
			event.preventDefault();
			seekBy(event.key === 'ArrowRight' ? 5 : -5);
		}
	}

	function onFullscreenChange() {
		fullscreen = Boolean(box) && document.fullscreenElement === box;
		if (fullscreen) wake();
	}

	onDestroy(() => {
		clearTimeout(sleep);
		clearTimeout(clickTimer);
		if (box && document.fullscreenElement === box) void document.exitFullscreen().catch(() => {});
	});

	const clock = (seconds: number) => formatDuration(seconds) || '0:00';
</script>

{#snippet volumeControl()}
	<!-- The slider opens leftwards, so the speaker stays under the pointer. -->
	<div class="vol">
		<input
			class="level"
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={level}
			oninput={(event) => setLevel(Number(event.currentTarget.value))}
			aria-label="Volume"
			title="Volume (↑ ↓)"
			style:--level="{level * 100}%"
		/>
		<button onclick={toggleMute} aria-label={level === 0 ? 'Sound on' : 'Mute'} title="Mute (M)">
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
				<path d="M2 6h2.5L8 3v10L4.5 10H2z" />
				{#if level === 0}
					<path class="line" d="M10.5 6l4 4m0-4-4 4" />
				{:else if level < 0.5}
					<path class="line" d="M10.5 5.5a3.5 3.5 0 0 1 0 5" />
				{:else}
					<path class="line" d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.6a6 6 0 0 1 0 8.8" />
				{/if}
			</svg>
		</button>
	</div>
{/snippet}

<svelte:document onfullscreenchange={onFullscreenChange} />

<div class="pwrap" class:narrow={size.width < 260} style:--pw="{size.width}px" style:--ph="{size.height}px">
	<div
		bind:this={box}
		class="player"
		class:started
		class:paused
		class:awake
		class:fullscreen
		class:blocked={phase.kind === 'blocked'}
		role="group"
		aria-label="Video: {title}"
		onpointermove={() => started && wake()}
	>
		{#if phase.kind === 'ready'}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={video}
				src={phase.src}
				preload="metadata"
				playsinline
				bind:volume
				bind:muted
				onloadedmetadata={onMeta}
				ontimeupdate={() => !scrubbing && video && (current = video.currentTime)}
				onprogress={onProgress}
				onplay={() => (paused = false)}
				onpause={() => (paused = true)}
				onended={() => {
					paused = true;
					wake();
				}}
				onerror={onError}
			></video>
		{/if}
		{#if poster}<img class="poster" src={poster} alt="" />{/if}

		{#if fullscreen}
			<div class="fstitle">
				{title}
				<small>{phase.kind === 'ready' && phase.from === 'nas' ? phase.path : 'Stored in flock'}</small>
			</div>
		{/if}

		{#if phase.kind === 'ready'}
			<button class="surface" onclick={onSurfaceClick} ondblclick={onSurfaceDouble} aria-label={paused ? 'Play' : 'Pause'}
			></button>
			{#if !started}
				<button class="bigplay" onclick={start} aria-label="Play">
					<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
				</button>
				{#if shown > 0}<span class="chip">{clock(shown)}</span>{/if}
				<!-- Before it plays: the volume, so it can be set first, and full screen. -->
				<div class="corner">
					{@render volumeControl()}
					<button class="cornerfs" onclick={toggleFullscreen} title="Full screen (F)" aria-label="Play full screen">
						<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" class="line"
							><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg
						>
					</button>
				</div>
			{:else}
				<div class="bar">
					<div
						bind:this={scrubber}
						class="scrub"
						class:dragging={scrubbing}
						role="slider"
						tabindex="0"
						aria-label="Seek"
						aria-valuemin={0}
						aria-valuemax={Math.round(shown)}
						aria-valuenow={Math.round(current)}
						aria-valuetext="{clock(current)} of {clock(shown)}"
						onpointerdown={onScrubDown}
						onpointermove={onScrubMove}
						onpointerup={() => (scrubbing = false)}
						onpointercancel={() => (scrubbing = false)}
						onkeydown={onScrubKey}
					>
						<span class="track"></span>
						<span class="buf" style:width="{buffered * 100}%"></span>
						<span class="fill" style:width="{progress * 100}%"></span>
						<span class="knob" style:left="{progress * 100}%"></span>
					</div>
					<div class="btns">
						<button onclick={toggle} aria-label={paused ? 'Play' : 'Pause'} title="Play / pause (K)">
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
								{#if paused}
									<path d="M4.5 2.5v11l9-5.5z" />
								{:else}
									<rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" />
								{/if}
							</svg>
						</button>
						<span class="time">{clock(current)}<span class="total"> / {clock(shown)}</span></span>
						<span class="grow"></span>
						{@render volumeControl()}
						<button
							class="fs"
							onclick={toggleFullscreen}
							aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
							title="Full screen (F)"
						>
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" class="line">
								{#if fullscreen}
									<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
								{:else}
									<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
								{/if}
							</svg>
						</button>
					</div>
				</div>
			{/if}
		{:else if phase.kind === 'blocked'}
			<div class="why">
				<strong><i></i>{phase.reason.title}</strong>
				<p>
					{phase.reason.text}
					{#if phase.link}<a href={phase.link.url} target="_blank" rel="noopener">{phase.link.label} ↗</a>{/if}
				</p>
			</div>
		{:else}
			<span class="asking">Asking the worker…</span>
		{/if}
	</div>

	{#if phase.kind === 'ready'}
		<p class="src" title={phase.from === 'nas' ? phase.path : phase.note}>
			{#if phase.from === 'nas'}
				<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" class="line"
					><path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.1l1.5 1.6h5.4c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" /></svg
				>
				<span class="path">{shortPath(phase.path)}</span>
			{:else}
				<span>Stored in flock</span>
			{/if}
			{#if phase.size > 0}<span class="size">· {formatBytes(phase.size)}</span>{/if}
		</p>
	{/if}
</div>

<style>
	.pwrap {
		width: var(--pw);
		max-width: 100%;
	}

	.player {
		position: relative;
		width: var(--pw);
		max-width: 100%;
		height: var(--ph);
		overflow: hidden;
		isolation: isolate;
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		background: #000;
		user-select: none;
		transition:
			width 0.2s,
			height 0.2s;
	}

	video,
	.poster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
	}

	.poster {
		z-index: 1;
		object-fit: cover;
		transition:
			opacity 0.2s,
			filter 0.2s;
	}

	.started .poster {
		opacity: 0;
		pointer-events: none;
	}

	.blocked .poster {
		filter: saturate(0.4) brightness(0.55);
	}

	.surface {
		position: absolute;
		inset: 0;
		z-index: 2;
		border: 0;
		padding: 0;
		background: none;
		cursor: pointer;
	}

	.surface:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--pink);
	}

	.started:not(.awake):not(.paused) .surface {
		cursor: none;
	}

	svg {
		fill: currentColor;
	}

	svg.line,
	svg .line {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	svg .line {
		stroke-width: 1.4;
	}

	/* ---- before it is started ---- */

	.bigplay {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 3;
		display: grid;
		place-items: center;
		width: 58px;
		height: 58px;
		margin: -29px 0 0 -29px;
		border: 1.5px solid rgba(255, 255, 255, 0.32);
		border-radius: 50%;
		background: rgba(10, 9, 18, 0.55);
		backdrop-filter: blur(6px);
		color: #fff;
		transition:
			background 0.15s,
			transform 0.15s,
			box-shadow 0.15s,
			border-color 0.15s;
	}

	.bigplay svg {
		margin-left: 3px;
	}

	.player:hover .bigplay,
	.bigplay:focus-visible {
		border-color: transparent;
		background: var(--accent-grad);
		box-shadow:
			0 0 0 1px rgba(255, 77, 158, 0.35),
			0 6px 24px rgba(255, 77, 158, 0.35);
		transform: scale(1.06);
	}

	.chip {
		position: absolute;
		right: 8px;
		bottom: 8px;
		z-index: 3;
		padding: 1px 7px;
		border-radius: 6px;
		background: rgba(10, 9, 18, 0.72);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}

	/* The volume and full screen, top right while hovered. */
	.corner {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.player:hover .corner,
	.corner:focus-within {
		opacity: 1;
	}

	.corner button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: #fff;
		transition: background 0.15s;
	}

	.corner .vol,
	.cornerfs {
		border-radius: 7px;
		background: rgba(10, 9, 18, 0.62);
	}

	.corner .vol:hover,
	.corner .vol:focus-within {
		padding-left: 8px;
	}

	.corner .vol button:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.corner .cornerfs:hover {
		background: var(--pink-hot);
	}

	/* ---- playing ---- */

	.bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 4;
		padding: 22px 8px 6px;
		background: linear-gradient(to top, rgba(10, 9, 18, 0.92), rgba(10, 9, 18, 0));
		opacity: 0;
		transform: translateY(6px);
		pointer-events: none;
		transition:
			opacity 0.2s,
			transform 0.2s;
	}

	.awake .bar,
	.paused .bar,
	.bar:focus-within {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}

	.scrub {
		position: relative;
		height: 14px;
		margin: 0 2px 2px;
		cursor: pointer;
		touch-action: none;
	}

	.scrub:focus-visible {
		outline: none;
	}

	.scrub .track,
	.scrub .buf,
	.scrub .fill {
		position: absolute;
		left: 0;
		top: 5px;
		height: 4px;
		border-radius: 2px;
		transition:
			height 0.12s,
			top 0.12s;
	}

	.track {
		right: 0;
		background: rgba(255, 255, 255, 0.18);
	}

	.buf {
		background: rgba(255, 255, 255, 0.28);
	}

	.fill {
		background: var(--accent-grad);
	}

	.knob {
		position: absolute;
		top: 2px;
		width: 10px;
		height: 10px;
		margin-left: -5px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(255, 77, 158, 0.5);
		transform: scale(0);
		transition: transform 0.12s;
	}

	.scrub:hover .track,
	.scrub:hover .buf,
	.scrub:hover .fill,
	.scrub.dragging .track,
	.scrub.dragging .buf,
	.scrub.dragging .fill,
	.scrub:focus-visible .track,
	.scrub:focus-visible .fill {
		top: 4px;
		height: 6px;
	}

	.scrub:hover .knob,
	.scrub.dragging .knob,
	.scrub:focus-visible .knob {
		transform: scale(1);
	}

	.btns {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.btns button {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: #fff;
	}

	.btns button:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.btns .fs:hover {
		background: var(--pink-hot);
	}

	.time {
		margin: 0 6px 0 4px;
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: rgba(255, 255, 255, 0.86);
	}

	.total {
		color: rgba(255, 255, 255, 0.5);
	}

	/* An upright player is too narrow for both times. */
	.narrow .player:not(.fullscreen) .total {
		display: none;
	}

	.grow {
		flex: 1;
	}

	/* ---- the volume: a slider beside the speaker while it is hovered ---- */

	.vol {
		display: flex;
		align-items: center;
	}

	.level {
		width: 0;
		height: 28px;
		margin: 0;
		padding: 0;
		opacity: 0;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		cursor: pointer;
		transition:
			width 0.15s,
			opacity 0.15s,
			margin 0.15s;
	}

	.vol:hover .level,
	.vol:focus-within .level {
		width: 64px;
		margin-right: 4px;
		opacity: 1;
	}

	/* An upright player has room only for a shorter one. */
	.narrow .player:not(.fullscreen) .vol:hover .level,
	.narrow .player:not(.fullscreen) .vol:focus-within .level {
		width: 46px;
	}

	.fullscreen .vol:hover .level,
	.fullscreen .vol:focus-within .level {
		width: 96px;
	}

	.level:focus-visible {
		outline: none;
	}

	.level::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			#a855f7,
			#ff4d9e var(--level),
			rgba(255, 255, 255, 0.22) var(--level)
		);
	}

	.level::-webkit-slider-thumb {
		width: 10px;
		height: 10px;
		margin-top: -3px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(255, 77, 158, 0.5);
		appearance: none;
		-webkit-appearance: none;
	}

	.level::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.22);
	}

	.level::-moz-range-progress {
		height: 4px;
		border-radius: 2px;
		background: var(--accent-grad);
	}

	.level::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border: 0;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(255, 77, 158, 0.5);
	}

	/* ---- full screen: the whole box, so the bar comes along ---- */

	.player.fullscreen {
		width: 100vw;
		max-width: none;
		height: 100vh;
		border: 0;
		border-radius: 0;
	}

	.fullscreen .bar {
		padding: 40px 22px 14px;
	}

	.fullscreen .btns button {
		width: 38px;
		height: 38px;
	}

	.fullscreen .btns svg {
		width: 20px;
		height: 20px;
	}

	.fullscreen .time {
		font-size: 14px;
	}

	.fstitle {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 4;
		padding: 18px 24px 40px;
		background: linear-gradient(to bottom, rgba(10, 9, 18, 0.85), rgba(10, 9, 18, 0));
		font-size: 16px;
		font-weight: 620;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
	}

	.fstitle small {
		display: block;
		margin-top: 2px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-dim);
	}

	.awake .fstitle,
	.paused .fstitle,
	.player:not(.started) .fstitle {
		opacity: 1;
	}

	/* ---- when it cannot play ---- */

	.why {
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 10px;
		z-index: 3;
		padding: 9px 11px;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: rgba(10, 9, 18, 0.86);
		backdrop-filter: blur(6px);
		font-size: 12px;
		line-height: 1.4;
	}

	.why strong {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 650;
	}

	.why strong i {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--danger);
	}

	.why p {
		margin: 3px 0 0;
		color: var(--text-dim);
		overflow-wrap: anywhere;
	}

	.why a {
		color: var(--pink-soft);
		white-space: nowrap;
	}

	.asking {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 10px;
		z-index: 3;
		text-align: center;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	/* ---- under it: where it plays from ---- */

	.src {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		margin: 7px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.src svg {
		flex: none;
	}

	.path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-dim);
	}

	.size {
		flex: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.player,
		.bar,
		.bigplay,
		.poster {
			transition: none;
		}
	}
</style>
