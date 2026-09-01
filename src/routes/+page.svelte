<script lang="ts">
	import Stepper from '$lib/components/Stepper.svelte';
	import StepDetails from '$lib/components/steps/StepDetails.svelte';
	import StepSchedule from '$lib/components/steps/StepSchedule.svelte';
	import StepConfirm from '$lib/components/steps/StepConfirm.svelte';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import { draft, type Step } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { buildPlan } from '$lib/plan';
	import { createJob } from '$lib/repo';
	import { formatBytes } from '$lib/format';
	import { PLATFORMS } from '$lib/platforms';

	settings.load();
	general.load();

	let plan = $derived(draft.step === 2 ? buildPlan() : []);

	// The confirm button deliberately takes two clicks: this is the point where
	// a multi-GB upload and four scheduled publishes become real.
	let armed = $state(false);
	let phase = $state<'idle' | 'uploading' | 'done' | 'error'>('idle');
	let progress = $state(0);
	let failure = $state('');

	// Any edit disarms the confirmation, so a stale second click cannot fire.
	$effect(() => {
		void draft.step;
		armed = false;
	});

	const HEADINGS = [
		{ title: 'New upload', sub: 'One title, one description, one file — adapted per platform.' },
		{ title: 'Schedule', sub: 'Pick a release day and time for each platform.' },
		{ title: 'Confirm', sub: 'Review exactly what will be published, and when.' }
	];

	function goto(step: Step) {
		draft.step = step;
		armed = false;
	}

	function next() {
		if (draft.step < 2) goto((draft.step + 1) as Step);
	}

	function back() {
		if (draft.step > 0) goto((draft.step - 1) as Step);
	}

	let canContinue = $derived(
		draft.step === 0
			? draft.canLeaveDetails
			: draft.step === 1
				? draft.scheduleComplete && draft.pastPlatforms.length === 0
				: true
	);

	async function confirm() {
		if (!armed) {
			armed = true;
			return;
		}
		if (!draft.file) return;

		phase = 'uploading';
		progress = 0;
		failure = '';

		try {
			await createJob(
				{
					title: draft.title,
					description: draft.description,
					file: draft.file,
					duration: draft.duration,
					destination: general.defaultDestination,
					targets: plan.map((row) => ({
						platform: row.platform,
						title: row.title,
						description: row.description,
						options: row.options,
						date: row.date,
						time: row.time
					}))
				},
				(fraction) => (progress = fraction)
			);
			phase = 'done';
		} catch (err) {
			failure = err instanceof Error ? err.message : String(err);
			phase = 'error';
		}
	}

	function startOver() {
		draft.reset();
		phase = 'idle';
		armed = false;
		progress = 0;
	}
</script>

<div class="page">
	{#if phase === 'done'}
		<section class="card result">
			<div class="tick">
				<svg viewBox="0 0 24 24" width="26" height="26" fill="none">
					<path
						d="M4 12.5 9.5 18 20 6.5"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</div>
			<h2>On the NAS</h2>
			<p>
				The video is stored and {plan.length}
				{plan.length === 1 ? 'release is' : 'releases are'} queued. You can close this machine down —
				publishing happens from the NAS at each scheduled time.
			</p>
			<ul class="queued">
				{#each plan as row (row.platform)}
					<li>
						<PlatformIcon platform={row.platform} size={16} />
						<span>{row.relative}</span>
					</li>
				{/each}
			</ul>
			<p class="caveat">
				Queued only — no platform API is connected yet, so nothing will actually be published.
			</p>
			<button class="btn btn-primary" onclick={startOver}>New upload</button>
		</section>
	{:else}
		<header class="head">
			<div class="titling">
				<h1>{HEADINGS[draft.step].title}</h1>
				<p>{HEADINGS[draft.step].sub}</p>
			</div>
			<div class="progress">
				<Stepper step={draft.step} onjump={(index) => goto(index as Step)} />
			</div>
		</header>

		<nav class="actions">
			{#if draft.step > 0}
				<button class="btn" onclick={back} disabled={phase === 'uploading'}>
					<svg viewBox="0 0 24 24" width="15" height="15" fill="none">
						<path
							d="M19 12H6m5 5-5-5 5-5"
							stroke="currentColor"
							stroke-width="1.9"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Back
				</button>
			{/if}

			<div class="spacer"></div>

			{#if phase === 'error'}
				<span class="failure">{failure}</span>
			{/if}

			{#if draft.step === 1 && draft.pastPlatforms.length > 0}
				<span class="blocked">
					{draft.pastPlatforms.map((id) => PLATFORMS[id].label).join(', ')}
					{draft.pastPlatforms.length === 1 ? 'is' : 'are'} scheduled in the past.
				</span>
			{/if}

			{#if draft.step < 2}
				<button class="btn btn-primary" onclick={next} disabled={!canContinue}>
					Continue
					<svg viewBox="0 0 24 24" width="15" height="15" fill="none">
						<path
							d="M5 12h13m-5-5 5 5-5 5"
							stroke="currentColor"
							stroke-width="1.9"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			{:else}
				<button
					class="btn btn-primary confirm"
					class:armed
					onclick={confirm}
					disabled={phase === 'uploading' || plan.length === 0}
				>
					{#if phase === 'uploading'}
						Uploading… {Math.round(progress * 100)}%
					{:else if armed}
						Click again to confirm
					{:else}
						Upload and schedule
					{/if}
				</button>
			{/if}
		</nav>

		{#if settings.error}
			<p class="banner error">Could not reach PocketBase — {settings.error}</p>
		{/if}

		{#if settings.loading}
			<p class="banner">Loading platform settings…</p>
		{:else if draft.step === 0}
			<StepDetails />
		{:else if draft.step === 1}
			<StepSchedule />
		{:else}
			<StepConfirm rows={plan} />
		{/if}


		{#if phase === 'uploading'}
			<div class="uploading card">
				<div class="bar"><span style="width: {progress * 100}%"></span></div>
				<p>
					Sending <strong>{draft.file?.name}</strong>
					{#if draft.file}({formatBytes(draft.file.size)}){/if} to the NAS — keep this tab open until
					it finishes.
				</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 30px;
		margin-bottom: 26px;
	}

	h1 {
		font-size: 23px;
	}

	.titling p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.progress {
		width: min(380px, 45vw);
		flex: none;
	}

	.banner {
		margin: 0 0 16px;
		padding: 11px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.error {
		border-color: rgba(248, 113, 113, 0.4);
		color: var(--danger);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 20px;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--border);
	}

	.blocked {
		font-size: 12px;
		color: var(--warn);
		text-align: right;
	}

	.spacer {
		flex: 1;
	}

	.failure {
		font-size: 12px;
		color: var(--danger);
		max-width: 460px;
	}

	.confirm.armed {
		background: var(--pink-hot);
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.uploading {
		margin-top: 16px;
		padding: 14px 16px;
	}

	.bar {
		height: 6px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--accent-grad);
		transition: width 0.2s ease;
	}

	.uploading p {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.result {
		max-width: 520px;
		margin: 40px auto;
		padding: 34px 30px;
		text-align: center;
	}

	.tick {
		width: 54px;
		height: 54px;
		margin: 0 auto 16px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent-grad);
		color: #fff;
	}

	.result h2 {
		font-size: 19px;
	}

	.result p {
		margin: 8px 0 0;
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.6;
	}

	.queued {
		list-style: none;
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 7px;
		margin: 20px 0 0;
		padding: 0;
	}

	.queued li {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 11px;
		border-radius: 999px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.caveat {
		font-size: 11.5px !important;
		color: var(--text-faint) !important;
		margin-top: 18px !important;
	}

	.result .btn {
		margin-top: 20px;
	}

	@media (max-width: 860px) {
		.head {
			flex-direction: column;
			align-items: stretch;
			gap: 18px;
		}
		.progress {
			width: 100%;
		}
	}
</style>
