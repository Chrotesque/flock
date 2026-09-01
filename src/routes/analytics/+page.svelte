<script lang="ts">
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import { listJobs, listTargets, deleteJob } from '$lib/repo';
	import { isPlatformId } from '$lib/platforms';
	import { formatBytes, formatDuration, relativeTo } from '$lib/format';
	import type { UploadJob, UploadTarget } from '$lib/types';

	// Analytics proper comes later. Until then this route is the window onto
	// what is actually sitting on the NAS — which is also how you check that an
	// upload really landed.
	let jobs = $state<UploadJob[]>([]);
	let targets = $state<UploadTarget[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state<string | null>(null);

	async function load() {
		loading = true;
		error = null;
		try {
			[jobs, targets] = await Promise.all([listJobs(), listTargets()]);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void load();
	});

	function targetsOf(jobId: string): UploadTarget[] {
		return targets.filter((t) => t.job === jobId);
	}

	function whenOf(target: UploadTarget): { date: string; time: string } {
		const d = new Date(target.scheduled_at);
		if (Number.isNaN(d.getTime())) return { date: '', time: '' };
		const pad = (n: number) => String(n).padStart(2, '0');
		return {
			date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
			time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
		};
	}

	async function remove(job: UploadJob) {
		busy = job.id;
		try {
			await deleteJob(job.id);
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = null;
		}
	}
</script>

<div class="page">
	<header class="head">
		<div>
			<h1>Analytics</h1>
			<p>Reach and performance land here once the platform APIs are connected.</p>
		</div>
		<button class="btn sm" onclick={load} disabled={loading}>Refresh</button>
	</header>

	<section class="card soon">
		<div class="sparks" aria-hidden="true">
			{#each [38, 62, 45, 78, 56, 90, 72] as height, i (i)}
				<span style="height: {height}%"></span>
			{/each}
		</div>
		<div>
			<h2>Nothing to measure yet</h2>
			<p>
				Views, retention and follower deltas per platform will go here. It needs the same API
				credentials that publishing does, so it stays empty until those exist.
			</p>
		</div>
	</section>

	<h3 class="section">On the NAS</h3>

	{#if error}
		<p class="banner error">{error}</p>
	{:else if loading}
		<p class="banner">Loading…</p>
	{:else if jobs.length === 0}
		<p class="banner">
			No uploads stored yet. Anything you confirm on the Upload screen shows up here.
		</p>
	{:else}
		<ul class="jobs">
			{#each jobs as job (job.id)}
				<li class="card">
					<div class="jobhead">
						<div class="ident">
							<p class="title">{job.title || '(untitled)'}</p>
							<p class="meta">
								{job.video_name || 'no file'}
								{#if job.video_size}
									<span class="dot">·</span>{formatBytes(job.video_size)}
								{/if}
								{#if job.video_duration}
									<span class="dot">·</span>{formatDuration(job.video_duration)}
								{/if}
							</p>
						</div>
						<span class="pill status {job.status}">{job.status}</span>
						<button
							class="del"
							onclick={() => remove(job)}
							disabled={busy === job.id}
							aria-label="Delete this upload"
						>
							<svg viewBox="0 0 16 16" width="13" height="13"
								><path
									d="M3 4.5h10M6.5 4.5V3.2h3v1.3M4.4 4.5l.5 8h6.2l.5-8"
									fill="none"
									stroke="currentColor"
									stroke-width="1.4"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						</button>
					</div>

					<ul class="targets">
						{#each targetsOf(job.id) as target (target.id)}
							{@const when = whenOf(target)}
							<li>
								{#if isPlatformId(target.platform)}
									<PlatformIcon platform={target.platform} size={15} />
									<span class="who">{PLATFORMS[target.platform].label}</span>
								{:else}
									<span class="who">{target.platform}</span>
								{/if}
								<span class="ttitle">{target.title || '(no title)'}</span>
								<span class="when">{relativeTo(when.date, when.time)}</span>
								<span class="tstatus {target.status}">{target.status}</span>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 1000px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.soon {
		display: flex;
		align-items: center;
		gap: 22px;
		padding: 22px 24px;
	}

	.sparks {
		flex: none;
		display: flex;
		align-items: flex-end;
		gap: 5px;
		width: 108px;
		height: 62px;
	}

	.sparks span {
		flex: 1;
		border-radius: 3px;
		background: linear-gradient(180deg, var(--pink) 0%, var(--purple) 100%);
		opacity: 0.32;
	}

	.soon h2 {
		font-size: 15.5px;
	}

	.soon p {
		margin: 6px 0 0;
		font-size: 12.5px;
		color: var(--text-dim);
		line-height: 1.55;
		max-width: 64ch;
	}

	.section {
		margin: 30px 0 12px;
		font-size: 14px;
	}

	.banner {
		margin: 0;
		padding: 13px 15px;
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

	.jobs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}

	.jobs > li {
		padding: 14px 16px;
	}

	.jobhead {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.ident {
		flex: 1;
		min-width: 0;
	}

	.title {
		margin: 0;
		font-size: 13.5px;
		font-weight: 570;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.dot {
		margin: 0 6px;
		opacity: 0.5;
	}

	.status {
		flex: none;
		text-transform: capitalize;
	}

	.status.stored {
		background: rgba(52, 211, 153, 0.15);
		color: var(--ok);
	}

	.status.failed {
		background: rgba(248, 113, 113, 0.15);
		color: var(--danger);
	}

	.del {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--text-faint);
	}

	.del:hover:not(:disabled) {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.targets {
		list-style: none;
		margin: 12px 0 0;
		padding: 12px 0 0;
		border-top: 1px solid var(--border);
		display: grid;
		gap: 7px;
	}

	.targets li {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12px;
	}

	.who {
		flex: none;
		width: 74px;
		color: var(--text-dim);
	}

	.ttitle {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}

	.when {
		flex: none;
		font-size: 11px;
		color: var(--text-faint);
	}

	.tstatus {
		flex: none;
		width: 66px;
		text-align: right;
		font-size: 10.5px;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}

	.tstatus.published {
		color: var(--ok);
	}

	.tstatus.failed {
		color: var(--danger);
	}

	@media (max-width: 700px) {
		.soon {
			flex-direction: column;
			align-items: flex-start;
		}
		.who {
			width: auto;
		}
	}
</style>
