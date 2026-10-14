/**
 * Carrying out a move to another brand's account, which the page asked for
 * by writing `move` on a post (src/lib/brandmove.ts). The worker is the one
 * that does it because it holds the tokens and is the only one claiming
 * rows: nothing else ever changes `account`, so a row never claims it went
 * out as an account it did not.
 *
 * What happens is decided from the row as it is now, not as it was when the
 * page asked — it may have been claimed or published in between:
 *
 * - `switch`  nothing on the platform yet: the account changes, that is all
 * - `replace` a YouTube video or Facebook reel on the old account: deleted
 *             there first, then queued again for the new account
 * - `repost`  a live Instagram reel, which flock cannot delete: queued again
 *             for the new account, the old one left to delete by hand
 * - `wait`    being published right now: asked again on the next tick (an
 *             Instagram reel held for its minute stops itself before posting)
 * - `drop`    nothing to do, or nothing flock can do: the request is cleared
 */

/** A move as the page wrote it, field by field; null when there is none. */
export function readMove(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const text = (key) => (typeof raw[key] === 'string' ? raw[key] : '');
	return {
		to: text('to'),
		toName: text('toName'),
		from: text('from'),
		brand: text('brand'),
		brandName: text('brandName') || 'another brand',
		requestedAt: text('requestedAt'),
		by: text('by')
	};
}

/** The video id in a YouTube link: watch?v=, youtu.be/ or /shorts/. */
export function youtubeVideoId(url) {
	const match = /(?:[?&]v=|youtu\.be\/|\/shorts\/)([\w-]{11})(?![\w-])/.exec(String(url ?? ''));
	return match ? match[1] : '';
}

/** The video id of a Facebook reel: the handle's, else the one in its link. */
export function facebookVideoId(row) {
	const fromHandle = row?.handle?.videoId;
	if (fromHandle) return String(fromHandle);
	const match = /\/(?:reel|videos)\/(\d+)/.exec(String(row?.remote_url ?? ''));
	return match ? match[1] : '';
}

/**
 * What to do with a row carrying a move. `held` says this worker is
 * publishing it right now (its `inHand`).
 */
export function moveStep(row, { held = false } = {}) {
	const move = readMove(row?.move);
	if (!move) return { action: 'none' };
	if (!move.to) return { action: 'drop', move, reason: 'it names no account to move to' };
	if ((row.account ?? '') === move.to) return { action: 'drop', move, reason: 'it goes out as that account already' };
	if (row.platform === 'tiktok') return { action: 'drop', move, reason: 'TikTok posts are not moved' };
	if (held || row.status === 'publishing') return { action: 'wait', move };

	const sent = row.status === 'scheduled' || row.status === 'published' || Boolean(row.remote_url);
	if (!sent) return { action: 'switch', move };

	if (row.platform === 'youtube') {
		const remoteId = youtubeVideoId(row.remote_url);
		return remoteId ? { action: 'replace', move, remoteId } : { action: 'drop', move, reason: 'its YouTube link names no video' };
	}
	if (row.platform === 'facebook') {
		const remoteId = facebookVideoId(row);
		return remoteId ? { action: 'replace', move, remoteId } : { action: 'drop', move, reason: 'it names no Facebook video' };
	}
	if (row.platform === 'instagram') return { action: 'repost', move };
	return { action: 'drop', move, reason: `${row.platform} posts are not moved` };
}

/** The row queued again for the new account, as if it had just been confirmed for it. */
export function requeuePatch(to) {
	return { account: to, status: 'pending', remote_url: '', handle: null, error: '', published_at: '', move: null };
}
