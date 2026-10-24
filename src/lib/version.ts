// MAJOR.FEATURE.ITERATION — see the versioning rules in CLAUDE.md.
// Shown beside the Settings page title.
export const VERSION = '0.18.10';

export interface Change {
	version: string;
	/** What changed, as short as a commit summary: "Added: Log > Sub Filtering". */
	line: string;
}

/**
 * What each version changed, newest first, one line a version (two at
 * most), written for the people using flock. A page running an older build
 * reads the deployed list (`whatsnew.json`) and shows the lines it lacks in
 * "Update available!" (appupdate.ts), so every bump adds its line here — a
 * test holds that. Keep the newest twenty or so.
 */
export const CHANGES: Change[] = [{ version: '0.18.10', line: 'Added: Update > What Changed' }];
