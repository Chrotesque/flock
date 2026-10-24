// Followers per video, for the Dashboard. YouTube and Instagram report a
// channel's or an account's follower count, never which video brought a
// follower, so the moment the count rose is the indicator: each rise is
// credited to the videos that gained views in that stretch, in proportion to
// those views (the newest video when none did). Facebook counts follows per
// reel itself (fbstats.mjs), so this is not used for it.
//
// One `app_settings` row per account, `followers:<platform>:<account id>`,
// written by the pass that reads that platform: the count, when it was read
// and first read, its history (a sample only when it changed) and the
// followers credited so far, by the platform's post id. A rise counts only
// past the highest count of the last day, so a count served by caches that
// disagree (YouTube's view counts do) cannot credit the same follower twice
// — the price is a follower lost and won back within the day, not credited.

/** Samples kept per account; one is written only when the count changed. */
export const HISTORY_CAP = 2000;
/** A rise is measured against the highest count of this long. */
export const HIGH_WINDOW_MS = 24 * 60 * 60 * 1000;

export function settingKey(platform, account) {
	return `followers:${platform}:${account}`;
}

const time = (iso) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/** A stored row's value rebuilt field by field; null when it is no follower record. */
export function readState(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? raw.count : null;
	if (count === null || !Number.isFinite(time(raw.at))) return null;
	const history = (Array.isArray(raw.history) ? raw.history : []).filter(
		(s) => Array.isArray(s) && Number.isFinite(time(s[0])) && typeof s[1] === 'number'
	);
	const credits = {};
	for (const [id, n] of Object.entries(raw.credits && typeof raw.credits === 'object' ? raw.credits : {})) {
		if (typeof n === 'number' && n > 0) credits[id] = n;
	}
	return {
		platform: String(raw.platform ?? ''),
		account: String(raw.account ?? ''),
		name: String(raw.name ?? ''),
		count,
		at: String(raw.at),
		since: Number.isFinite(time(raw.since)) ? String(raw.since) : String(raw.at),
		history,
		credits,
		// When the platform's own past counts were filled in (mergeBackfill); '' before.
		backfilled: typeof raw.backfilled === 'string' ? raw.backfilled : '',
		// YouTube Analytics' subscribers per video, [gained, lost], its plays and
		// engaged views, [views, engagedViews], and the last day it covers (ytanalytics.mjs).
		analytics: readPairs(raw.analytics),
		engaged: readPairs(raw.engaged),
		analyticsThrough: typeof raw.analyticsThrough === 'string' ? raw.analyticsThrough : '',
		analyticsAt: typeof raw.analyticsAt === 'string' ? raw.analyticsAt : '',
		// The account's views, likes and comments per whole month, the platform's
		// own figures (monthly.mjs), and when they were last read.
		monthly: readMonthly(raw.monthly),
		// The month still running, so far: { month, counts, through } (monthly.mjs); null without one.
		monthPart: readMonthPart(raw.monthPart),
		monthlyAt: typeof raw.monthlyAt === 'string' ? raw.monthlyAt : ''
	};
}

/** { month: 'YYYY-MM', counts: [views, likes, comments], through: 'YYYY-MM-DD' }, read back; null when it is not one. */
export function readMonthPart(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const { month, counts, through } = raw;
	if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;
	if (typeof through !== 'string' || !through.startsWith(`${month}-`)) return null;
	if (!Array.isArray(counts) || counts.length !== 3 || !counts.every((n) => typeof n === 'number')) return null;
	return { month, counts: [counts[0], counts[1], counts[2]], through };
}

/** { 'YYYY-MM': [views, likes, comments] }, read back; null when none are stored. */
export function readMonthly(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const out = {};
	for (const [month, counts] of Object.entries(raw)) {
		if (/^\d{4}-\d{2}$/.test(month) && Array.isArray(counts) && counts.length === 3 && counts.every((n) => typeof n === 'number')) {
			out[month] = [counts[0], counts[1], counts[2]];
		}
	}
	return out;
}

/** Per-video pairs of numbers, read back; null when there are none stored. */
function readPairs(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const out = {};
	for (const [id, pair] of Object.entries(raw)) {
		if (Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number') out[id] = [pair[0], pair[1]];
	}
	return out;
}

/** A post's views at a moment, from its samples (`[iso, views, …]`, written on change); null before its first. */
export function viewsAt(history, at) {
	let found = null;
	let foundAt = -Infinity;
	for (const sample of Array.isArray(history) ? history : []) {
		const t = time(sample?.[0]);
		if (typeof sample?.[1] !== 'number' || !(t <= at) || t < foundAt) continue;
		found = sample[1];
		foundAt = t;
	}
	return found;
}

/**
 * The views each post gained between two moments: `posts` are
 * `{ id, at (ms), views (now), history }`. A post out since `from` counts from
 * 0; one with no sample from before `from` (not read then) is left out, as is
 * one not out yet.
 */
export function viewGains(posts, from, to) {
	const out = [];
	for (const post of posts) {
		if (!Number.isFinite(post.at) || post.at > to || typeof post.views !== 'number') continue;
		const before = post.at > from ? 0 : viewsAt(post.history, from);
		if (before === null) continue;
		const gain = post.views - before;
		if (gain > 0) out.push({ id: String(post.id), gain });
	}
	return out;
}

/**
 * Whole followers shared out by weight: each its floor, the rest one by one
 * to the largest remainders (the first listed on a tie). Only shares above
 * zero are returned.
 */
export function apportion(total, weights) {
	const sum = weights.reduce((s, w) => s + w.gain, 0);
	if (!(total > 0) || !(sum > 0)) return {};
	const shares = weights.map((w, i) => {
		const exact = (w.gain / sum) * total;
		return { id: w.id, i, n: Math.floor(exact), rest: exact - Math.floor(exact) };
	});
	let left = total - shares.reduce((s, x) => s + x.n, 0);
	for (const x of [...shares].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
		if (left <= 0) break;
		x.n += 1;
		left -= 1;
	}
	const out = {};
	for (const x of shares) if (x.n > 0) out[x.id] = (out[x.id] ?? 0) + x.n;
	return out;
}

/** The highest count held at any moment of the window before `at`; null with no samples. */
export function recentHigh(history, at, windowMs = HIGH_WINDOW_MS) {
	const start = at - windowMs;
	let high = null;
	let held = null;
	for (const [iso, count] of [...history].sort((a, b) => time(a[0]) - time(b[0]))) {
		const t = time(iso);
		if (t > at) break;
		if (t < start) held = count;
		else high = Math.max(high ?? -Infinity, count);
	}
	if (held !== null) high = Math.max(high ?? -Infinity, held);
	return high;
}

/**
 * One read of an account's count: the next state of its row, and what this
 * read credited. `posts` are the account's posts as read now (see
 * viewGains); `now` is ms. The first read only starts the record.
 */
export function creditStep(previous, { platform, account, name, count, now, posts }) {
	const iso = new Date(now).toISOString();
	if (!previous) {
		return {
			state: { platform, account, name, count, at: iso, since: iso, history: [[iso, count]], credits: {} },
			gained: 0,
			credited: {}
		};
	}

	const high = recentHigh(previous.history, now) ?? previous.count;
	const gained = Math.max(0, count - Math.max(high, previous.count));
	let credited = {};
	if (gained > 0) {
		credited = apportion(
			gained,
			viewGains(posts, time(previous.at), now).sort((a, b) => b.gain - a.gain)
		);
		if (Object.keys(credited).length === 0) {
			// No video gained a view in the stretch: the newest one out takes it.
			const newest = posts
				.filter((p) => Number.isFinite(p.at) && p.at <= now)
				.sort((a, b) => b.at - a.at)[0];
			if (newest) credited = { [String(newest.id)]: gained };
		}
	}

	const credits = { ...previous.credits };
	for (const [id, n] of Object.entries(credited)) credits[id] = (credits[id] ?? 0) + n;
	const last = previous.history[previous.history.length - 1];
	const history = last && last[1] === count ? previous.history : [...previous.history, [iso, count]].slice(-HISTORY_CAP);
	return {
		state: { ...previous, platform, account, name: name || previous.name, count, at: iso, history, credits },
		gained,
		credited
	};
}

/**
 * The platform's own past counts put in front of what flock recorded:
 * `daily` is `[iso, count]` (Facebook's page_follows, a count per day). Only
 * days before the first recorded sample are taken, and of those only the
 * first and every change, as flock records them; `since` moves back to the
 * first, and `backfilled` says it was done, so it is done once.
 */
export function mergeBackfill(state, daily, now) {
	const first = state.history.length ? time(state.history[0][0]) : Infinity;
	const earlier = daily
		.filter(([iso, count]) => typeof count === 'number' && Number.isFinite(time(iso)) && time(iso) < first)
		.sort((a, b) => time(a[0]) - time(b[0]));
	const kept = [];
	for (const [iso, count] of earlier) {
		if (kept.length === 0 || kept[kept.length - 1][1] !== count) kept.push([new Date(time(iso)).toISOString(), count]);
	}
	const history = [...kept, ...state.history].slice(-HISTORY_CAP);
	return {
		...state,
		history,
		since: kept.length ? kept[0][0] : state.since,
		backfilled: new Date(now).toISOString()
	};
}

/**
 * Reads the account's row afresh — so a second process (the one-shot
 * `pnpm worker:stats`) cannot credit the same rise twice — applies one read
 * and writes it back. Returns what was credited.
 */
export async function followerStep({ pb, platform, account, name, count, posts, now = Date.now() }) {
	const key = settingKey(platform, account);
	const row = await pb.getSetting(key);
	const step = creditStep(readState(row?.value), { platform, account, name, count, now, posts });
	await pb.setSetting(key, step.state);
	return step;
}

/** A log line for a read that credited followers: who, and to which posts. */
export function creditWords(name, step, titleOf = () => '') {
	const parts = Object.entries(step.credited).map(([id, n]) => {
		const title = titleOf(id);
		return `${n} to ${title ? `"${title.slice(0, 40)}"` : id}`;
	});
	return `followers ${name}: +${step.gained} (now ${step.state.count})${parts.length ? ` — ${parts.join(', ')}` : ''}`;
}
