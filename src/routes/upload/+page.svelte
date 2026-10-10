<script lang="ts">
	import { untrack } from 'svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import StepUpload from '$lib/components/steps/StepUpload.svelte';
	import StepDetails from '$lib/components/steps/StepDetails.svelte';
	import StepSchedule from '$lib/components/steps/StepSchedule.svelte';
	import StepConfirm from '$lib/components/steps/StepConfirm.svelte';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import { draft, type Step, type VideoSlot } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { buildPlan } from '$lib/plan';
	import { base } from '$app/paths';
	import { createJob, rememberTags, rememberUsedSources } from '$lib/repo';
	import { formatBytes } from '$lib/format';
	import { imageFits } from '$lib/coverimage';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import { PLATFORMS } from '$lib/platforms';

	settings.load();
	general.load();

	// The draft drops its per-platform choices when the brand changes — here,
	// or in Settings while the draft waited. Read through untrack, so only the
	// brand is a dependency.
	$effect(() => {
		const brand = brands.currentId;
		untrack(() => draft.followBrand(brand));
	});

	let plan = $derived(draft.step === 3 ? buildPlan() : []);

	// The confirm button deliberately takes two clicks, the second within two
	// seconds of the first: this is the point where a multi-GB upload and four
	// scheduled publishes become real.
	let armed = $state(false);
	let armTimer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		if (armTimer) clearTimeout(armTimer);
		armTimer = null;
		armed = false;
	}
	let phase = $state<'idle' | 'uploading' | 'done' | 'error'>('idle');
	let progress = $state(0);
	let failure = $state('');

	// Any edit disarms the confirmation, so a stale second click cannot fire.
	$effect(() => {
		void draft.step;
		disarm();
	});

	const HEADINGS = [
		{ title: 'New upload', sub: 'Pick the video — one for every platform, or one each.' },
		{ title: 'Details', sub: 'Compose each platform in turn.' },
		{ title: 'Schedule', sub: 'Pick a release day and time for each platform.' },
		{ title: 'Review', sub: 'Review exactly what will be published, and when.' }
	];

	/* ---- the platform switch, centred in the header on the details step ---- */

	let pills = $derived(
		draft.activePlatforms.map((platform) => ({
			platform,
			complete: draft.isComplete(platform)
		}))
	);
	let composing = $derived(
		draft.composing && draft.activePlatforms.includes(draft.composing) ? draft.composing : null
	);

	/** Platforms ticked since the upload step whose video slot is still empty. */
	let missingVideo = $derived(
		draft.slots.filter((entry) => !draft.slotHasVideo(entry.slot)).flatMap((entry) => entry.platforms)
	);

	function goto(step: Step) {
		draft.step = step;
		disarm();
	}

	function next() {
		if (draft.step < 3) goto((draft.step + 1) as Step);
	}

	function back() {
		if (draft.step > 0) goto((draft.step - 1) as Step);
	}

	let canContinue = $derived(
		draft.step === 0
			? draft.canLeaveUpload
			: draft.step === 1
				? draft.canLeaveDetails && draft.hasVideo
				: draft.step === 2
					? draft.scheduleComplete && draft.pastPlatforms.length === 0
					: true
	);

	/**
	 * Slots already written by an earlier press that failed part-way. Confirming
	 * again sends only the rest, so a failure on the second video never queues
	 * the first one twice. Cleared by starting over.
	 */
	let queued = $state<VideoSlot[]>([]);
	/** The video being sent right now, for the progress line. */
	let sending = $state<{ name: string; size: number; transfer: boolean; local: boolean } | null>(
		null
	);

	async function confirm() {
		if (!armed) {
			armed = true;
			armTimer = setTimeout(() => (armed = false), 2000);
			return;
		}
		disarm();
		if (!draft.hasVideo) return;

		phase = 'uploading';
		progress = 0;
		failure = '';

		// One job per distinct video, each carrying the targets it serves. The
		// worker publishes a target from its own job's file, so it needs no idea
		// that the platforms were ever split.
		const groups = draft.slots
			.map((entry) => ({
				...entry,
				video: draft.videos[entry.slot],
				rows: plan.filter((row) => entry.platforms.includes(row.platform))
			}))
			.filter((group) => group.rows.length > 0 && !queued.includes(group.slot));
		// Progress is by bytes actually transferred; a watch-folder pick sends none.
		const total = groups.reduce((sum, g) => sum + (g.video.file?.size ?? 0), 0);
		let sent = 0;

		try {
			for (const group of groups) {
				const { file, nasFile, duration } = group.video;
				const size = file?.size ?? 0;
				const label = draft.labelFor(group.platforms);
				sending = {
					name: file?.name ?? nasFile?.name ?? '',
					size: file?.size ?? nasFile?.size ?? 0,
					transfer: Boolean(file),
					local: Boolean(nasFile?.local)
				};
				await createJob(
					{
						title: label.title,
						description: label.description,
						file,
						source: nasFile,
						// One image, sent to each platform it fits; the picker has
						// already said which it does not.
						thumbnail:
							group.platforms.includes('youtube') && imageFits(draft.thumbnail, 'youtube')
								? draft.thumbnail
								: null,
						cover:
							group.platforms.includes('instagram') && imageFits(draft.thumbnail, 'instagram')
								? draft.thumbnail
								: null,
						duration,
						destination: general.defaultDestination,
						brand: brands.current ?? null,
						targets: group.rows.map((row) => ({
							platform: row.platform,
							// The brand's account, so the worker posts through exactly it.
							account: accounts.for(row.platform)?.account_id ?? '',
							title: row.title,
							description: row.description,
							options: row.options,
							date: row.date,
							time: row.time
						}))
					},
					(fraction) => (progress = total > 0 ? (sent + fraction * size) / total : fraction)
				);
				sent += size;
				queued = [...queued, group.slot];
				// So the file lists stop offering it; see loadUsedSources.
				rememberUsedSources([
					file
						? { name: file.name, size: file.size }
						: { path: nasFile!.path, name: nasFile!.name, size: nasFile!.size }
				]);
			}
			sending = null;
			// Remembered from the plan rather than the draft, so what is stored is
			// what actually went out — overrides and saved defaults included.
			rememberTags(
				brands.currentId,
				Object.fromEntries(
					plan
						.map((row) => {
							const boxes: Record<string, string[]> = {};
							for (const key of PLATFORMS[row.platform].tagBudget?.keys ?? []) {
								const list = row.options[key];
								if (Array.isArray(list) && list.length > 0) boxes[key] = list as string[];
							}
							return [row.platform, boxes] as const;
						})
						.filter(([, boxes]) => Object.keys(boxes).length > 0)
				)
			);
			phase = 'done';
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			failure =
				queued.length > 0
					? `${message} — ${queued.length} video${queued.length === 1 ? ' is' : 's are'} already queued; confirming again sends only the rest.`
					: message;
			sending = null;
			phase = 'error';
		}
	}

	function startOver() {
		draft.reset();
		queued = [];
		phase = 'idle';
		disarm();
		progress = 0;
	}
</script>

<div class="page">
<DeviceGate what="Uploading">
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
				{#if brands.multiple && brands.current}
					<p class="forbrand">For {brands.current.name}</p>
				{/if}
				<p>
					{queued.length === 1 ? 'The video is' : `${queued.length} videos are`} stored and {plan.length}
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
				{#if plan.some((row) => row.platform === 'tiktok')}
					<!-- TikTok's guidelines ask for this notice after every post. -->
					<p class="caveat">
						After the worker posts to TikTok, it may take a few minutes for the video to be
						processed and become visible on the profile.
					</p>
				{/if}
				{#if plan.some((row) => row.platform === 'facebook')}
					<p class="caveat">Facebook is not connected yet, so that release stays queued.</p>
				{/if}
				<button class="btn btn-primary" onclick={startOver}>New upload</button>
			</section>
		{:else}
			<header class="head">
				<div class="titling">
					<h1>{HEADINGS[draft.step].title}</h1>
					<p>{HEADINGS[draft.step].sub}</p>
					<!--
						Which brand this upload is for, on every step so it is never in
						doubt. Switching keeps the video and the text and drops the
						per-platform choices (see draft.followBrand). Hidden with one brand.
					-->
					{#if brands.multiple}
						<div class="brands" role="radiogroup" aria-label="Brand">
							{#each brands.ordered as brand (brand.id)}
								<button
									class="brandchip"
									class:on={brand.id === brands.currentId}
									role="radio"
									aria-checked={brand.id === brands.currentId}
									disabled={phase === 'uploading'}
									onclick={() => brands.select(brand.id)}
								>
									{brand.name}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!--
					Which platform the details step is composing: icons only, centred in
					the bar. A check marks one that is ready, a hollow dot one that is not.
				-->
				<div class="switch">
					{#if draft.step === 1 && pills.length > 0}
						<div class="pills" role="tablist" aria-label="Platform being composed">
							{#each pills as pill (pill.platform)}
								<button
									class="pilltab"
									class:on={composing === pill.platform}
									role="tab"
									aria-selected={composing === pill.platform}
									aria-label={PLATFORMS[pill.platform].label}
									title={PLATFORMS[pill.platform].label}
									onclick={() => (draft.composing = pill.platform)}
								>
									<PlatformIcon platform={pill.platform} size={20} />
									{#if pill.complete}
										<svg class="mark" viewBox="0 0 24 24" width="11" height="11" fill="none">
											<path
												d="M4 12.5 9.5 18 20 6.5"
												stroke="currentColor"
												stroke-width="3.2"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
									{:else}
										<span class="dot" aria-hidden="true"></span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!--
					Back and forward flank the stepper on its own row, so moving through
					the wizard is one cluster rather than a header and a separate bar.
					On the confirm step the forward button is the tick that starts the
					upload: it arms on the first press and fires on a second within two
					seconds, showing "!!!" in between so the state is unmistakable.
				-->
				<nav class="progress">
					<button
						class="btn nav"
						class:ghost={draft.step === 0}
						onclick={back}
						disabled={draft.step === 0 || phase === 'uploading'}
						aria-label="Back"
						title="Back"
					>
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none">
							<path
								d="M19 12H6m5 5-5-5 5-5"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<div class="steps">
						<Stepper step={draft.step} onjump={(index) => goto(index as Step)} />
					</div>

					{#if draft.step < 3}
						<button
							class="btn btn-primary nav"
							onclick={next}
							disabled={!canContinue}
							aria-label="Continue"
							title="Continue"
						>
							<svg viewBox="0 0 24 24" width="17" height="17" fill="none">
								<path
									d="M5 12h13m-5-5 5 5-5 5"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					{:else}
						<button
							class="btn btn-primary nav confirm"
							class:armed
							onclick={confirm}
							disabled={phase === 'uploading' || plan.length === 0}
							aria-label={armed ? 'Click again within two seconds to upload' : 'Upload and schedule'}
							title={armed ? 'Click again within two seconds to upload' : 'Upload and schedule'}
						>
							{#if phase === 'uploading'}
								<span class="pct">{Math.round(progress * 100)}%</span>
							{:else if armed}
								<span class="bang">!!!</span>
							{:else}
								<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
									<path
										d="M4 12.5 9.5 18 20 6.5"
										stroke="currentColor"
										stroke-width="2.2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							{/if}
						</button>
					{/if}
				</nav>
			</header>

			{#if phase === 'error' || (draft.step === 2 && draft.pastPlatforms.length > 0) || (draft.step === 1 && missingVideo.length > 0)}
				<div class="notes">
					{#if phase === 'error'}
						<span class="failure">{failure}</span>
					{/if}
					{#if draft.step === 1 && missingVideo.length > 0}
						<span class="blocked">
							{missingVideo.map((id) => PLATFORMS[id].label).join(', ')}
							{missingVideo.length === 1 ? 'has' : 'have'} no video yet —
							<button class="relink" onclick={() => goto(0)}>pick one</button>.
						</span>
					{/if}
					{#if draft.step === 2 && draft.pastPlatforms.length > 0}
						<span class="blocked">
							{draft.pastPlatforms.map((id) => PLATFORMS[id].label).join(', ')}
							{draft.pastPlatforms.length === 1 ? 'is' : 'are'} scheduled in the past.
						</span>
					{/if}
				</div>
			{/if}

			{#if settings.error}
				<p class="banner error">Could not reach PocketBase — {settings.error}</p>
			{/if}

			{#if brands.multiple && settings.withoutAccount.length > 0 && phase !== 'uploading'}
				<!-- Said, not hidden: a platform that silently vanished would look like a bug. -->
				<p class="banner">
					{settings.withoutAccount.map((id) => PLATFORMS[id].label).join(', ')}
					{settings.withoutAccount.length === 1 ? 'is' : 'are'} not offered for {brands.current?.name}:
					no account chosen for this brand.
					<a href="{base}/settings?section=brands">Choose one in Settings → Brands</a>.
				</p>
			{/if}

			{#if settings.loading}
				<p class="banner">Loading platform settings…</p>
			{:else if draft.step === 0}
				<StepUpload />
			{:else if draft.step === 1}
				<StepDetails />
			{:else if draft.step === 2}
				<StepSchedule />
			{:else}
				<StepConfirm rows={plan} />
			{/if}


			{#if phase === 'uploading'}
				<div class="uploading card">
					<div class="bar"><span style="width: {progress * 100}%"></span></div>
					{#if sending?.transfer}
						<p>
							Sending <strong>{sending.name}</strong>
							({formatBytes(sending.size)}) to the NAS — keep this tab open until it finishes.
						</p>
					{:else if sending?.local}
						<p>
							Queueing <strong>{sending.name}</strong>
							({formatBytes(sending.size)}) — the worker copies it from the local folder to the NAS.
						</p>
					{:else if sending}
						<!-- A file picked off the NAS is already there; only the job rows are
						     being written, so there is nothing to keep the tab open for. -->
						<p>
							Queueing <strong>{sending.name}</strong>
							({formatBytes(sending.size)}) — already on the NAS, so there is nothing to
							transfer.
						</p>
					{/if}
				</div>
			{/if}
		{/if}
</DeviceGate>
</div>

<style>
	/* Full width: the details step lays three columns across whatever the
	   window gives, and the layout's own 40px keeps it off the edges. */
	.page {
		max-width: none;
		margin: 0;
	}

	/* Three tracks with equal outer ones, so the platform switch sits at the
	   true centre of the bar whatever the heading and stepper measure. */
	.head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: end;
		gap: 30px;
		margin-bottom: 22px;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--border);
	}

	h1 {
		font-size: 23px;
	}

	.titling p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
	}

	.brandchip {
		padding: 5px 13px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		font-size: 12px;
		font-weight: 560;
		color: var(--text-dim);
		transition: border-color 0.14s, background 0.14s, color 0.14s;
	}

	.brandchip:hover:not(:disabled) {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.brandchip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	/* The arrows sit either side of the stepper with a deliberate gap, so they
	   read as "leave this step" rather than as part of the step labels. */
	.progress {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 22px;
	}

	.switch {
		align-self: center;
	}

	.pills {
		display: flex;
		gap: 8px;
	}

	.pilltab {
		position: relative;
		width: 44px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		transition: background 0.14s, border-color 0.14s;
	}

	.pilltab:hover {
		border-color: var(--pink-soft);
	}

	.pilltab.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
	}

	/* Ready or not, as a badge on the pill's corner. */
	.mark,
	.dot {
		position: absolute;
		top: -3px;
		right: -3px;
	}

	.mark {
		padding: 2px;
		box-sizing: content-box;
		border-radius: 999px;
		background: var(--surface);
		color: var(--ok);
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: 1.5px solid var(--text-faint);
		background: var(--surface);
	}

	.relink {
		color: inherit;
		font-size: inherit;
		text-decoration: underline;
	}

	.steps {
		width: min(460px, 40vw);
	}

	/* Square, so an arrow-only button does not read as a truncated worded one. */
	.nav {
		flex: none;
		width: 38px;
		height: 38px;
		padding: 0;
		display: grid;
		place-items: center;
	}

	/* Kept in the row rather than removed, so the stepper does not shift when
	   the back button has nowhere to go. */
	.nav.ghost {
		visibility: hidden;
		pointer-events: none;
	}

	.confirm {
		width: auto;
		min-width: 38px;
		padding: 0 10px;
	}

	.bang {
		font-weight: 800;
		letter-spacing: 0.08em;
	}

	.pct {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
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

	.notes {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 12px;
		margin: -12px 0 18px;
	}

	.blocked {
		font-size: 12px;
		color: var(--warn);
		text-align: right;
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

	.result .forbrand {
		margin-top: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--pink-soft);
	}

	.caveat {
		font-size: 11.5px !important;
		color: var(--text-faint) !important;
		margin-top: 18px !important;
	}

	.result .btn {
		margin-top: 20px;
	}

	@media (max-width: 1100px) {
		.head {
			grid-template-columns: 1fr;
			align-items: stretch;
			gap: 18px;
		}
		.switch {
			justify-self: center;
		}
	}

	@media (max-width: 860px) {
		.progress {
			width: 100%;
			gap: 14px;
		}
		.steps {
			flex: 1;
			width: auto;
		}
	}
</style>
