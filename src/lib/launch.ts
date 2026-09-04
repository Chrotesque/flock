import type { PollRun, StatsSample } from './types';

export type { PollRun };

/**
 * Views per hour over a fixed window after release, chosen on the screen.
 *
 * Every video is normalised to the same first N hours, which is what makes
 * one Short comparable with another: the window is explicit, the same for
 * all, and closed for good once those hours have passed. Nothing that
 * happens afterwards can move it.
 *
 * - `settled`: the window has closed and the worker watched it whole, so the
 *   number is final.
 * - `running`: watched from release, but the window is still open, so the
 *   number is the rate so far and will move until it closes.
 * - `lifetime`: flock was not watching from release, so the window cannot be
 *   known. Views over the whole time since release instead.
 * - `none`: not released yet, or nothing to count.
 */
export type LaunchRate =
	| { mode: 'settled'; rate: number; views: number; hours: number; until: string }
	| { mode: 'running'; rate: number; views: number; hours: number }
	| { mode: 'lifetime'; rate: number; views: number; hours: number }
	| { mode: 'none' };

/** The windows offered, in hours. */
export const WINDOWS = [3, 6, 9, 12, 24] as const;
export type WindowHours = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: WindowHours = 3;

const HOUR = 3_600_000;

/** Whether one run spans [from, to], allowing `slack` at either end for the poll interval. */
export function covered(runs: PollRun[], from: number, to: number, slack = 0): boolean {
	return runs.some((run) => {
		const start = Date.parse(run.from);
		const end = Date.parse(run.to);
		return Number.isFinite(start) && Number.isFinite(end) && start - slack <= from && end + slack >= to;
	});
}

interface Point {
	t: number;
	views: number;
}

/** Views at an instant: the last sample at or before it. Samples are a step function. */
function viewsAt(points: Point[], t: number): number {
	let views = 0;
	for (const point of points) {
		if (point.t > t) break;
		views = point.views;
	}
	return views;
}

export function launchRate(
	video: { published_at: string; views: number | null; history: StatsSample[] | undefined },
	runs: PollRun[],
	now: number,
	hours: number,
	slack = 120_000
): LaunchRate {
	const released = Date.parse(video.published_at);
	if (!Number.isFinite(released) || released > now || video.views == null) return { mode: 'none' };
	if (!(hours > 0)) return { mode: 'none' };

	// Every moment the counters were seen to move after release, with release
	// itself at zero. Samples from before release belong to the private phase
	// of a scheduled upload and say nothing about the launch.
	const points: Point[] = [{ t: released, views: 0 }];
	for (const [iso, views] of video.history ?? []) {
		const t = Date.parse(iso);
		if (Number.isFinite(t) && t > released && views != null) points.push({ t, views });
	}
	points.sort((a, b) => a.t - b.t);

	const elapsed = (now - released) / HOUR;
	const lifetime: LaunchRate = {
		mode: 'lifetime',
		rate: elapsed > 0 ? video.views / elapsed : 0,
		views: video.views,
		hours: elapsed
	};

	const end = released + hours * HOUR;
	if (now >= end) {
		// Final only if the worker watched the whole window — a gap in polling
		// would silently drop the views that arrived during it.
		if (!covered(runs, released, end, slack)) return lifetime;
		const views = viewsAt(points, end);
		return { mode: 'settled', rate: views / hours, views, hours, until: new Date(end).toISOString() };
	}

	if (!covered(runs, released, now, slack)) return lifetime;
	return { mode: 'running', rate: lifetime.rate, views: video.views, hours: elapsed };
}
