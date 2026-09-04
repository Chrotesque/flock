<script lang="ts">
	import { formatBytes } from '$lib/format';

	// YouTube's own cap for a custom thumbnail. Refused here, while somebody is
	// looking, rather than at publish time when nobody is.
	const MAX_BYTES = 2 * 1024 * 1024;
	const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

	let { file = $bindable<File | null>(null) }: { file?: File | null } = $props();

	let dragging = $state(false);
	let input: HTMLInputElement;
	let previewUrl = $state('');
	let problem = $state('');

	$effect(() => {
		if (!file) {
			previewUrl = '';
			return;
		}
		const url = URL.createObjectURL(file);
		previewUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	function accept(list: FileList | null) {
		const next = list?.[0];
		if (!next) return;
		if (!TYPES.includes(next.type)) {
			problem = 'JPEG, PNG, GIF or WebP only.';
			return;
		}
		if (next.size > MAX_BYTES) {
			problem = `${formatBytes(next.size)} is over YouTube's 2 MB limit for thumbnails.`;
			return;
		}
		problem = '';
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
		accept="image/jpeg,image/png,image/gif,image/webp"
		hidden
		onchange={(e) => accept(e.currentTarget.files)}
	/>

	{#if file}
		<div class="chosen">
			<img class="preview" src={previewUrl} alt="" />
			<div class="meta">
				<p class="name" title={file.name}>{file.name}</p>
				<p class="sub">{formatBytes(file.size)}</p>
				<div class="actions">
					<button class="btn btn-ghost sm" onclick={() => input.click()}>Replace</button>
					<button class="btn btn-ghost sm danger" onclick={() => (file = null)}>Remove</button>
				</div>
			</div>
		</div>
	{:else}
		<div class="empty">
			<svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
				<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="1.7" />
				<path
					d="M3.5 15.5l4.6-4.4a1.5 1.5 0 0 1 2.1 0L15 15.8M13 13.8l1.9-1.8a1.5 1.5 0 0 1 2.1 0l3.5 3.4"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<circle cx="15.5" cy="9" r="1.3" fill="currentColor" />
			</svg>
			<p class="lead">Drop an image here, or click to browse</p>
			<p class="sub">Optional. 1280×720 works best; up to 2 MB. Without one, YouTube picks a frame.</p>
		</div>
	{/if}
</div>

{#if problem}
	<p class="problem">{problem}</p>
{/if}

<style>
	.picker {
		min-width: 0;
		border: 1.5px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background: var(--bg-elev);
		padding: 14px;
		transition:
			border-color 0.16s,
			background 0.16s;
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
		padding: 14px 10px;
		color: var(--text-faint);
		text-align: center;
	}

	.empty svg {
		color: var(--pink);
		margin-bottom: 4px;
	}

	.lead {
		margin: 0;
		font-size: 13px;
		font-weight: 560;
		color: var(--text);
	}

	.sub {
		margin: 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.chosen {
		display: grid;
		grid-template-columns: 120px minmax(0, 1fr);
		gap: 12px;
		align-items: center;
	}

	.preview {
		width: 120px;
		height: 68px;
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
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
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

	.problem {
		margin: 6px 2px 0;
		font-size: 12px;
		color: var(--danger);
	}
</style>
