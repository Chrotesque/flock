import type { PollRun, StatsSample } from './types';

export type { PollRun };

/**
 * Views per hour from release to the first hour without a single view.
 *
 * - `settled`: that quiet hour was observed, so the number is final.
 * - `running`: watched from release and still getting views every hour, so
 *   the number is the rate so far and will keep moving until it settles.
 * - `lifetime`: flock was not watching from release, so the first quiet hour
 *   cannot be known. Views over the whole time since release instead.
 * - `none`: not released yet, or nothing to count.
 */
export type LaunchRate =
	| { mode: 'settled'; rate: number; views: number; hours: number; quietAt: string }
	| { mode: 'running'; rate: number; views: number; hours: number }
	| { mode: 'lifetime'; rate: number; views: number; hours: number }
	| { mode: 'none' };

const HOUR = 3_600_000;

/** Whether one run spans [from, to], allowing `slack` at either end for the poll interval. */
export function covered(runs: PollRun[], from: number, to: number, slack = 0): boolean {
	return runs.some((run) => {
		const start = Date.parse(run.from);
		const end = Date.parse(run.to);
		return Number.isFinite(start) && Number.isFinite(end) && start - slack <= from && end + slack >= to;
	});
}

export function launchRate(
	video: { published_at: string; views: number | null; history: StatsSample[] | undefined },
	runs: PollRun[],
	now: number,
	slack = 120_000
): LaunchRate {
	const released = Date.parse(video.published_at);
	if (!Number.isFinite(released) || released > now || video.views == null) return { mode: 'none' };

	// Every moment the counters were seen to move after release, with release
	// itself at zero. Samples from before release belong to the private phase
	// of a scheduled upload and say nothing about the launch.
	const points: { t: number; views: number }[] = [{ t: released, views: 0 }];
	for (const [iso, views] of video.history ?? []) {
		const t = Date.parse(iso);
		if (Number.isFinite(t) && t > released && views != null) points.push({ t, views });
	}

	for (let i = 0; i < points.length; i++) {
		const next = i + 1 < points.length ? points[i + 1].t : now;
		if (next - points[i].t < HOUR) continue;
		// A quiet hour began here. It is the *first* one only if the worker was
		// watching the whole way from release to the end of it.
		if (!covered(runs, released, points[i].t + HOUR, slack)) break;
		const hours = (points[i].t - released) / HOUR;
		return {
			mode: 'settled',
			rate: hours > 0 ? points[i].views / hours : 0,
			views: points[i].views,
			hours,
			quietAt: new Date(points[i].t).toISOString()
		};
	}

	const hours = (now - released) / HOUR;
	const rate = hours > 0 ? video.views / hours : 0;
	if (covered(runs, released, now, slack)) return { mode: 'running', rate, views: video.views, hours };
	return { mode: 'lifetime', rate, views: video.views, hours };
}
