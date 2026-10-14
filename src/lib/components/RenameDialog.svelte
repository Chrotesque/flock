<script lang="ts">
	import { tick } from 'svelte';
	import Modal from './Modal.svelte';
	import Checkbox from './Checkbox.svelte';
	import CharCount from './CharCount.svelte';
	import PlatformIcon from './PlatformIcon.svelte';
	import { portal } from '$lib/portal';
	import { PLATFORMS } from '$lib/platforms';
	import { titleRequests } from '$lib/stores/titlerequests.svelte';
	import { YOUTUBE_TITLE_MAX, cleanName, nameProblem, type RenameChoice } from '$lib/retitle';
	import type { PlatformId } from '$lib/types';

	/**
	 * Renames one video from the Dashboard's Edit mode (retitle.ts): a new
	 * name, and the platforms it goes to — every one it can, or some only.
	 * Once asked, each platform's line follows the worker's answer live.
	 */
	let {
		name: current,
		choices,
		job,
		onclose
	}: {
		/** The name the Dashboard shows for it. */
		name: string;
		choices: RenameChoice[];
		/** The flock upload it came from, '' when none. */
		job: string;
		onclose: () => void;
	} = $props();

	let open = $state(true);
	$effect(() => {
		if (!open) onclose();
	});

	// Captured once: the dialog renames what was clicked, whatever the list does meanwhile.
	// svelte-ignore state_referenced_locally
	let name = $state(current);
	// svelte-ignore state_referenced_locally
	const offered = choices.filter((c) => !c.refusal);
	let ticked = $state<PlatformId[]>(offered.map((c) => c.platform));
	const all = $derived(offered.length > 0 && offered.every((c) => ticked.includes(c.platform)));

	function setAll(on: boolean) {
		ticked = on ? offered.map((c) => c.platform) : [];
	}

	function setOne(platform: PlatformId, on: boolean) {
		ticked = on ? [...new Set([...ticked, platform])] : ticked.filter((p) => p !== platform);
	}

	const problem = $derived(nameProblem(name, ticked));
	const unchanged = $derived(
		ticked.length > 0 &&
			ticked.every((p) => cleanName(choices.find((c) => c.platform === p)?.current ?? '') === cleanName(name))
	);

	/* ---- once asked ---- */

	let asked = $state<Partial<Record<PlatformId, string>>>({});
	let sending = $state(false);
	let error = $state('');
	const sent = $derived(Object.keys(asked).length > 0);
	const answers = $derived(
		Object.fromEntries(
			Object.entries(asked).map(([platform, id]) => [platform, titleRequests.rows.find((r) => r.id === id)])
		) as Partial<Record<PlatformId, (typeof titleRequests.rows)[number]>>
	);
	const waiting = $derived(Object.values(answers).some((r) => !r || r.status === 'pending'));

	async function rename() {
		if (problem || sending) return;
		sending = true;
		error = '';
		try {
			const asks = choices
				.filter((c) => ticked.includes(c.platform))
				.map((c) => ({ platform: c.platform, videoId: c.videoId, account: c.account, title: name, before: c.current, job }));
			const made = await titleRequests.ask(asks);
			asked = Object.fromEntries(made.map((row) => [row.platform, row.id]));
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			sending = false;
		}
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && !sent) {
			event.preventDefault();
			void rename();
		}
	}

	let input = $state<HTMLInputElement | null>(null);
	$effect(() => {
		void tick().then(() => input?.select());
	});
</script>

<div use:portal>
	<Modal bind:open title="Rename video" subtitle="The worker renames it on each platform ticked, within seconds." width="560px">
		<label class="label" for="rename-name">New name</label>
		<div class="field">
			<input
				id="rename-name"
				class="input"
				type="text"
				maxlength="255"
				autocomplete="off"
				bind:this={input}
				bind:value={name}
				disabled={sent}
				onkeydown={onKey}
			/>
			{#if ticked.includes('youtube')}
				<span class="count"><CharCount value={cleanName(name)} limit={YOUTUBE_TITLE_MAX} /></span>
			{/if}
		</div>

		<div class="platforms" role="group" aria-label="Platforms to rename it on">
			<div class="opt all">
				<Checkbox checked={all} label="All platforms" disabled={offered.length === 0 || sent} onchange={setAll} />
			</div>
			{#each choices as c (c.platform)}
				{@const answer = answers[c.platform]}
				<div class="opt" class:off={Boolean(c.refusal)}>
					<Checkbox
						checked={ticked.includes(c.platform)}
						disabled={Boolean(c.refusal) || sent}
						ariaLabel="Rename on {PLATFORMS[c.platform].label}"
						onchange={(on) => setOne(c.platform, on)}
					/>
					<span class="pf"><PlatformIcon platform={c.platform} size={16} />{PLATFORMS[c.platform].label}</span>
					<span class="state">
						{#if sent && c.platform in asked}
							{#if !answer || answer.status === 'pending'}
								<span class="wait">Waiting for the worker…</span>
							{:else if answer.status === 'done'}
								<span class="ok">Renamed</span>
							{:else}
								<span class="bad">{answer.error || 'Not renamed.'}</span>
							{/if}
						{:else if sent}
							<span class="faint">Left as it is</span>
						{:else if c.refusal}
							<span class="faint">{c.refusal}</span>
						{:else if c.current}
							<span class="now" title={c.current}>now “{c.current}”</span>
						{/if}
					</span>
				</div>
			{/each}
		</div>

		{#if offered.some((c) => c.platform === 'facebook')}
			<p class="hint">A Facebook reel shows only its caption: the caption's first line is renamed, the rest stays.</p>
		{/if}
		{#if ticked.includes('youtube') && !sent}
			<p class="hint">YouTube spends 51 units of today's quota on each rename.</p>
		{/if}
		{#if error}
			<p class="bad msg">{error}</p>
		{:else if !sent && problem && cleanName(name)}
			<p class="bad msg">{problem}</p>
		{/if}

		{#snippet footer()}
			{#if sent}
				<span class="foot">{waiting ? 'You can close this; the worker carries on.' : 'Done.'}</span>
				<button class="btn" onclick={() => (open = false)}>Close</button>
			{:else}
				<button class="btn btn-ghost" onclick={() => (open = false)}>Cancel</button>
				<button class="btn btn-primary" onclick={rename} disabled={Boolean(problem) || unchanged || sending}>
					{sending ? 'Asking…' : ticked.length > 1 ? `Rename on ${ticked.length} platforms` : 'Rename'}
				</button>
			{/if}
		{/snippet}
	</Modal>
</div>

<style>
	.field {
		position: relative;
	}

	.field .input {
		padding-right: 84px;
	}

	.count {
		position: absolute;
		right: 13px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}

	.platforms {
		display: grid;
		gap: 2px;
		margin-top: 18px;
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-elev);
	}

	.opt {
		display: grid;
		grid-template-columns: auto 118px minmax(0, 1fr);
		align-items: center;
		gap: 10px;
		min-height: 36px;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
	}

	.opt.all {
		display: flex;
		padding-bottom: 8px;
		margin-bottom: 4px;
		border-bottom: 1px solid var(--border);
		border-radius: 0;
		font-weight: 600;
	}

	.opt.off .pf {
		opacity: 0.5;
	}

	.pf {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 560;
	}

	.state {
		min-width: 0;
		font-size: 12px;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.state .bad {
		white-space: normal;
	}

	.now {
		color: var(--text-dim);
	}

	.faint {
		color: var(--text-faint);
		white-space: normal;
	}

	.wait {
		color: var(--pink-soft);
	}

	.ok {
		color: var(--ok);
		font-weight: 600;
	}

	.bad {
		color: var(--danger);
	}

	.hint {
		margin: 10px 2px 0;
		font-size: 12px;
		color: var(--text-faint);
	}

	.msg {
		margin: 12px 2px 0;
		font-size: 12.5px;
	}

	.foot {
		margin-right: auto;
		align-self: center;
		font-size: 12px;
		color: var(--text-faint);
	}
</style>
