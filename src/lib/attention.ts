import { postAllowance } from './accounts';
import { ago, type DashTarget } from './dashboard';
import { firstLine } from './format';
import type { Account, PlatformId, StatsStatus } from './types';
import type { WorkerDot } from './workerstatus';

/**
 * What needs looking at, shown at the top of the To finish panel (it was the
 * dashboard's "Needs attention" widget until 0.14.7): posts that went wrong
 * or are about to, and the system's own troubles. Across every brand — a
 * failed post on another brand's account matters as much as one on the brand
 * in view — with each post's brand on it. A post's item can be dismissed by
 * its `key`; a system item goes when its cause does.
 */

/** `failed` and `unsent` are posts that did not go out — the sidebar box turns red for them. */
export type AttentionKind = 'failed' | 'unsent' | 'stuck' | 'importing' | 'private' | 'system';

export interface Attention {
	level: 'error' | 'warn';
	kind: AttentionKind;
	/** Stable while what it is about stays as it is, for dismissing; '' for a system item. */
	key: string;
	text: string;
	detail: string;
	/** The upload it is about, for its page in the Log; '' for none. */
	job: string;
	/** The post's platform; '' for a system item. */
	platform: PlatformId | '';
	/** The post's brand id; '' for a system item. */
	brand: string;
	/** A failed post that may be sent again (`canRetry`): its row and slot. */
	retry?: { target: string; slot: string };
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const time = (iso: string | undefined) => Date.parse(String(iso ?? '').replace(' ', 'T'));

function nameOf(target: DashTarget): string {
	return target.title || target.jobTitle || 'Untitled';
}

const byLevel = (a: Attention, b: Attention) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1);

/**
 * Posts that went wrong or are about to, newest first within each kind: a
 * failure in the last week; a post past its slot that was never sent (a
 * YouTube post is sent at once, so any left waiting 10 min); one uploading
 * for over 90 min (the time after which a takeover gives up on it too); a
 * local video still not on the NAS; and a private YouTube post that was
 * given a slot — YouTube is handed no release time for it, so the slot does
 * nothing and it stays private.
 *
 * A failure's key carries the row's `updated`, so a post retried and failing
 * again comes back after its first failure was dismissed. The grace before
 * "never sent" and "uploading for" also counts from the row's last change,
 * so a post just retried, its slot long gone, is not flagged in the seconds
 * before the worker takes it up again.
 */
export function targetProblems(targets: DashTarget[], now: Date, label: (p: PlatformId) => string): Attention[] {
	const at = now.getTime();
	const out: Attention[] = [];
	const importing = new Set<string>();
	for (const t of [...targets].sort((a, b) => time(b.scheduled_at) - time(a.scheduled_at))) {
		const slot = time(t.scheduled_at);
		const changed = time(t.updated);
		const sinceChange = (from: number) => at - (Number.isFinite(changed) ? Math.max(from, changed) : from);
		const name = `${label(t.platform)}: "${nameOf(t)}"`;
		const post = { job: t.job, platform: t.platform, brand: t.brand ?? '' };
		if (t.status === 'failed' && at - slot < 7 * DAY) {
			out.push({
				level: 'error',
				kind: 'failed',
				key: `failed:${t.id}:${t.updated ?? ''}`,
				text: `${name} failed`,
				detail: t.error || '',
				...post,
				...(canRetry(t) ? { retry: { target: t.id, slot: t.scheduled_at } } : {})
			});
		} else if (t.importing && t.status === 'pending') {
			if (!importing.has(t.job) && at - time(t.jobCreated) > 10 * MIN) {
				importing.add(t.job);
				out.push({
					level: 'warn',
					kind: 'importing',
					key: `importing:${t.job}`,
					text: `"${t.jobTitle || nameOf(t)}" is not on the NAS yet`,
					detail: `Waiting ${ago(at - time(t.jobCreated))} for the PC worker to copy it${t.jobError ? ` — ${t.jobError}` : ''}`,
					...post,
					platform: ''
				});
			}
		} else if (t.status === 'pending') {
			const due = t.platform === 'youtube' ? time(t.jobCreated) : slot;
			if (sinceChange(due) > 10 * MIN) {
				out.push({
					level: 'error',
					kind: 'unsent',
					key: `unsent:${t.id}`,
					text: `${name} was never sent`,
					detail:
						t.platform === 'youtube'
							? `Waiting ${ago(at - due)} for the worker to upload it.`
							: `Its slot passed ${ago(at - due)} ago.`,
					...post
				});
			}
		} else if (t.status === 'publishing' && sinceChange(Math.max(slot, time(t.jobCreated))) > 90 * MIN) {
			out.push({
				level: 'warn',
				kind: 'stuck',
				key: `stuck:${t.id}`,
				text: `${name} has been uploading for ${ago(sinceChange(Math.max(slot, time(t.jobCreated))))}`,
				detail: 'Longer than an upload should take; the worker may have lost it.',
				...post
			});
		}
		if (t.platform === 'youtube' && t.visibility === 'Private' && slot > time(t.jobCreated) + MIN && slot > at - 7 * DAY) {
			out.push({
				level: 'warn',
				kind: 'private',
				key: `private:${t.id}`,
				text: `${name} is private, with a slot`,
				detail: 'YouTube is given no release time for a private video, so it stays private at its slot.',
				...post
			});
		}
	}
	return out.sort(byLevel);
}

export interface SystemInput {
	dots: WorkerDot[];
	accounts: Account[];
	/** Posts, for which accounts have some waiting. */
	targets: DashTarget[];
	status: StatsStatus | null;
	now: Date;
}

function system(level: Attention['level'], text: string, detail: string): Attention {
	return { level, kind: 'system', key: '', text, detail, job: '', platform: '', brand: '' };
}

/**
 * Whether a waiting post goes out as this account: by the account it names,
 * or by naming none while the account is the platform's only one.
 */
function postsAs(account: Account, accounts: Account[], target: DashTarget): boolean {
	if (target.platform !== account.platform) return false;
	if (target.account) return target.account === account.account_id;
	return accounts.filter((a) => a.platform === account.platform).length === 1;
}

/**
 * The system's troubles: a publishing worker down (the PC's is often off on
 * purpose, and what it holds up shows on its own); a TikTok account that may
 * not post right now, or an Instagram account with its 24 h of posts used
 * up, while posts wait for it — an account nobody is posting to is no
 * trouble; YouTube's stats not being read; the quota nearly gone.
 */
export function systemProblems({ dots, accounts, targets, status, now }: SystemInput): Attention[] {
	const out: Attention[] = [];
	for (const dot of dots) {
		if (dot.state !== 'down' || dot.role === 'local') continue;
		out.push(
			system(
				'error',
				dot.role === 'nas' ? 'The NAS worker is not running' : 'The worker is not running',
				'Nothing is published or filed until it is back.'
			)
		);
	}
	const waiting = targets.filter((t) => t.status === 'pending');
	for (const account of accounts) {
		const queued = waiting.filter((t) => postsAs(account, accounts, t));
		if (queued.length === 0) continue;
		if (account.platform === 'tiktok' && account.error) {
			out.push(system('error', `TikTok says @${account.handle} cannot post right now`, firstLine(account.error)));
		}
		const allowance = account.platform === 'instagram' ? postAllowance(account) : null;
		if (allowance && allowance.left <= 0) {
			const due = queued.filter((t) => time(t.scheduled_at) - now.getTime() < DAY).length;
			if (due > 0) {
				out.push(
					system(
						'warn',
						`@${account.handle}'s ${allowance.total} Instagram posts in 24 h are used up`,
						`${due} ${due === 1 ? 'post is' : 'posts are'} due within a day; Instagram refuses them unless some age out first.`
					)
				);
			}
		}
	}
	if (status?.error) out.push(system('warn', 'YouTube stats are not being read', status.error));
	for (const [channelId, channel] of Object.entries(status?.channels ?? {})) {
		if (!channel?.error) continue;
		const name =
			channel.title || accounts.find((a) => a.platform === 'youtube' && a.account_id === channelId)?.name || channelId;
		out.push(system('warn', `YouTube stats are not being read for ${name}`, channel.error));
	}
	if (status && status.budget > 0 && status.unitsToday >= status.budget * 0.9) {
		out.push(
			system(
				'warn',
				'YouTube quota nearly used up',
				`${status.unitsToday.toLocaleString()} of ${status.budget.toLocaleString()} units today; the stats pause at the budget.`
			)
		);
	}
	return out.sort(byLevel);
}

/** Everything that needs attention, less what was dismissed, errors first. */
export function attentionItems(
	input: SystemInput & { label: (p: PlatformId) => string; dismissed: Iterable<string> }
): Attention[] {
	const dismissed = new Set(input.dismissed);
	return [...targetProblems(input.targets, input.now, input.label), ...systemProblems(input)]
		.filter((item) => !item.key || !dismissed.has(item.key))
		.sort(byLevel);
}

/** A post did not go out: the sidebar box turns red and pulses. */
export function hasFailure(items: Attention[]): boolean {
	return items.some((item) => item.kind === 'failed' || item.kind === 'unsent');
}

/* ---- retrying ---- */

/**
 * A post that may be sent again: one that failed and that the platform has
 * no link for — a post the platform has is never sent twice.
 */
export function canRetry(target: { status: string; remote_url?: string }): boolean {
	return target.status === 'failed' && !target.remote_url;
}

/**
 * When a retried post goes out: at its slot while that is still ahead (the
 * worker holds it, or YouTube does), at once once it has passed — null.
 */
export function retryWhen(slot: string, now: Date): Date | null {
	const at = time(slot);
	return Number.isFinite(at) && at > now.getTime() ? new Date(at) : null;
}

/* ---- dismissing ---- */

/** `app_settings` key holding the dismissed items' keys. */
export const DISMISSED_KEY = 'todo_attention';

/** Enough for months of failures; the oldest go first. */
export const DISMISSED_CAP = 500;

/** The stored row, read back as a list of keys whatever shape it has. */
export function readDismissed(raw: unknown): string[] {
	const list = (raw as { dismissed?: unknown } | null)?.dismissed;
	return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string' && k !== '') : [];
}

/** The stored list with keys added, each once, newest last, capped. */
export function addDismissed(stored: string[], ...keys: string[]): string[] {
	const out = stored.filter((k) => !keys.includes(k));
	out.push(...keys.filter((k) => k !== ''));
	return out.slice(-DISMISSED_CAP);
}
