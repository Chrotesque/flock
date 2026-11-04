/**
 * The largest video file each platform's publishing API takes, said on the
 * Review step before anything is sent (the worker refuses the same: see
 * MAX_BYTES in worker/instagram.mjs and worker/tiktok.mjs). Facebook's Reels
 * Publishing API names no file size, only a length (facebook.ts).
 */
import type { PlatformId } from './types';

const MB = 1000 * 1000;
const MiB = 1024 * 1024;

/** Bytes, as each platform's reference states it; absent where none is named. */
export const FILE_LIMITS: Partial<Record<PlatformId, number>> = {
	// IG User Media, Reel specifications: "File size: 300MB maximum".
	instagram: 300 * MB,
	// Content Posting API, media transfer guide: 4 GB.
	tiktok: 4 * 1024 * MiB,
	// YouTube's upload limit: 256 GB.
	youtube: 256 * 1024 * MiB
};

/** A size in words: "354 MB", "4 GB". */
export function sizeWords(bytes: number): string {
	if (bytes >= 1000 * MB) return `${(bytes / (1000 * MB)).toFixed(bytes % (1000 * MB) === 0 ? 0 : 1)} GB`;
	return `${Math.round(bytes / MB)} MB`;
}

/** Why a platform would refuse a video of this size; empty when it would take it, or the size is not known. */
export function sizeProblems(platform: PlatformId, bytes: number): string[] {
	const limit = FILE_LIMITS[platform];
	if (!limit || !(bytes > limit)) return [];
	return [
		`This video is ${sizeWords(bytes)}, and ${platformName(platform)} takes files of up to ${sizeWords(limit)}. Export a smaller file for it, or untick it.`
	];
}

function platformName(platform: PlatformId): string {
	return platform === 'tiktok' ? 'TikTok' : platform === 'youtube' ? 'YouTube' : platform === 'instagram' ? 'Instagram' : 'Facebook';
}
