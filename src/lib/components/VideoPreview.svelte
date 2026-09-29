<script lang="ts">
	import Modal from './Modal.svelte';
	import { loadPreviewServer } from '$lib/repo';
	import {
		previewCheckUrl,
		previewVideoUrl,
		previewProblem,
		playbackProblem,
		type PreviewSource
	} from '$lib/preview';
	import { formatBytes } from '$lib/format';
	import type { WatchFile } from '$lib/types';

	/**
	 * Plays one listed file in a dialog. The bytes come from the worker's own
	 * loopback server (see preview.ts), so opening asks it about the file first
	 * and only then points the player there — a player that cannot load its
	 * source never says why.
	 */
	let {
		open = $bindable(false),
		file,
		source
	}: { open?: boolean; file: WatchFile | null; source: PreviewSource } = $props();

	// The player's height cap, shared by the video and the width worked out
	// from its shape, so the two cannot disagree.
	const PLAYER_HEIGHT = 'min(68vh, 700px)';
	// Until the video says what shape it is.
	const WIDE = '720px';

	type Phase =
		| { kind: 'asking' }
		| { kind: 'playing'; src: string }
		| { kind: 'failed'; message: string; detail?: string };

	let phase = $state<Phase>({ kind: 'asking' });
	let width = $state(WIDE);

	// Reads only the props, never what it writes; closing undoes the lot, so
	// the next file opens on a blank dialog rather than the last one's player.
	$effect(() => {
		if (!open || !file) return;
		const controller = new AbortController();
		void connect(file, source, controller.signal);
		return () => {
			controller.abort();
			phase = { kind: 'asking' };
			width = WIDE;
		};
	});

	async function connect(file: WatchFile, source: PreviewSource, signal: AbortSignal) {
		const server = await loadPreviewServer();
		if (signal.aborted) return;
		if (!server) {
			phase = {
				kind: 'failed',
				message: 'The worker has not started its player yet.',
				detail:
					'These files are streamed by the worker on the PC they belong to. Start it with pnpm worker, then try again.'
			};
			return;
		}

		let answer: { ok?: boolean; error?: string };
		try {
			const res = await fetch(previewCheckUrl(server.url, source, file.path), {
				cache: 'no-store',
				// Generous, because a browser asking whether this page may reach
				// the PC's own services holds the request until it is answered.
				signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])
			});
			answer = await res.json();
		} catch {
			if (signal.aborted) return;
			phase = {
				kind: 'failed',
				message: `The worker is not answering at ${server.url}.`,
				detail:
					'It streams these files, so it has to be running on the PC they belong to. If it is, the browser may be stopping this page from reaching it — check the permissions for this site.'
			};
			return;
		}
		if (signal.aborted) return;
		phase = answer.ok
			? { kind: 'playing', src: previewVideoUrl(server.url, source, file.path) }
			: { kind: 'failed', message: previewProblem(answer.error) };
	}

	/** Narrows the dialog to the video's own shape, so a portrait clip is not boxed in black. */
	function fit(event: Event) {
		const video = event.currentTarget as HTMLVideoElement;
		if (!video.videoWidth || !video.videoHeight) return;
		const ratio = (video.videoWidth / video.videoHeight).toFixed(4);
		width = `min(1100px, calc(${PLAYER_HEIGHT} * ${ratio} + 44px))`;
	}

	function broke(event: Event) {
		const video = event.currentTarget as HTMLVideoElement;
		phase = { kind: 'failed', message: playbackProblem(video.error?.code) };
	}
</script>

<Modal bind:open title={file?.name ?? 'Video'} {width}>
	{#snippet header()}
		<div class="head">
			<h2>{file?.name}</h2>
			{#if file}
				<p>{formatBytes(file.size)} · {source === 'local' ? 'on this PC' : 'on the NAS'}</p>
			{/if}
		</div>
	{/snippet}

	{#if phase.kind === 'asking'}
		<p class="note">Asking the worker for the file…</p>
	{:else if phase.kind === 'failed'}
		<div class="problem">
			<p>{phase.message}</p>
			{#if phase.detail}<p class="detail">{phase.detail}</p>{/if}
		</div>
	{:else}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			src={phase.src}
			style:max-height={PLAYER_HEIGHT}
			controls
			autoplay
			playsinline
			onloadedmetadata={fit}
			onerror={broke}
		></video>
	{/if}
</Modal>

<style>
	.head {
		min-width: 0;
	}

	h2 {
		font-size: 15px;
		/* File names have no spaces to break at. */
		overflow-wrap: anywhere;
	}

	.head p {
		margin: 3px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	video {
		display: block;
		width: 100%;
		border-radius: var(--radius-sm);
		background: #000;
	}

	.note {
		margin: 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.problem {
		padding: 11px 13px;
		border-radius: var(--radius-sm);
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		color: var(--warn);
		font-size: 13px;
	}

	.problem p {
		margin: 0;
	}

	.problem .detail {
		margin-top: 6px;
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
