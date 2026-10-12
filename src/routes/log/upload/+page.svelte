<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import VideoPreview from '$lib/components/VideoPreview.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { getLogEntry, listJobLog, listJobWorkerLines } from '$lib/log';
	import { findLoggedJob, jobFileUrl, loadUploadState } from '$lib/repo';
	import { PLATFORMS } from '$lib/platforms';
	import { formatBytes, formatDuration, formatSchedule } from '$lib/format';
	import { depthOf, toneOf } from '$lib/workerlog';
	import {
		loggedFileName,
		mergeTimeline,
		optionLines,
		readUploadRecord,
		recordFromJob,
		slotMoved,
		statusWords,
		type RecordTarget,
		type TimelineEntry,
		type UploadRecord
	} from '$lib/uploadrecord';
	import type { PreviewSource } from '$lib/preview';
	import type { LogEntry, PlatformId, UploadJob, UploadTarget, WatchFile } from '$lib/types';

	/**
	 * One upload, whole: what was confirmed (the record on its Log row,
	 * uploadrecord.ts), what the job and its posts hold now, and everything
	 * logged about it — the browser's rows, the worker's rows and the worker's
	 * console lines for it. Reached from the Log with `?job=<id>`, or with
	 * `?log=<row id>` for an "Uploaded" row from before rows named their job.
	 */

	let loading = $state(true);
	let error = $state('');
	let record = $state<UploadRecord | null>(null);
	/** The row the record came from, or the old "Uploaded" row that led here. */
	let row = $state<LogEntry | null>(null);
	let job = $state<UploadJob | null>(null);
	let jobId = $state('');
	let targets = $state<UploadTarget[]>([]);
	let timeline = $state<TimelineEntry[]>([]);
	let consoleError = $state('');

	const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

	async function load(params: URLSearchParams) {
		loading = true;
		error = '';
		consoleError = '';
		try {
			let id = params.get('job') ?? '';
			let oldRow: LogEntry | null = null;
			const logId = params.get('log');
			if (!id && logId) {
				oldRow = await getLogEntry(logId);
				if (!oldRow) throw new Error('There is no such Log entry.');
				id = oldRow.job || ((await findLoggedJob(loggedFileName(oldRow.detail), oldRow.created))?.id ?? '');
			}
			jobId = id;
			if (!id) {
				// Logged before records were kept, and the upload is gone since.
				row = oldRow;
				record = null;
				job = null;
				targets = [];
				timeline = oldRow ? mergeTimeline([oldRow], []) : [];
				return;
			}
			const [rows, state, lines] = await Promise.all([
				listJobLog(id),
				loadUploadState(id),
				listJobWorkerLines(id).catch((err) => {
					consoleError = message(err);
					return [];
				})
			]);
			job = state.job;
			targets = state.targets;
			const own = rows.find((r) => readUploadRecord(r.data));
			row = own ?? oldRow;
			record = own ? readUploadRecord(own.data) : state.job ? recordFromJob(state.job, state.targets) : null;
			const all = oldRow && !rows.some((r) => r.id === oldRow.id) ? [oldRow, ...rows] : rows;
			timeline = mergeTimeline(all, lines);
		} catch (err) {
			error = message(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void load(page.url.searchParams);
	});

	const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	/** "Mon 12 Oct 2026, 14:03" in this browser's time; PocketBase's space-separated form too. */
	function at(iso: string, seconds = false): string {
		const date = new Date(iso.replace(' ', 'T'));
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			...(seconds ? { second: '2-digit' } : {})
		});
	}

	let heading = $derived.by(() => {
		if (!record) return job?.title || 'Upload';
		const titled = record.targets.find((t) => t.title.trim());
		const first = record.targets[0]?.description.split('\n')[0].trim();
		return titled?.title || first || job?.title || record.video.name || 'Upload';
	});

	/** "Confirmed … on Desk · Owls Nest · project x · flock v0.12.0". */
	let subline = $derived.by(() => {
		if (!record) return '';
		const device = row?.device && !record.reconstructed ? ` on ${row.device}` : '';
		return [
			`Confirmed ${at(record.confirmedAt)}${device}`,
			record.brand,
			record.project ? `project ${record.project}` : '',
			record.version ? `flock v${record.version}` : ''
		]
			.filter(Boolean)
			.join(' · ');
	});

	function live(platform: PlatformId): UploadTarget | undefined {
		return targets.find((t) => t.platform === platform);
	}

	function when(t: RecordTarget): string {
		if (t.immediate) return 'Immediately, as soon as the worker picked it up';
		const zone = record?.timeZone && record.timeZone !== localZone ? ` (${record.timeZone})` : '';
		const slot = t.date ? `${formatSchedule(t.date, t.time)}${zone}` : at(t.scheduledAt);
		return t.profile ? `${slot} · profile "${t.profile}"` : slot;
	}

	function typedDiffers(t: RecordTarget): boolean {
		return t.typed.title !== t.title || t.typed.description !== t.description;
	}

	const SOURCE: Record<string, string> = {
		browser: 'Sent from the browser',
		nas: 'Picked from a watch folder on the LAN',
		local: 'Picked from a folder on the PC'
	};

	/* ---- playing the video ---- */

	/**
	 * Where the video can be played from now: PocketBase's copy of one sent
	 * from the browser, else the file the job names through the worker's
	 * player — or, with the job deleted, the file the record names.
	 */
	let playable = $derived.by((): { file: WatchFile; source: PreviewSource; url: string } | null => {
		if (!record) return null;
		const known = { name: record.video.name, size: record.video.size, modified: '' };
		if (job?.video) return { file: { ...known, path: job.video }, source: 'nas', url: jobFileUrl(job, job.video) };
		if (job?.source_path) {
			const local = Boolean(job.source_local);
			return { file: { ...known, path: job.source_path, local }, source: local ? 'local' : 'nas', url: '' };
		}
		if (!job && record.video.path && record.video.source !== 'browser') {
			const source: PreviewSource = record.video.source === 'local' ? 'local' : 'nas';
			return { file: { ...known, path: record.video.path, local: source === 'local' }, source, url: '' };
		}
		return null;
	});

	let playerOpen = $state(false);
	let coverOpen = $state(false);
	let coverUrl = $derived(job?.cover ? jobFileUrl(job, job.cover) : '');
</script>

<div class="page">
	<a class="back" href="{base}/log">
		<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
			<path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
		Log
	</a>

	{#if loading && !record && !row}
		<p class="banner">Loading…</p>
	{:else if error}
		<p class="banner error">Could not load this upload — {error}</p>
	{:else if !record}
		<header class="head">
			<h1>{heading}</h1>
		</header>
		<p class="banner">
			{#if row}
				This upload was logged before flock kept a record of each upload, and what it stored has been deleted
				since, so its Log line is all there is.
			{:else}
				Nothing is stored about this upload any more: it was uploaded before flock kept a record of each upload,
				and has been deleted since. What was logged about it is below.
			{/if}
		</p>
	{:else}
		<header class="head">
			<div>
				<h1>{heading}</h1>
				<p class="sub">{subline}</p>
			</div>
			<button class="btn sm" onclick={() => load(page.url.searchParams)} disabled={loading}>Refresh</button>
		</header>

		{#if record.reconstructed}
			<p class="banner">
				Uploaded before flock kept a record of each upload, so this is rebuilt from what the upload stores now:
				the text as sent (not as typed, and without which rules changed it), the settings as sent, and each
				slot as it stands — the Calendar may have moved it since.
			</p>
		{/if}

		{#if record.devtest.length > 0}
			<div class="devtest">
				<strong>DevTest was changing things when this was confirmed</strong>
				{#each record.devtest as line (line)}<span>{line}</span>{/each}
			</div>
		{/if}

		<section class="card video">
			<div class="videohead">
				<span class="eyebrow">Video</span>
				{#if playable}
					<button class="name play" onclick={() => (playerOpen = true)} title="Play it">
						<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
							<path d="M5 3.5v9l7.5-4.5Z" fill="currentColor" />
						</svg>
						{record.video.name || '(no name)'}
					</button>
				{:else}
					<span class="name">{record.video.name || '(no name)'}</span>
				{/if}
			</div>

			<dl class="facts">
				<dt>File</dt>
				<dd>{[formatBytes(record.video.size), formatDuration(record.video.duration)].filter(Boolean).join(' · ')}</dd>

				<dt>From</dt>
				<dd>
					{SOURCE[record.video.source]}
					{#if record.video.path}<span class="path">{record.video.path}</span>{/if}
					{#if job?.source_origin && job.source_path}
						<span class="note">Copied to the NAS as <span class="path">{job.source_path}</span></span>
					{:else if job?.source_local}
						<span class="note warn">Not copied to the NAS yet{job.error ? ` — ${job.error}` : ''}</span>
					{/if}
					{#if !playable && record.video.source === 'browser' && !job}
						<span class="note">Its stored copy went when the upload was deleted, so it cannot be played here.</span>
					{/if}
				</dd>

				{#if !record.reconstructed}
					<dt>Review</dt>
					<dd>{record.video.previewed ? 'Played on the Review step before the confirm' : 'Not played on the Review step'}</dd>
				{/if}

				<dt>Kept in</dt>
				<dd>
					{#if record.destination}
						{record.destination.label || 'NAS destination'}
						<span class="path">{record.destination.path}</span>
						{#if job}
							<span class="note" class:warn={Boolean(job.error) && !job.source_local}>
								{job.status === 'done' ? 'Copied there' : job.error && !job.source_local ? `Not copied yet — ${job.error}` : 'Not copied there yet'}
							</span>
						{/if}
					{:else}
						No NAS destination
					{/if}
				</dd>

				{#if record.cover || coverUrl}
					<dt>Cover</dt>
					<dd class="coverline">
						{#if coverUrl}
							<button class="coverthumb" onclick={() => (coverOpen = true)} title="Show it">
								<img src={coverUrl} alt="Instagram cover" />
							</button>
						{/if}
						<span>
							Instagram's cover{record.cover?.name ? `: ${record.cover.name}` : ''}{record.cover?.size
								? ` (${formatBytes(record.cover.size)})`
								: ''}
						</span>
					</dd>
				{/if}

				{#if record.others.length > 0}
					<dt>Same upload</dt>
					<dd>
						{#each record.others as other, i (i)}
							<span class="other">
								{other.name || '(no name)'} for
								{other.platforms.map((p) => PLATFORMS[p].label).join(', ')}
							</span>
						{/each}
						<span class="note">Platforms with a file of their own each have an entry in the Log.</span>
					</dd>
				{/if}

				{#if !job}
					<dt>Now</dt>
					<dd class="warn">The stored upload has been deleted (in Analytics); what is shown is what was confirmed.</dd>
				{/if}
			</dl>
		</section>

		<div class="posts">
			{#each record.targets as t (t.platform)}
				{@const def = PLATFORMS[t.platform]}
				{@const now = live(t.platform)}
				<section class="card post" style:--brandline={def.color}>
					<header class="posthead">
						<PlatformIcon platform={t.platform} size={20} />
						<h2>{def.label}</h2>
						{#if t.account}<span class="as">as {t.account}</span>{/if}
						{#if now}
							<span class="status {now.status}">{statusWords(now.status)}</span>
						{/if}
					</header>

					<dl class="facts">
						<dt>When</dt>
						<dd>
							{when(t)}
							{#if now && !record.reconstructed && slotMoved(t.scheduledAt, now.scheduled_at)}
								<span class="note warn">Moved since, to {at(now.scheduled_at)}</span>
							{/if}
						</dd>
						{#if now?.remote_url}
							<dt>Link</dt>
							<dd><a href={now.remote_url} target="_blank" rel="noopener">{now.remote_url}</a></dd>
						{/if}
						{#if now?.published_at}
							<dt>Published</dt>
							<dd>{at(now.published_at)}</dd>
						{/if}
						{#if now?.error}
							<dt>{now.status === 'failed' ? 'Error' : 'Notes'}</dt>
							<dd class:bad={now.status === 'failed'}>{now.error}</dd>
						{/if}
					</dl>

					{#if t.warnings.length > 0}
						<ul class="warnings">
							{#each t.warnings as warning (warning)}<li>{warning}</li>{/each}
						</ul>
					{/if}

					{#if def.hasTitle}
						<div class="field">
							<span class="fieldname">Title</span>
							<p class="text" class:none={!t.title}>{t.title || 'none'}</p>
						</div>
					{/if}
					<div class="field">
						<span class="fieldname">{def.hasTitle ? 'Description' : 'Caption'}</span>
						<p class="text" class:none={!t.description}>{t.description || 'none'}</p>
					</div>

					{#if typedDiffers(t)}
						<details class="fold">
							<summary>As typed, before the rules changed it</summary>
							{#if def.hasTitle}
								<p class="text">{t.typed.title || 'none'}</p>
							{/if}
							<p class="text">{t.typed.description || 'none'}</p>
						</details>
					{/if}
					{#if t.rules.length > 0}
						<ul class="rules">
							{#each t.rules as rule, i (i)}
								<li class:bad={Boolean(rule.error)}>
									<code>{rule.find}</code> → <code>{rule.replace || '(removed)'}</code>
									{rule.error ? `— ${rule.error}` : `×${rule.count}`}
								</li>
							{/each}
						</ul>
					{/if}

					<details class="fold" open>
						<summary>Settings</summary>
						<dl class="options">
							{#each optionLines(t.platform, t.options) as line (line.key)}
								<dt>{line.label}</dt>
								<dd class:empty={line.empty}>{line.value}</dd>
							{/each}
						</dl>
					</details>
				</section>
			{/each}
		</div>
	{/if}

	{#if !loading && !error && (record || row || timeline.length > 0)}
		<section class="card timeline">
			<h2>What happened</h2>
			<p class="note">
				The Log's rows about this upload and the worker's console lines for it, oldest first. Console lines are
				kept for 14 days, and only from workers of flock 0.12.0 on.
			</p>
			{#if consoleError}
				<p class="note warn">The worker's lines could not be read — {consoleError}</p>
			{/if}
			{#if timeline.length === 0}
				<p class="note">Nothing logged about it yet.</p>
			{:else}
				<ol>
					{#each timeline as entry (entry.kind + entry.id)}
						<li
							class="{entry.kind} {entry.kind === 'console' ? toneOf(entry.text) : ''}"
							style:--depth={entry.kind === 'console' ? depthOf(entry.text) : 0}
						>
							<span class="time">{at(entry.at, true)}</span>
							<span class="by">{entry.kind === 'console' ? 'worker console' : entry.by}</span>
							<span class="msg">
								{entry.text.trimStart()}
								{#if entry.detail}<span class="detail">{entry.detail}</span>{/if}
							</span>
						</li>
					{/each}
				</ol>
			{/if}
			{#if jobId}<p class="note faint">Upload id {jobId}</p>{/if}
		</section>
	{/if}
</div>

<VideoPreview
	bind:open={playerOpen}
	file={playable?.file ?? null}
	source={playable?.source ?? 'nas'}
	url={playable?.url ?? ''}
/>

<Modal bind:open={coverOpen} title="Instagram cover" width="min(92vw, 720px)">
	{#if coverUrl}<img class="coverbig" src={coverUrl} alt="Instagram cover" />{/if}
</Modal>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 14px;
		font-size: 12.5px;
		color: var(--text-dim);
		text-decoration: none;
	}

	.back:hover {
		color: var(--text);
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 18px;
	}

	h1 {
		font-size: 23px;
		overflow-wrap: anywhere;
	}

	.sub {
		margin: 6px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.banner {
		margin: 0 0 16px;
		padding: 12px 15px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-dim);
	}

	.banner.error {
		color: var(--danger);
	}

	.devtest {
		display: grid;
		gap: 3px;
		margin-bottom: 16px;
		padding: 11px 15px;
		border-radius: var(--radius);
		border: 1px dashed rgba(168, 85, 247, 0.6);
		background: rgba(168, 85, 247, 0.1);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.devtest strong {
		color: var(--purple);
	}

	.card {
		padding: 18px 20px;
		margin-bottom: 16px;
	}

	.videohead {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 12px;
		min-width: 0;
	}

	.eyebrow {
		flex: none;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.name {
		font-size: 15px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.play {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--text);
		text-align: left;
	}

	.play svg {
		flex: none;
		color: var(--pink);
	}

	.play:hover {
		color: var(--pink-soft);
	}

	.facts,
	.options {
		display: grid;
		grid-template-columns: 130px minmax(0, 1fr);
		gap: 7px 16px;
		margin: 0;
		font-size: 13px;
	}

	.facts dt,
	.options dt {
		color: var(--text-faint);
	}

	.facts dd,
	.options dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.options {
		grid-template-columns: 190px minmax(0, 1fr);
		font-size: 12.5px;
	}

	.facts a {
		color: var(--pink-soft);
	}

	.facts a:hover {
		color: var(--pink);
	}

	.options dd.empty {
		color: var(--text-faint);
	}

	.path {
		display: block;
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.note {
		display: block;
		font-size: 12px;
		color: var(--text-dim);
	}

	.note.faint {
		color: var(--text-faint);
		font-size: 11px;
	}

	.warn,
	.note.warn {
		color: var(--warn);
	}

	.bad {
		color: var(--danger);
	}

	.other {
		display: block;
	}

	.coverline {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.coverthumb {
		flex: none;
		width: 54px;
		height: 72px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--border);
		background: var(--bg-elev);
	}

	.coverthumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.coverbig {
		display: block;
		max-width: 100%;
		max-height: 75vh;
		margin: 0 auto;
		object-fit: contain;
	}

	.posts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
		gap: 16px;
		margin-bottom: 16px;
	}

	.post {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-top: 3px solid var(--brandline, var(--border));
		min-width: 0;
	}

	.posthead {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 9px;
	}

	.posthead h2 {
		font-size: 16px;
	}

	.as {
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.status {
		margin-left: auto;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 650;
		background: var(--surface-3);
		color: var(--text-dim);
	}

	.status.published,
	.status.scheduled {
		background: rgba(52, 211, 153, 0.14);
		color: var(--ok);
	}

	.status.failed {
		background: rgba(248, 113, 113, 0.14);
		color: var(--danger);
	}

	.status.publishing,
	.status.pending {
		background: rgba(251, 191, 36, 0.12);
		color: var(--warn);
	}

	.warnings {
		margin: 0;
		padding: 9px 12px 9px 28px;
		border-radius: var(--radius-sm);
		background: rgba(251, 191, 36, 0.08);
		border: 1px solid rgba(251, 191, 36, 0.3);
		font-size: 12.5px;
		color: var(--warn);
	}

	.field {
		display: grid;
		gap: 4px;
	}

	.fieldname {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.text {
		margin: 0;
		padding: 9px 12px;
		border-radius: var(--radius-sm);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 13px;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.text.none {
		color: var(--text-faint);
		font-style: italic;
	}

	.fold summary {
		cursor: pointer;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-dim);
		margin-bottom: 8px;
	}

	.fold summary:hover {
		color: var(--text);
	}

	.fold .text + .text {
		margin-top: 6px;
	}

	.rules {
		margin: 0;
		padding-left: 18px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.rules code {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text);
	}

	.timeline h2 {
		font-size: 16px;
		margin-bottom: 4px;
	}

	.timeline > .note {
		margin-bottom: 12px;
	}

	.timeline ol {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--border);
	}

	.timeline li {
		display: grid;
		grid-template-columns: 200px 120px minmax(0, 1fr);
		gap: 12px;
		padding: 7px 0;
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
		align-items: baseline;
	}

	.timeline li:last-child {
		border-bottom: none;
	}

	.timeline .time {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.timeline .by {
		font-size: 11px;
		font-weight: 650;
		color: var(--text-dim);
		overflow-wrap: anywhere;
	}

	.timeline .msg {
		overflow-wrap: anywhere;
	}

	.timeline li.log .msg {
		font-weight: 550;
	}

	.timeline li.console .msg {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-dim);
		padding-left: calc(var(--depth, 0) * 14px);
	}

	.timeline li.fail .msg {
		color: var(--danger);
	}

	.timeline li.skip .msg {
		color: var(--warn);
	}

	.timeline li.done .msg {
		color: var(--ok);
	}

	.timeline .detail {
		display: block;
		margin-top: 2px;
		font-weight: 400;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	@media (max-width: 720px) {
		.facts,
		.options {
			grid-template-columns: 1fr;
			gap: 2px 0;
		}
		.facts dd,
		.options dd {
			margin-bottom: 8px;
		}
		.timeline li {
			grid-template-columns: 1fr;
			gap: 2px;
		}
	}
</style>
