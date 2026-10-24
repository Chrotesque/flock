import { PLATFORMS } from './platforms';
import { actionPlan, readRequest, type ActionPost } from './postactions';
import { landReason, lockReason, SYNCED } from './reschedule';
import { optionName } from './uploadrecord';
import type { OptionValues, PlatformId, UploadTarget } from './types';

/**
 * Editing an upload that is queued: the Calendar's right-click → Edit opens
 * it in the upload wizard, filled in, and confirming saves over it.
 *
 * Who holds each post decides what an edit can do, as for moves
 * (reschedule.ts). A post flock still holds — pending, its slot ahead and not
 * yet taken up, or failed with nothing on the platform — is the page's to
 * rewrite: text, options, time, cover, even the video. A YouTube video the
 * platform already holds for its time is the worker's: its title,
 * description, tags and playlists change through YouTube's API
 * (worker/requests.mjs), its time through the move the Calendar already
 * makes, nothing else. Anything out already, being sent, or about to be, is
 * left as it is: it opens locked, with why.
 *
 * What changed is worked out against the upload as it was loaded into the
 * wizard (`baseline`), not against the stored rows: the text there is what
 * was typed, before the platform's rules ran, and options gain keys the
 * registry added since, so only what was actually touched counts — an
 * untouched post is not written, and an untouched YouTube video not sent
 * to YouTube.
 */

export type EditPost = Pick<UploadTarget, 'id' | 'platform' | 'status' | 'scheduled_at' | 'title' | 'description' | 'options'> & {
	remote_url?: string;
	handle?: unknown;
	request?: unknown;
	account?: string;
};

/** Who carries out an edit of a post, or why it cannot be edited. */
export type EditHold = { by: 'page' } | { by: 'worker' } | { refused: string };

/** The platforms whose post the worker edits once the platform holds it. */
export const WORKER_EDITS: readonly PlatformId[] = ['youtube'];

export function editHold(post: ActionPost, now = Date.now()): EditHold {
	const name = PLATFORMS[post.platform]?.label ?? post.platform;
	if (post.status === 'cancelled') return { refused: 'It was cancelled.' };
	const locked = lockReason(post, now);
	if (locked) return { refused: locked };
	switch (post.status) {
		case 'failed':
			return post.remote_url ? { refused: `${name} has it; see the upload's overview.` } : { by: 'page' };
		case 'scheduled':
			if (!SYNCED.includes(post.platform)) return { refused: `${name} has it.` };
			if (!WORKER_EDITS.includes(post.platform)) return { refused: `${name} has it already; flock cannot edit it there yet.` };
			return { by: 'worker' };
		default:
			return { by: 'page' };
	}
}

/** What a post was, or is to be: the text that goes out, its options and its time. */
export interface EditState {
	title: string;
	description: string;
	options: OptionValues;
	/** The instant (ISO). */
	at: string;
}

/** A post as the wizard has it at the save. */
export interface EditRow extends EditState {
	platform: PlatformId;
	/** To go out as soon as the worker sees it. */
	immediate: boolean;
	/** On the upload's own video still; false when another one was picked for it. */
	kept: boolean;
}

/** What a post's edit touched. */
export interface EditChanges {
	text: boolean;
	/** Option keys whose value differs. */
	options: string[];
	time: boolean;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const minute = (iso: string): number => Math.floor(Date.parse(String(iso).replace(' ', 'T')) / 60_000);

export function editChanges(base: EditState, row: EditRow): EditChanges {
	const keys = [...new Set([...Object.keys(base.options), ...Object.keys(row.options)])].sort();
	return {
		text: row.title !== base.title || row.description !== base.description,
		options: keys.filter((key) => !same(base.options[key], row.options[key])),
		time: row.immediate || minute(row.at) !== minute(base.at)
	};
}

export function changedAnything(changes: EditChanges): boolean {
	return changes.text || changes.options.length > 0 || changes.time;
}

/**
 * The option keys YouTube lets a video it holds change through the API:
 * the tags (the list sent, and the boxes it was put together from) and the
 * playlists. Visibility, category, languages and the rest went in with the
 * upload and stay.
 */
export const YOUTUBE_EDITABLE: readonly string[] = [
	'tags',
	...(PLATFORMS.youtube.tagBudget?.keys ?? []),
	'playlists',
	'playlist'
];

/** An option key in the screens' words. */
const optionLabel = optionName;

/** What the worker is asked to change on a post the platform holds. */
export interface EditRequest {
	kind: 'edit';
	requestedAt: string;
	by: string;
	title: string;
	description: string;
	options: OptionValues;
	/** As the post stood, for the playlists to leave and the Log line. */
	before: { title: string; description: string; options: OptionValues };
}

export type EditStep =
	/** A post flock holds, rewritten in place. */
	| { kind: 'update'; id: string; platform: PlatformId; patch: Record<string, unknown>; changes: EditChanges }
	/** A post the platform holds: the worker told of new text (`request`) and/or a new time (`at`). */
	| { kind: 'ask'; id: string; platform: PlatformId; request: Omit<EditRequest, 'requestedAt' | 'by'> | null; at: string | null; changes: EditChanges }
	/** A platform ticked on the edit: a new post on the upload. */
	| { kind: 'add'; platform: PlatformId }
	/** A post given another video: it goes with the new upload, and this one goes. */
	| { kind: 'replace'; id: string; platform: PlatformId; by: 'page' | 'worker' }
	/** A post unticked on the edit. */
	| { kind: 'remove'; id: string; platform: PlatformId; by: 'page' | 'worker' };

export interface EditInput {
	/** The upload's posts, read afresh at the save. */
	posts: EditPost[];
	/** The posts as loaded into the wizard, by platform: what changed is measured against them. */
	baseline: Partial<Record<PlatformId, EditState>>;
	/** The platforms that opened in the edit — the ones it may change or take away. */
	opened: PlatformId[];
	/** The wizard's posts at the save. */
	rows: EditRow[];
	now?: number;
}

/**
 * What saving an edit does, post by post, or why it cannot be saved —
 * refusals name the platform. Nothing is written unless nothing is refused,
 * so a post the worker took up since the edit opened stops the whole save
 * rather than half of it.
 */
export function planEdit({ posts, baseline, opened, rows, now = Date.now() }: EditInput): {
	steps: EditStep[];
	refused: string[];
} {
	const steps: EditStep[] = [];
	const refused: string[] = [];
	const name = (platform: PlatformId) => PLATFORMS[platform]?.label ?? platform;
	const nowIso = new Date(now).toISOString();

	for (const row of rows) {
		const post = posts.find((p) => p.platform === row.platform);
		if (!post) {
			if (row.kept) steps.push({ kind: 'add', platform: row.platform });
			// On another video the new upload carries it; nothing here to do.
			continue;
		}
		if (!opened.includes(row.platform)) {
			refused.push(`${name(row.platform)}: it was locked when the edit opened.`);
			continue;
		}
		const hold = editHold(post, now);
		if (!row.kept) {
			if ('refused' in hold) refused.push(`${name(row.platform)}: ${hold.refused}`);
			else if (hold.by === 'worker') refused.push(`${name(row.platform)}: ${name(row.platform)} has the video already; flock cannot swap it there yet.`);
			else steps.push({ kind: 'replace', id: post.id, platform: row.platform, by: hold.by });
			continue;
		}
		const base = baseline[row.platform];
		const changes = base
			? editChanges(base, row)
			: { text: true, options: Object.keys(row.options), time: true };
		if (!changedAnything(changes)) continue;
		if ('refused' in hold) {
			refused.push(`${name(row.platform)}: ${hold.refused}`);
			continue;
		}
		if (changes.time && !row.immediate) {
			const why = landReason(post, new Date(row.at), now);
			if (why) {
				refused.push(`${name(row.platform)}: ${why}`);
				continue;
			}
		}

		if (hold.by === 'page') {
			const patch: Record<string, unknown> = {
				title: row.title,
				description: row.description,
				options: row.options,
				scheduled_at: row.immediate ? nowIso : row.at
			};
			// A failed post saved again goes out again, as a Retry would send it.
			if (post.status === 'failed') Object.assign(patch, { status: 'pending', error: '', handle: null });
			steps.push({ kind: 'update', id: post.id, platform: row.platform, patch, changes });
			continue;
		}

		// The platform holds it: only what its API can change.
		if (row.immediate) {
			refused.push(`${name(row.platform)}: ${name(row.platform)} holds it for its time — release it from the Calendar's menu instead.`);
			continue;
		}
		const fixed = changes.options.filter((key) => !YOUTUBE_EDITABLE.includes(key));
		if (fixed.length > 0) {
			refused.push(
				`${name(row.platform)}: ${name(row.platform)} has the video already, so only its title, description, tags and playlists ` +
					`can change — not ${fixed.map((key) => optionLabel(row.platform, key)).join(', ')}.`
			);
			continue;
		}
		const asks = changes.text || changes.options.length > 0;
		steps.push({
			kind: 'ask',
			id: post.id,
			platform: row.platform,
			request: asks
				? {
						kind: 'edit',
						title: row.title,
						description: row.description,
						options: row.options,
						before: { title: post.title, description: post.description, options: post.options }
					}
				: null,
			at: changes.time ? row.at : null,
			changes
		});
	}

	for (const platform of opened) {
		if (rows.some((row) => row.platform === platform)) continue;
		const post = posts.find((p) => p.platform === platform);
		if (!post) continue;
		const plan = actionPlan('delete', post, now);
		if ('refused' in plan) refused.push(`${name(platform)}: not taken off — ${plan.refused}`);
		else steps.push({ kind: 'remove', id: post.id, platform, by: plan.by });
	}

	return { steps, refused };
}

/** A step in the Log's words, for the "Edited" line of its post. */
export function stepWords(step: EditStep): string {
	const name = PLATFORMS[step.platform]?.label ?? step.platform;
	const what = (changes: EditChanges) =>
		[
			changes.text ? 'text' : '',
			...changes.options.map((key) => optionLabel(step.platform, key)),
			changes.time ? 'time' : ''
		]
			.filter(Boolean)
			.join(', ');
	switch (step.kind) {
		case 'update':
			return `${name}: ${what(step.changes)} changed`;
		case 'ask':
			return `${name}: ${what(step.changes)} — the worker changes it on ${name}`;
		case 'add':
			return `${name}: added`;
		case 'replace':
			return `${name}: goes with the new video`;
		case 'remove':
			return step.by === 'worker' ? `${name}: taken off — the worker deletes it on ${name}` : `${name}: taken off`;
	}
}

/** Whether a post is being edited by the worker right now (its `request`). */
export function editing(post: { request?: unknown }): boolean {
	return readRequest(post.request)?.kind === 'edit';
}
