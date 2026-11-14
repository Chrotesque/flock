/**
 * What To finish's Worker section shows (the user's design, 4 Nov 2026):
 * each upload a worker has in hand, with the platforms it has finished as a
 * row of marks and a check, and a line per platform still to go — how far
 * its upload has got and which try it is on, a release held for its minute,
 * or waiting its turn. The tasks are the heartbeats' `doing` (a publish
 * names its job and platform since 0.21.5); the posts are `upload_targets`.
 * Work that is no upload's (a NAS copy, a rename) is listed on its own.
 *
 * An Instagram reel Meta keeps refusing (worker/igprep.mjs) is between tries
 * most of the time, in no heartbeat, so the worker read as idle while it was
 * still at it (14 Nov 2026). Such a post is listed from its own record —
 * `handle.prep` — as `retrying`, with its refusals and the next try.
 */
import type { DashTarget } from './dashboard';
import type { PlatformId } from './types';
import type { WorkerTask } from './workerstatus';

export type JobRowState = 'working' | 'held' | 'waiting' | 'failed' | 'retrying';

export interface JobRow {
	platform: PlatformId;
	state: JobRowState;
	/** 0–100, while bytes go up. */
	progress?: number;
	/** The try it is on, and the most it makes (0: no fixed most). */
	tries?: { n: number; max: number };
	/** A held release's slot, or a waiting post's. */
	until?: string;
	/** The post's error, when it failed; the last refusal, while retrying. */
	error?: string;
	/** While retrying: the uploads refused so far, and when the next try is due. */
	refused?: number;
	next?: string;
}

export interface WorkerJob {
	job: string;
	title: string;
	/** The job's brand id; '' when its posts are not read yet. */
	brand: string;
	/** Platforms that are out or held by the platform, in the order they got there. */
	done: PlatformId[];
	rows: JobRow[];
}

const ORDER: PlatformId[] = ['youtube', 'instagram', 'tiktok', 'facebook'];

/** A post the platform has: published, or held by YouTube or Facebook for its time. */
function isDone(status: string): boolean {
	return status === 'published' || status === 'scheduled';
}

/** A pending post whose upload the worker is trying again between pauses. */
function retrying(target: DashTarget): boolean {
	return target.status === 'pending' && target.prep?.state === 'trying' && target.prep.tries > 0;
}

function retryRow(target: DashTarget): JobRow {
	const prep = target.prep!;
	return {
		platform: target.platform,
		state: 'retrying',
		refused: prep.tries,
		...(prep.nextTryAt ? { next: prep.nextTryAt } : {}),
		...(prep.lastError ? { error: prep.lastError } : {})
	};
}

function finishedAt(target: DashTarget): number {
	const t = Date.parse(target.updated ?? '') || Date.parse(target.published_at ?? '');
	return Number.isFinite(t) ? t : 0;
}

/** Each upload in hand, and the tasks no upload owns. */
export function workerJobs(tasks: WorkerTask[], targets: DashTarget[], now: number): { jobs: WorkerJob[]; other: WorkerTask[] } {
	const other = tasks.filter((task) => !task.job);
	const ids = [
		...new Set([
			...tasks.filter((task) => task.job).map((task) => task.job!),
			...targets.filter(retrying).map((t) => t.job)
		])
	];
	const jobs = ids.map((job) => {
		const mine = tasks.filter((task) => task.job === job);
		const posts = targets.filter((t) => t.job === job && t.status !== 'cancelled');
		const done = posts
			.filter((t) => isDone(t.status))
			.sort((a, b) => finishedAt(a) - finishedAt(b) || ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform))
			.map((t) => t.platform);

		const rows: JobRow[] = [];
		const platforms = new Set<PlatformId>([
			...posts.filter((t) => !isDone(t.status)).map((t) => t.platform),
			// A task whose post is not read yet still shows.
			...mine.map((task) => task.platform).filter((p): p is PlatformId => Boolean(p) && !done.includes(p as PlatformId))
		]);
		for (const platform of ORDER.filter((p) => platforms.has(p))) {
			const task = mine.find((t) => t.platform === platform);
			const post = posts.find((t) => t.platform === platform);
			if (task) {
				const held = Boolean(task.until && Date.parse(task.until) > now && task.progress === undefined && !task.tries);
				rows.push({
					platform,
					state: held ? 'held' : 'working',
					...(task.progress !== undefined ? { progress: task.progress } : {}),
					...(task.tries ? { tries: task.tries } : {}),
					...(task.until ? { until: task.until } : {})
				});
			} else if (post && retrying(post)) {
				rows.push(retryRow(post));
			} else if (post?.status === 'failed') {
				rows.push({ platform, state: 'failed', ...(post.error ? { error: post.error } : {}) });
			} else if (post?.status === 'publishing') {
				// Taken up by a run whose heartbeat does not list it (another worker).
				rows.push({ platform, state: 'working' });
			} else if (post) {
				rows.push({ platform, state: 'waiting', ...(post.scheduled_at ? { until: post.scheduled_at } : {}) });
			}
		}

		const title = posts[0]?.jobTitle || posts[0]?.title || (mine[0]?.text ?? '').replace(/^Publishing to [^:]+: /, '').replace(/^"|"$/g, '');
		return { job, title, brand: posts[0]?.brand ?? '', done, rows };
	});
	return { jobs, other };
}

/** "Progress: 82%" and "Retries: 2/10" — the second only from a second try on. */
export function rowWords(row: JobRow, time: (iso: string) => string): string[] {
	const words: string[] = [];
	if (row.state === 'held') words.push(row.until ? `Held for its slot · out at ${time(row.until)}` : 'Held for its slot');
	if (row.state === 'working') {
		words.push(row.progress === undefined ? 'Working' : row.progress >= 100 ? 'Progress: 100% · processing' : `Progress: ${row.progress}%`);
		if (row.tries && row.tries.n > 1) words.push(`Retries: ${row.tries.n - 1}/${row.tries.max ? row.tries.max - 1 : '–'}`);
	}
	if (row.state === 'waiting') words.push(row.until ? `Waiting · slot ${time(row.until)}` : 'Waiting');
	if (row.state === 'failed') words.push('Failed');
	if (row.state === 'retrying') {
		words.push(`Retrying · ${row.refused} refused`);
		if (row.next) words.push(Date.parse(row.next) > Date.now() ? `next try ${time(row.next)}` : 'trying again now');
	}
	return words;
}
