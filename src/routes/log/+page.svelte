<script lang="ts">
	import { listLog, deviceName, listWorkerLog, subscribeWorkerLog } from '$lib/log';
	import { toneOf, depthOf } from '$lib/workerlog';
	import type { LogCategory, LogEntry, WorkerLine } from '$lib/types';

	type Tab = LogCategory | 'all' | 'worker';

	const CATEGORIES: { id: Tab; label: string }[] = [
		{ id: 'all', label: 'Everything' },
		{ id: 'upload', label: 'Uploads' },
		{ id: 'calendar', label: 'Calendar' },
		{ id: 'settings', label: 'Settings' },
		{ id: 'worker', label: 'Worker' }
	];

	/** Lines kept in memory while the page is open and realtime keeps adding. */
	const WORKER_MAX = 3000;

	let entries = $state<LogEntry[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let workerLines = $state<WorkerLine[]>([]);
	let workerError = $state<string | null>(null);

	let category = $state<Tab>('all');
	let query = $state('');

	async function load() {
		loading = true;
		error = null;
		workerError = null;
		// Separate, so a PocketBase without worker_log yet still shows the log.
		const [actions, worker] = await Promise.allSettled([listLog(), listWorkerLog()]);
		if (actions.status === 'fulfilled') entries = actions.value;
		else error = actions.reason instanceof Error ? actions.reason.message : String(actions.reason);
		if (worker.status === 'fulfilled') workerLines = worker.value;
		else
			workerError = worker.reason instanceof Error ? worker.reason.message : String(worker.reason);
		loading = false;
	}

	$effect(() => {
		void load();
	});

	// Live: the worker's lines arrive as it prints them.
	$effect(() =>
		subscribeWorkerLog((line) => {
			if (workerLines.some((l) => l.id === line.id)) return;
			workerLines = [line, ...workerLines].slice(0, WORKER_MAX);
		})
	);

	let counts = $derived({
		all: entries.length,
		upload: entries.filter((e) => e.category === 'upload').length,
		calendar: entries.filter((e) => e.category === 'calendar').length,
		settings: entries.filter((e) => e.category === 'settings').length,
		worker: workerLines.length
	});

	let visibleWorker = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return workerLines;
		return workerLines.filter((line) => line.message.toLowerCase().includes(needle));
	});

	let workerDays = $derived(byDay(visibleWorker));

	let visible = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return entries.filter((entry) => {
			if (category !== 'all' && entry.category !== category) return false;
			if (!needle) return true;
			return (
				entry.action.toLowerCase().includes(needle) ||
				entry.detail.toLowerCase().includes(needle) ||
				entry.device.toLowerCase().includes(needle)
			);
		});
	});

	let days = $derived(byDay(visible));

	/** Grouped by calendar day, so a long list stays scannable. */
	function byDay<T extends { created: string }>(list: T[]) {
		const buckets: { key: string; label: string; rows: T[] }[] = [];
		for (const entry of list) {
			const at = new Date(entry.created);
			const key = at.toDateString();
			const last = buckets[buckets.length - 1];
			if (last && last.key === key) last.rows.push(entry);
			else
				buckets.push({
					key,
					label: at.toLocaleDateString(undefined, {
						weekday: 'long',
						day: 'numeric',
						month: 'long',
						year: 'numeric'
					}),
					rows: [entry]
				});
		}
		return buckets;
	}

	function timeOf(entry: { created: string }): string {
		return new Date(entry.created).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function dateOf(entry: { created: string }): string {
		return new Date(entry.created).toLocaleDateString(undefined, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
	}

</script>

<div class="page">
	<header class="head">
		<div>
			<h1>Log</h1>
			<p>
				{category === 'worker'
					? 'What the worker printed, live, kept for 14 days.'
					: 'Every change made through flock, and which machine made it.'}
			</p>
		</div>
		<button class="btn sm" onclick={load} disabled={loading}>Refresh</button>
	</header>

	<div class="controls">
		<div class="tabs" role="tablist">
			{#each CATEGORIES as item (item.id)}
				<button
					role="tab"
					aria-selected={category === item.id}
					class:active={category === item.id}
					onclick={() => (category = item.id)}
				>
					{item.label}
					<span class="count">{counts[item.id]}</span>
				</button>
			{/each}
		</div>

		<div class="search">
			<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
				<circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.6" />
				<path d="m10.6 10.6 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
			</svg>
			<input
				class="input"
				type="search"
				bind:value={query}
				placeholder={category === 'worker' ? 'Search the worker’s lines…' : 'Search actions, details, device…'}
			/>
			{#if query}
				<button class="clearq" onclick={() => (query = '')} aria-label="Clear search">×</button>
			{/if}
		</div>
	</div>

	{#if category === 'worker'}
		{#if workerError}
			<p class="banner error">
				Could not read the worker's log — {workerError}. If PocketBase has no
				<code>worker_log</code> collection yet, run <code>pnpm setup-pb</code>.
			</p>
		{:else if loading && workerLines.length === 0}
			<p class="banner">Loading…</p>
		{:else if workerLines.length === 0}
			<p class="banner">
				Nothing from the worker yet. Its lines appear here as it prints them, from the first start
				after this was added.
			</p>
		{:else if visibleWorker.length === 0}
			<p class="banner">No lines match that search.</p>
		{:else}
			<div class="log">
				{#each workerDays as day (day.key)}
					<section class="day">
						<h2>{day.label}</h2>
						<ol class="console">
							{#each day.rows as line (line.id)}
								<li class={toneOf(line.message)} style:--depth={depthOf(line.message)}>
									<span class="time">{timeOf(line)}</span>
									<span class="msg">{line.message.trimStart()}</span>
								</li>
							{/each}
						</ol>
					</section>
				{/each}
			</div>

			<p class="foot">
				Showing {visibleWorker.length} of {workerLines.length} lines, newest first. A line the
				worker repeats (the watch-folder count) is kept once an hour.
			</p>
		{/if}
	{:else if error}
		<p class="banner error">Could not reach PocketBase — {error}</p>
	{:else if loading && entries.length === 0}
		<p class="banner">Loading…</p>
	{:else if entries.length === 0}
		<p class="banner">
			Nothing logged yet. Actions are recorded from this point on — uploads, calendar moves and
			settings changes. The log cannot be cleared.
		</p>
	{:else if visible.length === 0}
		<p class="banner">No entries match that filter.</p>
	{:else}
		<div class="log">
			{#each days as day (day.key)}
				<section class="day">
					<h2>{day.label}</h2>
					<ul>
						{#each day.rows as entry (entry.id)}
							<li>
								<span class="stamp">
									<span class="date">{dateOf(entry)}</span>
									<span class="time">{timeOf(entry)}</span>
								</span>
								<span class="cat {entry.category}">{entry.category}</span>
								<span class="what">
									<span class="action">{entry.action}</span>
									{#if entry.detail}
										<span class="detail">{entry.detail}</span>
									{/if}
								</span>
								<button
									class="device"
									class:on={query.trim().toLowerCase() === entry.device.toLowerCase()}
									onclick={() => (query = entry.device)}
									title="Search for {entry.device || 'unknown'}"
								>
									{entry.device || 'unknown'}
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>

		<p class="foot">
			Showing {visible.length} of {entries.length}. This browser logs as
			<strong>{deviceName()}</strong>. Entries cannot be edited or removed.
		</p>
	{/if}
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 20px;
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

	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 16px;
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding: 3px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 10px;
	}

	.tabs button {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 13px;
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

	.tabs .count {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.tabs button.active .count {
		color: var(--pink-soft);
	}

	.search {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 260px;
		flex: 1;
		max-width: 380px;
	}

	.search svg {
		position: absolute;
		left: 11px;
		color: var(--text-faint);
		pointer-events: none;
	}

	.search .input {
		padding: 8px 30px 8px 32px;
		font-size: 12.5px;
	}

	.search .input::-webkit-search-cancel-button {
		display: none;
	}

	.clearq {
		position: absolute;
		right: 8px;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		font-size: 16px;
		line-height: 1;
		color: var(--text-faint);
	}

	.clearq:hover {
		background: var(--surface-3);
		color: var(--text);
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

	.log {
		display: grid;
		gap: 22px;
	}

	.day h2 {
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-faint);
		margin-bottom: 8px;
	}

	.day ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--surface);
	}

	.day li {
		display: grid;
		grid-template-columns: 116px 84px minmax(0, 1fr) 150px;
		align-items: baseline;
		gap: 14px;
		padding: 11px 16px;
		border-bottom: 1px solid var(--border);
	}

	.day li:last-child {
		border-bottom: none;
	}

	.day li:hover {
		background: var(--bg-elev);
	}

	.stamp {
		display: flex;
		flex-direction: column;
		font-family: var(--mono);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.date {
		color: var(--text-faint);
	}

	.time {
		color: var(--text-dim);
	}

	.cat {
		justify-self: start;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.cat.upload {
		background: rgba(168, 85, 247, 0.16);
		color: #cfa8fb;
	}

	.cat.calendar {
		background: rgba(255, 77, 158, 0.16);
		color: var(--pink-soft);
	}

	.cat.settings {
		background: rgba(52, 211, 153, 0.14);
		color: var(--ok);
	}

	.what {
		min-width: 0;
	}

	.action {
		display: block;
		font-size: 13px;
		font-weight: 550;
	}

	.detail {
		display: block;
		margin-top: 2px;
		font-size: 11.5px;
		color: var(--text-faint);
		overflow-wrap: anywhere;
	}

	/* A tag, like the category badge — clicking it searches for that machine. */
	.device {
		justify-self: end;
		max-width: 100%;
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--surface-3);
		border: 1px solid var(--border);
		font-size: 10.5px;
		font-weight: 650;
		letter-spacing: 0.03em;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: background 0.14s, color 0.14s, border-color 0.14s;
	}

	.device:hover {
		border-color: var(--pink);
		color: var(--text);
	}

	.device.on {
		background: var(--accent-grad);
		border-color: transparent;
		color: #fff;
	}

	/* The worker's console: one dense monospace line per print, steps of a job
	   indented under it, tinted by what the wording says happened. */
	.console {
		list-style: none;
		margin: 0;
		padding: 6px 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		font-family: var(--mono);
		font-size: 11.5px;
	}

	.console li {
		display: grid;
		grid-template-columns: 74px minmax(0, 1fr);
		gap: 12px;
		padding: 2px 16px;
		line-height: 1.55;
	}

	.console li:hover {
		background: var(--bg-elev);
	}

	.console .time {
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.console .msg {
		padding-left: calc(var(--depth, 0) * 18px);
		color: var(--text-dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.console li.fail .msg {
		color: var(--danger);
	}

	.console li.skip .msg {
		color: var(--warn);
	}

	.console li.done .msg {
		color: var(--ok);
	}

	.banner code {
		font-family: var(--mono);
		font-size: 11.5px;
	}

	.foot {
		margin: 20px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.foot strong {
		color: var(--text-dim);
		font-weight: 600;
	}

	@media (max-width: 860px) {
		.day li {
			grid-template-columns: 100px minmax(0, 1fr);
			gap: 8px 12px;
		}
		.cat {
			grid-row: 2;
		}
		.device {
			justify-self: start;
		}
	}
</style>
