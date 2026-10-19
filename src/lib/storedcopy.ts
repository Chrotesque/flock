// The Dashboard's player: where an opened video plays from.
//
// Every upload with a destination folder is copied to the NAS (worker/
// archive.mjs), and the publishing worker plays those copies to the page
// (worker/storedcopy.mjs) from the address it publishes as `app_settings` /
// `stored_player`. An upload sent from the browser also still has its file in
// PocketBase, which plays with no worker at all. These decide what to ask
// for, and put every reason for nothing to play into words.

/** What the player reads of an upload. */
export interface PlayerJob {
	id: string;
	collectionId: string;
	collectionName: string;
	/** The file PocketBase holds, '' for a folder pick. */
	video: string;
	video_name: string;
	video_size: number;
	destination_path: string;
	stored_path?: string;
	status: string;
}

export type StoredCopy = { state: 'stored'; path: string } | { state: 'pending' } | { state: 'none' };

/** A typed path under a typed folder, joined the way the folder is written. */
function typedJoin(folder: string, name: string): string {
	const base = folder.trim().replace(/[\\/]+$/, '');
	return `${base}${base.includes('\\') ? '\\' : '/'}${name}`;
}

/**
 * Where the upload's NAS copy is, as typed — the path the worker recorded,
 * or for a copy made before it did, the folder and the video's name (the
 * worker guesses the same and checks the size) — else `pending` while it has
 * not been copied, `none` with no destination folder.
 */
export function copyOf(job: Pick<PlayerJob, 'destination_path' | 'stored_path' | 'status' | 'video_name' | 'video'>): StoredCopy {
	const folder = (job.destination_path ?? '').trim();
	if (!folder) return { state: 'none' };
	const recorded = (job.stored_path ?? '').trim();
	if (recorded) return { state: 'stored', path: recorded };
	const name = (job.video_name || job.video || '').trim();
	return job.status === 'done' && name ? { state: 'stored', path: typedJoin(folder, name) } : { state: 'pending' };
}

/** The end of a typed path to show under the player: its folder and file. */
export function shortPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.slice(-2).join(path.includes('\\') ? '\\' : '/');
}

/**
 * Whether the page cannot use an address at all: an https page may not play
 * from plain http (mixed content), except from the loopback address, which
 * browsers trust.
 */
export function mixedContent(pageProtocol: string, url: string): boolean {
	if (pageProtocol !== 'https:') return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'http:') return false;
	return !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}

/** The player's height for an upright video, and width for a wide one. */
export const TALL = 352;
export const WIDE = 432;

/** The player's box for a video of this shape (width ÷ height), in pixels. */
export function playerBox(ratio: number): { width: number; height: number } {
	const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
	if (r < 1) return { width: Math.max(140, Math.round(TALL * r)), height: TALL };
	return { width: WIDE, height: Math.min(TALL, Math.round(WIDE / r)) };
}

export interface Reason {
	title: string;
	text: string;
}

/** Why the worker would not play an upload's copy, by its check's answer. */
export function storedProblem(error: string | undefined): Reason {
	switch (error) {
		case 'no-job':
			return { title: 'No copy on the NAS', text: 'Its upload was deleted from flock.' };
		case 'not-stored':
			return { title: 'Not on the NAS yet', text: 'The worker copies it into its folder once it has gone out.' };
		case 'gone':
			return { title: 'Not on the NAS any more', text: 'Nothing is at its path now: it was moved or deleted.' };
		case 'differs':
			return {
				title: 'Can’t tell which copy',
				text: 'Files with its name are in its folder, but none has its size.'
			};
		case 'refused':
			return { title: 'Will not play', text: 'Its recorded path is not a video in its destination folder.' };
		default:
			return { title: 'Can’t play right now', text: `The worker would not play it${error ? ` (${error})` : ''}.` };
	}
}

export const NO_DESTINATION: Reason = {
	title: 'No copy on the NAS',
	text: 'This upload had no destination folder.'
};

export const NOT_FLOCK: Reason = { title: 'No copy on the NAS', text: 'Not uploaded through flock.' };

export const NO_PLAYER: Reason = {
	title: 'Can’t play right now',
	text: 'The NAS worker has not offered its player yet: it needs previewUrl in its config.'
};

/** The player gave up on bytes the worker did send, by `MediaError.code`. */
export function playbackReason(code: number | undefined): Reason {
	switch (code) {
		case 2:
			return { title: 'The stream broke off', text: 'The worker may have stopped. Close the row and open it again.' };
		case 3:
		case 4:
			return {
				title: 'Can’t play this format',
				text: "This browser cannot play the file's format; HEVC video and some MKV files are the usual cause."
			};
		default:
			return { title: 'Can’t play it', text: 'The browser could not play this file.' };
	}
}

export function notAnswering(url: string): Reason {
	return { title: 'Can’t play right now', text: `The NAS worker is not answering at ${url}.` };
}

export function blockedAddress(url: string): Reason {
	return {
		title: 'Can’t play from here',
		text: `This page is https, so the browser will not play from ${url}. Put Tailscale Serve in front of it and set previewUrl to that address.`
	};
}
