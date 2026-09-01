import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

// Opening flock without a route lands on Analytics. The wizard keeps its own
// address at /upload so it stays linkable and bookmarkable.
export const prerender = false;

export function load() {
	redirect(307, `${base}/analytics`);
}
