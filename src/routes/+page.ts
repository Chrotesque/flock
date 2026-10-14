import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

// Opening flock without a route lands on the dashboard, opened over Upload
// (DashboardOverlay reads `?dashboard` and drops it from the address). The
// wizard keeps its own address at /upload so it stays linkable.
export const prerender = false;

export function load() {
	redirect(307, `${base}/upload?dashboard`);
}
