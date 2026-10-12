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
 * Since 0.11.7 flock sends neither (the worker still handles rows queued
 * before), so every upload leaves both to Studio.
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

export const STUDIO_THUMBNAIL = 'thumbnail';
export const STUDIO_COVER = 'Shorts cover';
export const STUDIO_PAID = 'paid promotion';

/**
 * What is left to set by hand in Studio after any flock upload: always the
 * thumbnail (a Short's cover for a Short) and paid promotion — flock sets
 * neither, and only the person knows whether a video has paid promotion
 * (the user's call, 12 Oct 2026: there is always something to do). A video
 * whose length is not read yet gets the plain thumbnail.
 */
export function studioTasks(seconds: number | null | undefined): string[] {
	return [isShortLength(seconds) ? STUDIO_COVER : STUDIO_THUMBNAIL, STUDIO_PAID];
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
