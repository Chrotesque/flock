import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

// Analytics became part of the dashboard (0.16.3); an old link or bookmark
// opens that instead.
export const prerender = false;

export function load() {
	redirect(307, `${base}/upload?dashboard`);
}
