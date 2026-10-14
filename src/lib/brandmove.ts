import { accountFor, accountLabel } from './accounts';
import { PLATFORMS } from './platforms';
import type { Account, Brand, PlatformId, UploadTarget } from './types';

/**
 * Moving a confirmed upload to another brand, post by post.
 *
 * The page only *asks*: it writes a `move` onto each post that should go
 * out as another account, and the worker — the only one holding the
 * platforms' tokens, and the only one that claims rows — carries it out
 * (worker/moves.mjs): a post nothing was sent for yet just changes account;
 * a YouTube video or Facebook reel already on the old account is deleted
 * there first and only then uploaded again; an Instagram reel held for its
 * minute is stopped before it is posted. The worker is also the only one
 * that changes `account`, so a row never says it went out as an account it
 * did not.
 *
 * This module says what will happen to each post, for the overview's list
 * and its confirm; the worker decides again from the row as it is then.
 */

/** What the page writes on a post (`upload_targets.move`). */
export interface MoveRequest {
	/** The `accounts.account_id` it should go out as. */
	to: string;
	toName: string;
	/** The account it was on when the move was asked for. */
	from: string;
	brand: string;
	brandName: string;
	requestedAt: string;
	/** The device that asked. */
	by: string;
}

/**
 * - `switch` nothing was sent: it just goes out as the other account
 * - `replace` on YouTube or Facebook: deleted there, uploaded again
 * - `repost` live on Instagram, which flock cannot delete: posted again
 * - `stop` an Instagram reel held for its slot: stopped before it is posted
 * - `wait` being uploaded right now: replaced once that is done
 * - `none` already goes out as that account
 * - `blocked` the brand has no account on that platform
 * - `keep` not moved (TikTok, for now)
 */
export type MoveKind = 'switch' | 'replace' | 'repost' | 'stop' | 'wait' | 'none' | 'blocked' | 'keep';

/** The kinds a move request is written for. */
export const MOVING: readonly MoveKind[] = ['switch', 'replace', 'repost', 'stop', 'wait'];

export interface MoveStep {
	target: string;
	platform: PlatformId;
	kind: MoveKind;
	from: string;
	fromName: string;
	to: string;
	toName: string;
	/** The post on the platform now, when it is there. */
	url: string;
	/** Public already: deleting it takes its views and comments with it. */
	live: boolean;
	/** Its slot has passed, so it goes out at once once moved. */
	slotPassed: boolean;
	words: string;
}

/** An account as the overview names it: a channel or Page by its name, anything else by @handle. */
export function accountName(accounts: Account[], platform: PlatformId, id: string): string {
	const own = accounts.filter((a) => a.platform === platform);
	const account = id ? own.find((a) => a.account_id === id) : own.length === 1 ? own[0] : undefined;
	if (!account) return id ? `${PLATFORMS[platform].label} account ${id}` : `the ${PLATFORMS[platform].label} account`;
	if (platform === 'youtube' || platform === 'facebook') return account.name || accountLabel(account);
	return accountLabel(account);
}

const time = (iso: string) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/** What happens to each of an upload's posts when it is moved to `brand`. */
export function planMove(
	targets: UploadTarget[],
	brand: Brand,
	accounts: Account[],
	brandCount: number,
	now: Date
): MoveStep[] {
	return targets.map((target) => {
		const platform = target.platform;
		const label = PLATFORMS[platform]?.label ?? platform;
		const from = target.account ?? '';
		const to = accountFor(brand, platform, accounts, brandCount)?.account_id ?? '';
		const slot = time(target.scheduled_at);
		const slotPassed = Number.isFinite(slot) && slot <= now.getTime();
		const step = {
			target: target.id,
			platform,
			from,
			fromName: accountName(accounts, platform, from),
			to,
			toName: to ? accountName(accounts, platform, to) : '',
			url: target.remote_url ?? '',
			live: target.status === 'published' || (target.status === 'scheduled' && slotPassed),
			slotPassed
		};
		const when = slotPassed ? ' at once, as its slot has passed' : ' at its slot';
		const sent = target.status === 'scheduled' || target.status === 'published' || Boolean(target.remote_url);

		const result = (kind: MoveKind, words: string): MoveStep => ({ ...step, kind, words });

		if (!to) return result('blocked', `${brand.name} has no ${label} account to post as, so this stays with ${step.fromName}.`);
		if (from === to) return result('none', `Already goes out as ${step.toName}.`);
		if (platform === 'tiktok') return result('keep', `TikTok posts are not moved yet; this one stays with ${step.fromName}.`);

		if (target.status === 'publishing') {
			if (platform === 'instagram') {
				return result('stop', `Held for its slot on ${step.fromName}: stopped before it is posted, then goes out as ${step.toName}${when}.`);
			}
			return result(
				'wait',
				`Being uploaded to ${step.fromName} right now: once that is done it is deleted there and uploaded again to ${step.toName}.`
			);
		}

		if (!sent) {
			if (target.status === 'failed') return result('switch', `Failed, nothing on ${label}: it goes to ${step.toName} when retried.`);
			return result('switch', `Nothing was sent yet: goes out as ${step.toName} instead${when}.`);
		}

		if (platform === 'youtube' || platform === 'facebook') {
			const what = platform === 'youtube' ? 'The video' : 'The reel';
			const gone = step.live
				? ` It is public, so its views, likes and comments go with it.`
				: ' Nobody has seen it yet.';
			return result('replace', `${what} is deleted from ${step.fromName}, then uploaded again to ${step.toName}${when}.${gone}`);
		}
		if (platform === 'instagram') {
			return result(
				'repost',
				`Already live on ${step.fromName}, and flock cannot delete it: delete it in Instagram. It is posted again as ${step.toName}${when}.`
			);
		}
		return result('keep', `This post is not moved; it stays with ${step.fromName}.`);
	});
}

/** Whether a move to that brand would change anything. */
export function canMove(steps: MoveStep[]): boolean {
	return steps.some((step) => MOVING.includes(step.kind));
}

/** The pending move on a post, read back field by field; null when there is none. */
export function readMove(raw: unknown): MoveRequest | null {
	if (!raw || typeof raw !== 'object') return null;
	const value = raw as Record<string, unknown>;
	const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '');
	if (!text('to')) return null;
	return {
		to: text('to'),
		toName: text('toName'),
		from: text('from'),
		brand: text('brand'),
		brandName: text('brandName'),
		requestedAt: text('requestedAt'),
		by: text('by')
	};
}
