<script lang="ts">
	import { formatBytes, formatDuration } from '$lib/format';

	// A browser cannot read the absolute path of a chosen file, so flock works
	// with the File handle itself and uploads the bytes to the NAS. The path is
	// shown only as the file name the OS reports.
	let {
		file = $bindable<File | null>(null),
		duration = $bindable(0)
	}: { file?: File | null; duration?: number } = $props();

	let dragging = $state(false);
	let input: HTMLInputElement;
	let previewUrl = $state('');

	$effect(() => {
		if (!file) {
			previewUrl = '';
			duration = 0;
			return;
		}
		const url = URL.createObjectURL(file);
		previewUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	function accept(list: FileList | null) {
		const next = list?.[0];
		if (!next) return;
		if (!next.type.startsWith('video/')) return;
		file = next;
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		accept(event.dataTransfer?.files ?? null);
	}
</script>

<div
	class="picker"
	class:dragging
	class:filled={Boolean(file)}
	role="button"
	tabindex="0"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	onclick={() => !file && input.click()}
	onkeydown={(e) => {
		if (!file && (e.key === 'Enter' || e.key === ' ')) input.click();
	}}
>
	<input
		bind:this={input}
		type="file"
		accept="video/*"
		hidden
		onchange={(e) => accept(e.currentTarget.files)}
	/>

	{#if file}
		<div class="chosen">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={previewUrl}
				muted
				preload="metadata"
				onloadedmetadata={(e) => (duration = e.currentTarget.duration)}
			></video>
			<div class="meta">
				<p class="name" title={file.name}>{file.name}</p>
				<p class="sub">
					{formatBytes(file.size)}
					{#if duration}<span class="dot">·</span>{formatDuration(duration)}{/if}
				</p>
				<div class="actions">
					<button class="btn btn-ghost sm" onclick={() => input.click()}>Replace</button>
					<button class="btn btn-ghost sm danger" onclick={() => (file = null)}>Remove</button>
				</div>
			</div>
		</div>
	{:else}
		<div class="empty">
			<svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
				<path
					d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<p class="lead">Drop a video here, or click to browse</p>
			<p class="sub">Stays on this machine until you confirm — then it goes to the NAS.</p>
		</div>
	{/if}
</div>

<style>
	.picker {
		border: 1.5px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background: var(--bg-elev);
		padding: 18px;
		transition: border-color 0.16s, background 0.16s;
		cursor: pointer;
	}

	.picker.filled {
		cursor: default;
		border-style: solid;
	}

	.picker.dragging {
		border-color: var(--pink);
		background: rgba(255, 77, 158, 0.06);
	}

	.picker:not(.filled):hover {
		border-color: var(--pink-soft);
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 4px;
		padding: 26px 10px;
		color: var(--text-faint);
		text-align: center;
	}

	.empty svg {
		color: var(--pink);
		margin-bottom: 6px;
	}

	.lead {
		margin: 0;
		font-size: 13.5px;
		font-weight: 560;
		color: var(--text);
	}

	.sub {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.chosen {
		display: flex;
		gap: 14px;
		align-items: center;
	}

	video {
		width: 132px;
		height: 76px;
		flex: none;
		object-fit: cover;
		border-radius: var(--radius);
		background: #000;
		border: 1px solid var(--border);
	}

	.meta {
		min-width: 0;
		flex: 1;
	}

	.name {
		margin: 0 0 3px;
		font-weight: 580;
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dot {
		margin: 0 6px;
		opacity: 0.5;
	}

	.actions {
		display: flex;
		gap: 4px;
		margin-top: 8px;
	}

	.sm {
		padding: 5px 10px;
		font-size: 12px;
	}

	.danger:hover {
		color: var(--danger);
	}
</style>
