<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';
	import OptionEditor from './OptionEditor.svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import AdaptationSummary from './AdaptationSummary.svelte';
	import CharCount from './CharCount.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { adapt } from '$lib/filters';
	import { settings } from '$lib/stores/settings.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { draft } from '$lib/stores/draft.svelte';
	import type { OptionValues, PlatformId } from '$lib/types';

	let {
		open = $bindable(false),
		platform
	}: { open?: boolean; platform: PlatformId | null } = $props();

	let def = $derived(platform ? PLATFORMS[platform] : null);

	// Saved defaults, with any per-video override for this draft layered on top.
	// Rebuilt only when the modal opens on a platform: reading the override map
	// as a dependency would re-seed the values the moment they were edited, so
	// the reads are untracked.
	let values = $state<OptionValues>({});

	$effect(() => {
		const id = platform;
		if (!open || !id) return;
		untrack(() => {
			values = { ...settings.defaultsFor(id), ...(draft.overrides[id] ?? {}) };
		});
	});

	let result = $derived.by(() => {
		if (!platform) return null;
		const text = draft.textFor(platform);
		return adapt(text.title, text.description, settings.filtersFor(platform));
	});

	let tab = $state<'options' | 'preview'>('options');

	function override() {
		if (!platform) return;
		draft.overrides[platform] = { ...values };
	}

	function resetOverrides() {
		if (!platform) return;
		delete draft.overrides[platform];
		draft.overrides = { ...draft.overrides };
	}

	let hasOverrides = $derived(
		platform ? Object.keys(draft.overrides[platform] ?? {}).length > 0 : false
	);
</script>

<Modal bind:open width="720px">
	{#snippet header()}
		{#if def && platform}
			<div class="head">
				<span class="badge"><PlatformIcon {platform} size={20} /></span>
				<div>
					<h2>{def.label}</h2>
					<p>{def.fieldNote}</p>
				</div>

				{#if platform === 'youtube' && general.value.complianceBranding}
					<!--
						The guidelines require the logo to be a link back to YouTube, and to
						sit next to where the API implementation appears. This panel is that
						place: it is the YouTube-specific options, and unlike the compose
						rail it is not already inside a button, so a link nests legally here.
						It also stays clear of flock's own name, which brand features may
						never be shown alongside.
					-->
					<a
						class="ytmark"
						href="https://www.youtube.com"
						target="_blank"
						rel="noreferrer noopener"
						aria-label="YouTube"
					>
						<!-- 88 wide, not 72: the wordmark measures out to x≈84, and a clipped
						     logo is precisely what "must not be altered or obscured" rules out. -->
						<svg viewBox="0 0 88 24" width="88" height="24" fill="none" aria-hidden="true">
							<path
								d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5C0 8.4 0 12 0 12s0 3.6.5 5.5a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.5.5-5.5s0-3.6-.5-5.5Z"
								fill="#FF0000"
							/>
							<path d="M9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" fill="#FFFFFF" />
							<text
								x="27"
								y="17"
								fill="#FFFFFF"
								font-family="Roboto, Arial, Helvetica, sans-serif"
								font-size="14.5"
								font-weight="700"
								letter-spacing="-0.6">YouTube</text
							>
						</svg>
					</a>
				{/if}
			</div>
		{/if}
	{/snippet}

	{#if def && platform && result}
		<div class="tabs">
			<button class:active={tab === 'options'} onclick={() => (tab = 'options')}>
				Publish options
			</button>
			<button class:active={tab === 'preview'} onclick={() => (tab = 'preview')}>
				Adapted text
				{#if result.totalHits > 0}<span class="dot">{result.totalHits}</span>{/if}
			</button>
		</div>

		{#if tab === 'options'}
			{#if hasOverrides}
				<div class="notice">
					<span>Changed for this video only — your saved defaults are untouched.</span>
					<button class="btn btn-ghost sm" onclick={resetOverrides}>Reset to defaults</button>
				</div>
			{/if}

			<OptionEditor fields={def.fields} bind:values onchange={override} />

			<!--
				Only three of the four are placeholders now. Saying otherwise in the
				YouTube panel is both wrong and actively misleading in a screenshot —
				its options map to real videos.insert fields.
			-->
			{#if platform === 'youtube'}
				<p class="footnote">
					These options map to real YouTube Data API fields and are applied when the video is
					uploaded.
				</p>
			{:else}
				<p class="footnote">
					These options are placeholders. They exist so the flow can be judged before the real
					{def.label} API is wired up.
				</p>
			{/if}
		{:else}
			<section class="preview">
				<div class="block">
					<div class="blockhead">
						<span class="label">Title on {def.label}</span>
						<CharCount value={result.title.output} limit={def.titleLimit} />
					</div>
					<p class="out" class:empty={!result.title.output}>
						{result.title.output || 'Nothing entered yet'}
					</p>
				</div>

				<div class="block">
					<div class="blockhead">
						<span class="label">Description on {def.label}</span>
						<CharCount value={result.description.output} limit={def.descriptionLimit} />
					</div>
					<p class="out pre" class:empty={!result.description.output}>
						{result.description.output || 'Nothing entered yet'}
					</p>
				</div>

				<div class="block">
					<span class="label">Adaptations applied</span>
					<AdaptationSummary hits={[...result.title.hits, ...result.description.hits]} />
				</div>
			</section>
		{/if}
	{/if}

	{#snippet footer()}
		<button class="btn btn-primary" onclick={() => (open = false)}>Done</button>
	{/snippet}
</Modal>

<style>
	.ytmark {
		margin-left: auto;
		flex: none;
		display: block;
		align-self: center;
		/* Solid backing: the guidelines require the mark stay fully visible with
		   enough contrast, and the modal header is a gradient. */
		background: #0a0912;
		padding: 5px 8px;
		border-radius: 6px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.badge {
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 11px;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	h2 {
		font-size: 17px;
	}

	.head p {
		margin: 2px 0 0;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: 20px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 10px;
	}

	.tabs button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 7px 12px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text-dim);
		transition: background 0.15s, color 0.15s;
	}

	.tabs button:hover {
		color: var(--text);
	}

	.tabs button.active {
		background: var(--surface-3);
		color: var(--text);
	}

	.dot {
		min-width: 17px;
		padding: 0 5px;
		height: 17px;
		border-radius: 999px;
		background: var(--accent-grad);
		color: #fff;
		font-size: 10.5px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}

	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
		padding: 9px 10px 9px 13px;
		border-radius: var(--radius);
		background: var(--accent-grad-soft);
		border: 1px solid rgba(255, 77, 158, 0.25);
		font-size: 12.5px;
		color: var(--pink-soft);
	}

	.sm {
		padding: 4px 9px;
		font-size: 11.5px;
	}

	.footnote {
		margin: 22px 0 0;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.preview {
		display: grid;
		gap: 20px;
	}

	.blockhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.blockhead .label {
		margin-bottom: 8px;
	}

	.out {
		margin: 0;
		padding: 11px 13px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 13px;
		line-height: 1.6;
	}

	.out.pre {
		white-space: pre-wrap;
		max-height: 230px;
		overflow-y: auto;
	}

	.out.empty {
		color: var(--text-faint);
		font-style: italic;
	}
</style>
