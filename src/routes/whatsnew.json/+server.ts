import { json } from '@sveltejs/kit';
import { CHANGES, VERSION } from '$lib/version';

// Written into the build as a file beside the page: what a page running an
// older flock reads to say what changed (stores/appupdate.svelte.ts).
export const prerender = true;

export function GET() {
	return json({ version: VERSION, changes: CHANGES });
}
