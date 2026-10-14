/**
 * Renaming a video that is out already, as the Dashboard asked by writing a
 * `title_requests` row (src/lib/retitle.ts). Only the worker holds the
 * tokens, so the page only asks, one row per platform. Two platforms let an
 * app change a post's text once it is out:
 *
 * - YouTube: the title itself, through videos.update with the snippet
 *   written back whole (`snippetPatch`) — 51 units with the read
 * - Facebook: a reel shows its caption and nothing else, so its name is the
 *   caption's title line, the one the Dashboard shows (releases.ts
 *   `captionTitle`): that line is replaced and the rest kept
 *   (`captionWithTitle`)
 *
 * Instagram's API changes nothing on a post but whether it takes comments,
 * and TikTok's nothing at all, so the page offers neither; a row for one is
 * refused here too.
 */

export const RETITLE_PLATFORMS = ['youtube', 'facebook'];
export const YOUTUBE_TITLE_MAX = 100;

const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

/** One line, trimmed: a title has no line breaks. */
export function cleanTitle(text) {
	return String(text ?? '')
		.replace(/\s*[\r\n]+\s*/g, ' ')
		.trim();
}

/** A rename as the page wrote it, checked; `{ error }` when it cannot be done. */
export function readTitleRequest(row) {
	const text = (key) => (typeof row?.[key] === 'string' ? row[key].trim() : '');
	const platform = text('platform');
	const videoId = text('video_id');
	const title = cleanTitle(row?.title);
	if (!RETITLE_PLATFORMS.includes(platform)) {
		return { error: `flock cannot rename a post on ${NAMES[platform] ?? (platform || 'no platform')} once it is out` };
	}
	if (!videoId) return { error: 'it names no video' };
	if (!title) return { error: 'the new name is empty' };
	if (platform === 'youtube') {
		if (title.length > YOUTUBE_TITLE_MAX) return { error: `YouTube takes at most ${YOUTUBE_TITLE_MAX} characters` };
		if (/[<>]/.test(title)) return { error: 'YouTube takes no < or > in a title' };
	}
	return { platform, videoId, account: text('account'), title };
}

/**
 * What goes back as `snippet` to rename a video: videos.update resets every
 * mutable field of a part it is sent but leaves out, so it is the snippet as
 * read with only the title changed. Read-only fields (thumbnails, channel,
 * publishedAt) stay out.
 */
export function snippetPatch(snippet, title) {
	const keep = ['description', 'tags', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage'];
	const out = {};
	for (const key of keep) if (snippet?.[key] !== undefined) out[key] = snippet[key];
	return { ...out, title };
}

// Keep with releases.ts captionTitle: the line it shows is the line replaced.
const AD_LINE = /^[[(]?\s*(werbung|anzeige|ad|#ad|sponsored|bezahlte partnerschaft|paid partnership)\b/i;

/**
 * A caption with its title line — its first line that is not an ad notice or
 * a hashtag run — replaced by `title`, every other line as it was. One with
 * no such line gets the title under any ad notice it opens with.
 */
export function captionWithTitle(caption, title) {
	const lines = String(caption ?? '').split(/\r?\n/);
	const at = lines.findIndex((line) => {
		const t = line.trim();
		return Boolean(t) && !AD_LINE.test(t) && !t.startsWith('#');
	});
	if (at >= 0) {
		lines[at] = title;
		return lines.join('\n');
	}
	if (!lines.some((line) => line.trim())) return title;
	let under = 0;
	while (under < lines.length && (!lines[under].trim() || AD_LINE.test(lines[under].trim()))) under++;
	lines.splice(under, 0, title);
	return lines.join('\n');
}

/** Whether two titles are the same once spacing is left aside — what the platforms may tidy. */
export function sameTitle(a, b) {
	const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
	return norm(a) === norm(b);
}
