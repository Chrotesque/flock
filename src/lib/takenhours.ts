import { hourOf, isoDate, makeTime } from './format';
import type { PlatformId } from './types';

/**
 * An hour of the schedule belongs to one video of a brand (the user's rule,
 * 22 Oct 2026): once one of its videos goes out in an hour, on any
 * platform, no other video of that brand may go out in that hour. The
 * upload's own posts share their hour as they always did, and another
 * brand's posts do not count.
 */

/** A post with a slot, as `loadTakenPosts` reads it. */
export interface SlotPost {
	id: string;
	job: string;
	platform: PlatformId;
	status: string;
	scheduled_at: string;
	title: string;
	description: string;
	/** The job's brand id. */
	brand: string;
}

/** The grid's key for an hour: the local date and the hour of the day. */
export function hourKey(date: string, hour: number): string {
	return `${date}#${hour}`;
}

const HOUR_MS = 3_600_000;

/**
 * The hours a brand's other videos hold, by `hourKey` in local time. A
 * cancelled post holds nothing; a failed one keeps its hour, since Retry
 * sends it at its slot. An hour already over is left out, but the one we are
 * in still counts — a video out at 10:05 holds 10:00 to 11:00. `exclude`
 * names jobs of the upload being made, written by a confirm that failed
 * part-way.
 */
export function takenHours(
	posts: SlotPost[],
	brand: string,
	{ exclude = [], now = Date.now() }: { exclude?: string[]; now?: number } = {}
): Map<string, SlotPost[]> {
	const taken = new Map<string, SlotPost[]>();
	if (!brand) return taken;
	for (const post of posts) {
		if (post.brand !== brand || post.status === 'cancelled' || exclude.includes(post.job)) continue;
		const at = new Date(post.scheduled_at);
		if (Number.isNaN(at.getTime())) continue;
		const start = new Date(at);
		start.setMinutes(0, 0, 0);
		if (start.getTime() + HOUR_MS <= now) continue;
		const key = hourKey(isoDate(at), at.getHours());
		const list = taken.get(key);
		if (list) list.push(post);
		else taken.set(key, [post]);
	}
	return taken;
}

/** What a video is called here: a title, else its caption's first line, cut short. */
function nameOf(posts: SlotPost[]): string {
	const text =
		posts.find((post) => post.title.trim())?.title ??
		posts.map((post) => post.description.split('\n')[0]).find((line) => line.trim()) ??
		'';
	const name = text.trim();
	if (!name) return 'a video';
	return `“${name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name}”`;
}

/** Why an hour is taken, in words: each video in it with the time it goes out. */
export function takenWhy(posts: SlotPost[]): string {
	const byJob = new Map<string, SlotPost[]>();
	for (const post of posts) {
		const list = byJob.get(post.job);
		if (list) list.push(post);
		else byJob.set(post.job, [post]);
	}
	const videos = [...byJob.values()]
		.map((list) => ({ list, at: Math.min(...list.map((post) => Date.parse(post.scheduled_at))) }))
		.sort((a, b) => a.at - b.at)
		.map(({ list, at }, index) => {
			const when = new Date(at);
			const time = makeTime(when.getHours(), when.getMinutes());
			return index === 0 ? `${nameOf(list)} goes out at ${time}` : `${nameOf(list)} at ${time}`;
		});
	return `This hour is taken: ${videos.join(', ')}.`;
}

/** A platform's slot in the upload being made; an immediate one is now. */
export interface DraftSlot {
	platform: PlatformId;
	date: string;
	time: string;
}

/** The platforms whose slot falls in a taken hour. */
export function clashing(slots: DraftSlot[], taken: Map<string, SlotPost[]>): PlatformId[] {
	return slots.filter((slot) => taken.has(hourKey(slot.date, hourOf(slot.time)))).map((slot) => slot.platform);
}
