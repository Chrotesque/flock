import { PLATFORMS } from './platforms';
import type { StatPlatform } from './releases';

/** Names joined as words: "A", "A and B", "A, B and C". */
function words(names: string[]): string {
	return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The Dashboard's footnote for the platforms in view: what is the
 * platforms' own and what is flock's arithmetic (YouTube III.E.4.h), saying
 * only what holds for the platforms shown — a demo filtered to TikTok names
 * no other platform.
 */
export function footNote(platforms: readonly StatPlatform[], sums: boolean): string[] {
	const has = (p: StatPlatform) => platforms.includes(p);
	const out: string[] = [];
	out.push(
		platforms.length === 1
			? `Views, likes and comments are ${PLATFORMS[platforms[0]].label}'s own counters.`
			: "Views, likes and comments are each platform's own counters."
	);
	out.push(
		`${sums ? 'Sums across platforms, ' : ''}"usual", the verdicts and the curves are flock's arithmetic over them, not figures any platform reports.`
	);

	const own: string[] = [];
	if (has('facebook')) own.push("Facebook's own count for a reel");
	if (has('youtube')) own.push("YouTube Analytics' for a video");
	if (own.length) out.push(`A video's followers are ${words(own)}.`);

	const counted = (['instagram', 'tiktok'] as const).filter(has).map((p) => PLATFORMS[p].label);
	const credit = 'each rise is credited to the videos gaining views at the time';
	if (counted.length) {
		const also = has('youtube') ? ", and for YouTube's newest days" : '';
		const report = counted.length === 1 ? 'reports' : 'report';
		out.push(
			`For ${words(counted)}, which only ${report} how many an account has${also}, a video's followers are flock's estimate: ${credit}.`
		);
	} else if (has('youtube')) {
		out.push(`For YouTube's newest days they are flock's estimate: ${credit}.`);
	}

	if (has('tiktok')) out.push('TikTok lists public videos only.');
	if (has('youtube')) out.push('One channel at a time; nothing is added up across channels.');
	return out;
}
