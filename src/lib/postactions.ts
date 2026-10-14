import { PLATFORMS } from './platforms';
import { SYNCED } from './reschedule';
import type { UploadTarget } from './types';

/**
 * Releasing a post at once, or deleting it, from the Calendar's right-click
 * menu (Edit mode). Who holds the post decides who acts. One flock still
 * holds — pending, failed or cancelled — changes in PocketBase alone: its
 * time set to now (a failed one queued again), or its row deleted. One
 * YouTube or Facebook holds for its time is the worker's, asked through
 * `request` (worker/requests.mjs): YouTube's video made public or deleted,
 * Facebook's reel deleted, and for a release sent again at once. Anything
 * out already, or in the worker's hands, refuses — and a group goes only if
 * every post in it may.
 */
export type PostAction = 'release' | 'delete';

export type ActionPlan = { refused: string } | { by: 'page' | 'worker' };

export type ActionPost = Pick<UploadTarget, 'platform' | 'status' | 'scheduled_at'> & {
	remote_url?: string;
	handle?: unknown;
	request?: unknown;
};

export interface PostRequest {
	kind: PostAction;
	requestedAt: string;
	by: string;
}

/** A platform about to put a post out is left to it: a change now could cross it. */
const SOON_MS = 2 * 60_000;

export function readRequest(raw: unknown): PostRequest | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (r.kind !== 'release' && r.kind !== 'delete') return null;
	const text = (key: string) => (typeof r[key] === 'string' ? (r[key] as string) : '');
	return { kind: r.kind, requestedAt: text('requestedAt'), by: text('by') };
}

export function actionPlan(action: PostAction, post: ActionPost, now = Date.now()): ActionPlan {
	const name = PLATFORMS[post.platform]?.label ?? post.platform;
	const slot = Date.parse(String(post.scheduled_at ?? '').replace(' ', 'T'));
	if (readRequest(post.request)) return { refused: 'The worker is on it already.' };
	switch (post.status) {
		case 'published':
			return { refused: action === 'release' ? `It is out on ${name} already.` : `It is out on ${name} already; delete it there.` };
		case 'cancelled':
			return action === 'release' ? { refused: 'It was cancelled.' } : { by: 'page' };
		case 'publishing':
			return {
				refused: SYNCED.includes(post.platform)
					? `It is being uploaded to ${name} right now.`
					: `The worker has it ready for its minute; ${name} takes it as it is.`
			};
		case 'failed':
			return post.remote_url ? { refused: `${name} has it; see the upload's overview.` } : { by: 'page' };
		case 'scheduled': {
			if (!SYNCED.includes(post.platform)) return { refused: `${name} has it.` };
			const h = post.handle && typeof post.handle === 'object' ? (post.handle as { released?: boolean }) : {};
			if (h.released) return { refused: `It is out on ${name} already.` };
			if (!(slot - now > SOON_MS)) return { refused: `${name} puts it out within minutes; too late to change it here.` };
			return { by: 'worker' };
		}
		default:
			if (!(slot > now)) return { refused: 'Its time has passed; the worker is sending it.' };
			return { by: 'page' };
	}
}

/** Why a whole group cannot have the action, naming the post when there are several; '' when all may. */
export function groupRefusal(action: PostAction, posts: ActionPost[], now = Date.now()): string {
	for (const post of posts) {
		const plan = actionPlan(action, post, now);
		if ('refused' in plan) {
			return posts.length > 1 ? `${PLATFORMS[post.platform]?.label ?? post.platform}: ${plan.refused}` : plan.refused;
		}
	}
	return '';
}
