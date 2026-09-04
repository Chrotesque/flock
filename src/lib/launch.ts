import type { PollRun, StatsSample } from './types';

export type { PollRun };

/**
 * Views per hour over the launch: from release until the burst faded.
 *
 * "Faded" is the first full hour that gained no more than a tenth of the
 * video's best hour so far. That is fixed by the early data alone, so late
 * trickle cannot move it — where "until 90% of the views" would drift every
 * time the total crept up. A best hour under `MIN_PEAK` is not a burst yet,
 * so a slow starter keeps waiting for one; after `LAUNCH_CAP_HOURS` the wait
 * ends and the first two days stand as the launch.
 *
 * - `settled`: the fade (or the cap) was observed, so the number is final.
 * - `running`: watched from release and the burst has not faded yet, so the
 *   number is the rate so far and will keep moving until it settles.
 * - `lifetime`: flock was not watching from release, so the burst cannot be
 *   known. Views over the whole time since release instead.
 * - `none`: not released yet, or nothing to count.
 */
export type LaunchRate =
	| { mode: 'settled'; rate: number; views: number; hours: number; until: string }
	| { mode: 'running'; rate: number; views: number; hours: number }
	| { mode: 'lifetime'; rate: number; views: number; hours: number }
	| { mode: 'none' };

const HOUR = 3_600_000;

/** An hour gaining no more than this share of the best hour ends the launch. */
export const TRICKLE_SHARE = 0.1;
/** A best hour under this is not a burst; keep waiting for one. */
export const MIN_PEAK = 10;
/** Stop waiting here and take the first two days as the launch. */
export const LAUNCH_CAP_HOURS = 48;

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

/** Views gained in each full hour since release, for the first `hours` of them. */
export function hourlyGains(points: Point[], released: number, hours: number): number[] {
	const gains: number[] = [];
	for (let h = 0; h < hours; h++) {
		gains.push(viewsAt(points, released + (h + 1) * HOUR) - viewsAt(points, released + h * HOUR));
	}
	return gains;
}

/**
 * The hour the launch ended: the first full hour, after the best one so far,
 * that gained no more than a tenth of it. -1 while the burst is still going.
 */
export function launchEnd(gains: number[]): number {
	let peak = -1;
	for (let h = 0; h < gains.length; h++) {
		if (peak === -1 || gains[h] > gains[peak]) {
			peak = h;
			continue;
		}
		if (gains[peak] >= MIN_PEAK && gains[h] <= Math.max(1, gains[peak] * TRICKLE_SHARE)) return h;
	}
	return -1;
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
	const points: Point[] = [{ t: released, views: 0 }];
	for (const [iso, views] of video.history ?? []) {
		const t = Date.parse(iso);
		if (Number.isFinite(t) && t > released && views != null) points.push({ t, views });
	}
	points.sort((a, b) => a.t - b.t);

	const fullHours = Math.min(Math.floor((now - released) / HOUR), LAUNCH_CAP_HOURS);
	const gains = hourlyGains(points, released, fullHours);
	let end = launchEnd(gains);
	if (end === -1 && fullHours >= LAUNCH_CAP_HOURS) end = LAUNCH_CAP_HOURS;

	const lifetimeHours = (now - released) / HOUR;
	const lifetime: LaunchRate = {
		mode: 'lifetime',
		rate: lifetimeHours > 0 ? video.views / lifetimeHours : 0,
		views: video.views,
		hours: lifetimeHours
	};

	if (end !== -1) {
		const until = released + end * HOUR;
		// Final only if the worker watched the whole way from release through
		// the hour that ended it — a gap in polling looks exactly like a fade.
		const through = end === LAUNCH_CAP_HOURS ? until : until + HOUR;
		if (!covered(runs, released, through, slack)) return lifetime;
		const views = viewsAt(points, until);
		return {
			mode: 'settled',
			rate: end > 0 ? views / end : 0,
			views,
			hours: end,
			until: new Date(until).toISOString()
		};
	}

	if (!covered(runs, released, now, slack)) return lifetime;
	return { mode: 'running', rate: lifetime.rate, views: video.views, hours: lifetimeHours };
}
