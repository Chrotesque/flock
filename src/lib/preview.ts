// Playing a listed video on the Upload step.
//
// A browser can reach neither list's files — the local ones are on the
// worker's PC, the NAS ones behind SMB — so the worker streams them from a
// small loopback server of its own (worker/preview.mjs) and publishes its
// address as `app_settings` / `preview_server`. These build what the player
// asks it, and put its answers into words. The worker serves a path only when
// that exact path is in its own latest listing, so the path here is a name for
// a file it already knows, never one for it to open.

export type PreviewSource = 'nas' | 'local';

function address(base: string, endpoint: string, source: PreviewSource, path: string): string {
	return `${base.replace(/\/+$/, '')}/${endpoint}?${new URLSearchParams({ source, path })}`;
}

/** Where the player's bytes come from. */
export function previewVideoUrl(base: string, source: PreviewSource, path: string): string {
	return address(base, 'video', source, path);
}

/**
 * Asked before the player is pointed anywhere: a player that cannot load its
 * source says only that it could not, and this says why.
 */
export function previewCheckUrl(base: string, source: PreviewSource, path: string): string {
	return address(base, 'check', source, path);
}

/** The worker's check refused a file; what that means to the person looking. */
export function previewProblem(error: string | undefined): string {
	switch (error) {
		case 'not-listed':
			return 'The worker has not listed this file since it started. Give it a minute and try again.';
		case 'gone':
			return 'This file is no longer there — it was moved or deleted after the list was made.';
		default:
			return `The worker would not play this file${error ? ` (${error})` : ''}.`;
	}
}

/**
 * The player gave up after the check passed, by `MediaError.code`. The file
 * exists and is streaming, so this is about the bytes, not the path.
 */
export function playbackProblem(code: number | undefined): string {
	switch (code) {
		case 2:
			return 'The stream broke off. The worker may have stopped, or the file is being written to.';
		case 3:
		case 4:
			return "This browser cannot play the file's format — HEVC video and some MKV files are the usual cause. It can still be uploaded.";
		default:
			return 'The browser could not play this file.';
	}
}
