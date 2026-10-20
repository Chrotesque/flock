import type { PlatformId } from './types';

/**
 * The cover image: the reel covers of Instagram and Facebook, the platforms
 * whose APIs take a picture. Facebook joined in v0.16.2, once a test reel
 * showed its cover on the Page's Reels tab (14 Oct 2026). YouTube's
 * thumbnail was dropped in v0.11.7 (the user's call): `thumbnails.set` only
 * ever changed a Short's 16:9 thumbnail, never the cover the Shorts feed
 * shows (studio.ts). TikTok's Direct Post API takes only a cover *time*
 * (`video_cover_timestamp_ms`, checked 11 Oct 2026), so since v0.16.44 its
 * image is put into the video itself — held 0.2 s at the end (the default)
 * or the beginning, the cover time pointed at it (worker/tiktokcover.mjs).
 * TikTok has no picker of its own since v0.16.45 (the user's call): it
 * takes the picture picked for Instagram or Facebook (`imageSlot`), and its
 * Cover box only says where in the video it goes. The image is checked against every platform it would go to, and one it
 * does not fit uses its frame instead — said beside the picker, never
 * decided silently at confirm.
 */
export type ImagePlatform = 'instagram' | 'facebook' | 'tiktok';

export const IMAGE_PLATFORMS: readonly ImagePlatform[] = ['instagram', 'facebook', 'tiktok'];

/** The platforms the Cover box picks a picture for; TikTok takes one of theirs. */
export const PICKED_PLATFORMS: readonly ImagePlatform[] = ['instagram', 'facebook'];

const NAMES: Record<ImagePlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };

/** The draft's two pictures: `thumbnail` (the name pastes and saved drafts use) and `cover`. */
export type ImageSlot = 'thumbnail' | 'cover';

/**
 * Which picture a platform gets. Linked, all get `thumbnail`; unlinked,
 * Instagram gets `cover` and Facebook keeps `thumbnail`, and TikTok takes
 * Instagram's when Instagram is in the upload, else Facebook's.
 */
export function imageSlot(platform: ImagePlatform, linked: boolean, active: readonly PlatformId[]): ImageSlot {
	if (linked) return 'thumbnail';
	if (platform === 'instagram') return 'cover';
	if (platform === 'tiktok') return active.includes('instagram') ? 'cover' : 'thumbnail';
	return 'thumbnail';
}

export interface ImageGroup {
	slot: ImageSlot;
	platforms: ImagePlatform[];
}

/** The pictures an upload carries, each with the platforms it goes to, in `active`'s order. */
export function imageGroups(active: readonly PlatformId[], linked: boolean): ImageGroup[] {
	const groups: ImageGroup[] = [];
	for (const platform of active) {
		if (!isImagePlatform(platform)) continue;
		const slot = imageSlot(platform, linked, active);
		const group = groups.find((g) => g.slot === slot);
		if (group) group.platforms.push(platform);
		else groups.push({ slot, platforms: [platform] });
	}
	return groups;
}

/** Where TikTok's cover image comes from, in words, for its Cover box. */
export function tiktokImageNote(
	active: readonly PlatformId[],
	linked: boolean,
	file: { name: string; type: string; size: number } | null
): string {
	const picked = PICKED_PLATFORMS.filter((p) => active.includes(p)).map((p) => NAMES[p]);
	if (file) {
		const from = !linked
			? `${NAMES[active.includes('instagram') ? 'instagram' : 'facebook']}'s cover`
			: picked.length > 0
				? `the cover picked for ${picked.join(' and ')}`
				: 'the cover image';
		const problem = imageProblem(file, 'tiktok');
		return problem
			? `${from[0].toUpperCase()}${from.slice(1)}, ${file.name}, does not fit TikTok (${problem}), so TikTok uses its cover frame.`
			: `Uses ${from}: ${file.name}.`;
	}
	if (picked.length > 0) {
		return `No cover image yet: pick one while writing for ${picked.join(' or ')}. Without one, TikTok uses its cover frame.`;
	}
	return 'TikTok takes the cover image picked for Instagram or Facebook. Neither is in this upload, so it uses its cover frame.';
}

interface Limit {
	bytes: number;
	types: readonly string[];
	formats: string;
	/** What the platform does when it gets no image. */
	fallback: string;
}

export const IMAGE_LIMITS: Record<ImagePlatform, Limit> = {
	instagram: {
		bytes: 8 * 1024 * 1024,
		types: ['image/jpeg', 'image/png'],
		formats: 'JPEG or PNG',
		fallback: 'uses the frame at the cover time'
	},
	// POST /{video_id}/thumbnails: 10 MB, formats unstated — JPEG proven,
	// PNG the other format every Meta image upload takes.
	facebook: {
		bytes: 10 * 1024 * 1024,
		types: ['image/jpeg', 'image/png'],
		formats: 'JPEG or PNG',
		fallback: 'shows a frame it picks'
	},
	// Put into the video by the worker with ffmpeg; the cap is flock's own.
	tiktok: {
		bytes: 10 * 1024 * 1024,
		types: ['image/jpeg', 'image/png'],
		formats: 'JPEG or PNG',
		fallback: 'uses the frame at the cover time'
	}
};

/** The TikTok option saying where its cover image goes in the video. */
export const COVER_AT_OPTION = 'coverImageAt';
export type CoverAt = 'start' | 'end';

/** Where TikTok's cover image goes: the end unless the upload chose the beginning. */
export function coverAt(overrides: Partial<Record<PlatformId, Record<string, unknown>>>): CoverAt {
	return overrides.tiktok?.[COVER_AT_OPTION] === 'start' ? 'start' : 'end';
}

/** The upload's options with TikTok's cover image placed at `at`. */
export function withCoverAt<T extends Record<string, unknown>>(
	overrides: Partial<Record<PlatformId, T>>,
	at: CoverAt
): Partial<Record<PlatformId, T>> {
	return { ...overrides, tiktok: { ...(overrides.tiktok ?? {}), [COVER_AT_OPTION]: at } as unknown as T };
}

export function isImagePlatform(platform: PlatformId): platform is ImagePlatform {
	return (IMAGE_PLATFORMS as readonly string[]).includes(platform);
}

/** Why `file` cannot go to `platform`, or '' when it can. */
export function imageProblem(file: { type: string; size: number }, platform: ImagePlatform): string {
	const limit = IMAGE_LIMITS[platform];
	if (!limit.types.includes(file.type)) return `${limit.formats} only`;
	if (file.size > limit.bytes) return `over its ${limit.bytes / 1024 / 1024} MB limit`;
	return '';
}

/** Whether the image goes to `platform` at all. */
export function imageFits(file: { type: string; size: number } | null, platform: ImagePlatform): boolean {
	return Boolean(file) && imageProblem(file!, platform) === '';
}

/**
 * What the picker accepts from the file dialog: everything any of the
 * platforms takes, so an image good for one is never refused outright.
 */
export function acceptedTypes(platforms: readonly ImagePlatform[]): string[] {
	const list = platforms.length > 0 ? platforms : IMAGE_PLATFORMS;
	return [...new Set(list.flatMap((p) => IMAGE_LIMITS[p].types))];
}

/** The largest image any of them takes, for refusing one nobody would. */
export function largestAccepted(platforms: readonly ImagePlatform[]): number {
	const list = platforms.length > 0 ? platforms : IMAGE_PLATFORMS;
	return Math.max(...list.map((p) => IMAGE_LIMITS[p].bytes));
}
