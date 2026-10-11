import { SHORT_MAX_SECONDS } from './videokind';

/**
 * What only YouTube Studio can do, found on 11 Oct 2026 with two Shorts
 * uploaded through flock:
 *
 * - Paid promotion: the API takes `paidProductPlacementDetails`, reads it
 *   back as on, and viewers never see the "Includes paid promotion" notice
 *   (the public watch page carries no `paidContentOverlay`) until it is
 *   ticked in Studio.
 * - A Short's cover: `thumbnails.set` changes only the 16:9 thumbnail. The
 *   vertical cover a Short's shelf and feed show is a frame of the video
 *   until it is set in Studio.
 *
 * The worker still sends both, in case YouTube ever honours them.
 */

/** A video's edit page in YouTube Studio, where both are set. */
export function studioUrl(videoId: string): string {
	return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`;
}

/** The video id out of a watch or Shorts address; '' when there is none. */
export function videoIdOf(url: string | undefined): string {
	const match = /(?:[?&]v=|\/shorts\/)([\w-]+)/.exec(url ?? '');
	return match ? match[1] : '';
}

/**
 * Whether a video of this many seconds is a Short (up to three minutes),
 * or null when its length is not known — a watch-folder pick has none
 * before upload.
 */
export function isShortLength(seconds: number | null | undefined): boolean | null {
	const s = Number(seconds);
	if (!(s > 0)) return null;
	return s <= SHORT_MAX_SECONDS;
}

export const STUDIO_PAID = 'paid promotion';
export const STUDIO_COVER = 'Shorts cover';

/**
 * What has to be set by hand in Studio for an upload: paid promotion when
 * ticked, and the cover when a thumbnail was picked for a Short — or for a
 * video whose length is not known yet, which is more likely a Short than not
 * here.
 */
export function studioTasks(paidPromotion: boolean, hasThumbnail: boolean, seconds: number | null | undefined): string[] {
	const tasks: string[] = [];
	if (paidPromotion) tasks.push(STUDIO_PAID);
	if (hasThumbnail && isShortLength(seconds) !== false) tasks.push(STUDIO_COVER);
	return tasks;
}

/** The same, said before upload on the Review and Details steps, one line each. */
export function studioNotes(paidPromotion: boolean, hasThumbnail: boolean, seconds: number | null | undefined): string[] {
	const notes: string[] = [];
	if (paidPromotion) {
		notes.push("Tick paid promotion in YouTube Studio after upload: YouTube's API takes it but does not apply it.");
	}
	if (hasThumbnail) {
		const short = isShortLength(seconds);
		if (short) {
			notes.push("Set the Short's cover in Studio after upload: flock's image only becomes the 16:9 thumbnail.");
		} else if (short === null) {
			notes.push("If this is a Short, set its cover in Studio after upload: flock's image only becomes the 16:9 thumbnail.");
		}
	}
	return notes;
}
