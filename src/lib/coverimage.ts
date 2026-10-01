import type { PlatformId } from './types';

/**
 * One image, two names: YouTube calls it a thumbnail, Instagram a reel cover.
 * The compose screen picks it once and it goes to whichever of the two the
 * upload serves. Each still has its own cap, so the image is checked against
 * every platform it would go to, and a platform it does not fit picks a
 * frame instead — said beside the picker, never decided silently at confirm.
 */
export type ImagePlatform = 'youtube' | 'instagram';

export const IMAGE_PLATFORMS: readonly ImagePlatform[] = ['youtube', 'instagram'];

interface Limit {
	bytes: number;
	types: readonly string[];
	formats: string;
	/** What the platform does when it gets no image. */
	fallback: string;
}

export const IMAGE_LIMITS: Record<ImagePlatform, Limit> = {
	youtube: {
		bytes: 2 * 1024 * 1024,
		types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
		formats: 'JPEG, PNG, GIF or WebP',
		fallback: 'picks a frame'
	},
	instagram: {
		bytes: 8 * 1024 * 1024,
		types: ['image/jpeg', 'image/png'],
		formats: 'JPEG or PNG',
		fallback: 'uses the frame at the cover time'
	}
};

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
