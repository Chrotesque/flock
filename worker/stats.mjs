// The stats pass: the newest videos on each channel, read every half minute
// and written to PocketBase so the Analytics screen can show them live. With
// several channels they take turns, one per tick, so adding a channel slows
// each one's cadence rather than raising the bill.
//
// The whole design turns on one fact about the Data API's quota: a videos.list
// call costs one unit however many ids it carries, up to fifty. So reading the
// newest fifty every 30 seconds costs exactly what reading one would, and the
// cadence alone sets the bill — about 4,200 of the day's 10,000 units with
// three channels, counting the listings and subscriber counts. The units are
// the Google Cloud project's, shared by every channel, and since Google's
// change of 4 Dec 2025 they no longer pay for uploads (videos.insert has its
// own bucket of 100 a day) — only for reads and for edits: playlist adds,
// renames, Calendar moves and releases, deletes (quota.mjs counts them all).
// `statsBudget` (8,000) is the guard: once the day's units, all kinds
// together, reach it, the automatic reads stop until Google's reset at
// midnight Pacific; a Refresh pressed on the Dashboard still reads until
// `statsCeiling` (9,000), and the last 1,000 are left for the edits.

import { forgetToken } from './google.mjs';
import { youtubeChannels, youtubeToken } from './youtube.mjs';
import { fetchOrExplain } from './net.mjs';
import { creditWords, followerStep } from './followers.mjs';
import { analyticsPass } from './ytanalytics.mjs';
import {
	charge,
	mergeHistory,
	pacificDay,
	quotaToday,
	restoreQuota,
	returnFinishedDays,
	statsMayRead,
	takeFinishedDays,
	unitsToday
} from './quota.mjs';

const API = 'https://www.googleapis.com/youtube/v3';

// The uploads playlist is re-read only this often. The ids barely change, and
// listing them is the one part of the pass that costs a second unit.
const LIST_TTL_MS = 5 * 60 * 1000;

// Everything videos.list will hand the owner. The last three parts are
// owner-only — fine, these are the channel's own videos — and parts do not add
// to the cost. `PUBLIC_PARTS` is the fallback if Google refuses the owner ones.
const PUBLIC_PARTS = [
	'snippet',
	'statistics',
	'contentDetails',
	'status',
	'topicDetails',
	'liveStreamingDetails',
	'paidProductPlacementDetails'
];
const ALL_PARTS = [...PUBLIC_PARTS, 'fileDetails', 'processingDetails', 'suggestions'];

// Samples kept per video. Only polls on which a counter moved are stored, so
// this is hours of a busy launch or weeks of a quiet back-catalogue entry.
const HISTORY_CAP = 1000;

// A channel's playlists, for the compose screen's dropdown. They change
// rarely and the listing costs a unit, so this is how often it is re-read.
const PLAYLIST_TTL_MS = 30 * 60 * 1000;

// How often a channel's subscriber count is read, for the Dashboard's
// followers per video (followers.mjs): a unit each, 144 a day per channel.
const SUBSCRIBERS_TTL_MS = 10 * 60 * 1000;

// Shared by every channel: the worker's polling runs, when it last read, and
// the Pacific day on which Google said the quota was used up.
let runs = null;
let lastRead = '';
let exhausted = '';
// What the heartbeat last said of the day's spend and the stop, so a stopped
// pass writes it only when it moved.
let reported = '';
// What the pass last said about stopping, so it is said once a day.
let stopSaid = '';
// One pass at a time: the automatic tick and a Refresh asked for on the
// Dashboard would otherwise read the same channel at once.
let chain = Promise.resolve();
// What the heartbeat says per channel, by channel id.
let reports = null;
let turn = 0;
const perChannel = new Map();
// What the pass last said about a failure of its own (no channel at all), so
// it is said once rather than every tick.
let passError = '';

// How often a channel is read can be set on the page (Settings → DevTest →
// YouTube, `app_settings` / `stats_pace` = { seconds }); without it the
// config's `statsSeconds` holds. Re-read once a minute, so a change takes
// hold within one. The budget stops still stand whatever it says.
const PACE_KEY = 'stats_pace';
const PACE_TTL_MS = 60_000;
/** The fastest and slowest pace the page may set: seconds between two reads. */
export const PACE_MIN_SECONDS = 5;
export const PACE_MAX_SECONDS = 3600;
let pace = { seconds: 0, at: 0 };

// Finished days of the spend, kept for the page's history of what the units
// went on (quota.mjs `mergeHistory`).
const HISTORY_KEY = 'youtube_quota_history';

/** The pace a `stats_pace` row sets: whole seconds within the limits, or 0 when it sets none. */
export function readPace(value) {
	const seconds = Math.round(Number(value?.seconds));
	if (!Number.isFinite(seconds) || seconds <= 0) return 0;
	return Math.min(PACE_MAX_SECONDS, Math.max(PACE_MIN_SECONDS, seconds));
}

/** Seconds between two reads (each of one channel, in turn): the page's setting, else the config's. */
export function paceSeconds(config) {
	return pace.seconds || config.statsSeconds;
}

/** Reads the page's setting again once a minute; a change is said in the log. */
export async function refreshPace(pb, config, log) {
	if (Date.now() - pace.at < PACE_TTL_MS) return;
	pace.at = Date.now();
	let seconds = 0;
	try {
		seconds = readPace((await pb.getSetting(PACE_KEY))?.value);
	} catch {
		return; // PocketBase away: keep what holds
	}
	if (seconds === pace.seconds) return;
	const was = paceSeconds(config);
	pace.seconds = seconds;
	const now = paceSeconds(config);
	if (now !== was) {
		log(
			`stats: reading a channel every ${now} s now (was ${was} s)` +
				(seconds ? ' — set on the page' : " — the page's setting is gone, the config's holds")
		);
	}
}

/** Writes the days that ended into the history; kept for the next try when that fails. */
async function saveFinishedDays(pb) {
	const days = takeFinishedDays();
	if (days.length === 0) return;
	try {
		const stored = await pb.getSetting(HISTORY_KEY);
		await pb.setSetting(HISTORY_KEY, mergeHistory(stored?.value, days));
	} catch {
		returnFinishedDays(days);
	}
}

/** A channel's own state: its uploads playlist, the ids last listed, what it may read, what was said. */
function stateOf(channelId) {
	let state = perChannel.get(channelId);
	if (!state) {
		state = {
			uploadsPlaylist: '',
			listed: { at: 0, ids: [] },
			parts: ALL_PARTS,
			lastError: '',
			playlistsAt: 0,
			playlistError: '',
			subscribersAt: 0,
			subscriberError: ''
		};
		perChannel.set(channelId, state);
	}
	return state;
}

/**
 * The stretches during which the worker polled without a break, kept in the
 * heartbeat. The screen needs them to tell a quiet hour from an hour the
 * worker was switched off: samples are written only on change, so the
 * history alone cannot say which it was. A restart within a few intervals
 * continues the current run rather than opening a new one.
 */
async function loadRuns(pb) {
	if (runs) return;
	const row = await pb.getSetting('stats_status');
	runs = Array.isArray(row?.value?.runs) ? row.value.runs : [];
	const saved = row?.value?.channels;
	reports = saved && typeof saved === 'object' ? { ...saved } : {};
	lastRead = typeof row?.value?.polledAt === 'string' ? row.value.polledAt : '';
	// What the day had spent before this start, so a restart does not count
	// from zero. A row from before quota.mjs has only the stats' units.
	restoreQuota(row?.value?.quota ?? legacyQuota(row?.value));
}

/** The day's spend as a heartbeat from before quota.mjs said it: the stats' units, if written today. */
function legacyQuota(value) {
	const units = Number(value?.unitsToday);
	const at = new Date(value?.polledAt ?? '');
	if (!(units > 0) || !Number.isFinite(at.getTime()) || pacificDay(at) !== pacificDay()) return null;
	return { day: pacificDay(), units, kinds: { stats: units }, uploads: 0 };
}

/** Why the stats do not read now: `exhausted` (Google said so), `ceiling`, `auto` (automatic reads only), or ''. */
function stopState(config) {
	if (exhausted === pacificDay()) return 'exhausted';
	const limits = { units: unitsToday(), budget: config.statsBudget, ceiling: config.statsCeiling };
	if (statsMayRead({ ...limits, manual: true }) === 'ceiling') return 'ceiling';
	if (statsMayRead(limits) === 'stopped') return 'auto';
	return '';
}

function noteRun(config, count) {
	const now = new Date().toISOString();
	const last = runs[runs.length - 1];
	const gap = last ? Date.parse(now) - Date.parse(last.to) : Infinity;
	if (last && gap <= 3 * Math.max(5, paceSeconds(config)) * Math.max(1, count) * 1000) last.to = now;
	else runs.push({ from: now, to: now });
	if (runs.length > 100) runs.splice(0, runs.length - 100);
}

/**
 * Publishes a channel's playlists to `app_settings` /
 * `youtube_playlists:<channel id>`, the same arrangement as the watch index:
 * the browser has no Google credentials, so the worker lists them and leaves
 * the list where the compose screen can read it — for the channel of the
 * brand being written for. A failed read keeps the previous list in place.
 */
async function refreshPlaylists(pb, config, log, account) {
	const state = stateOf(account.channelId);
	if (Date.now() - state.playlistsAt < PLAYLIST_TTL_MS) return;
	state.playlistsAt = Date.now();
	try {
		const res = await api(config, account, '/playlists?part=snippet,contentDetails&mine=true&maxResults=50');
		const items = (res?.items ?? []).map((p) => ({
			id: p.id,
			title: p.snippet?.title ?? '',
			count: Number(p.contentDetails?.itemCount ?? 0)
		}));
		await pb.setSetting(`youtube_playlists:${account.channelId}`, {
			fetchedAt: new Date().toISOString(),
			channel: account.channelId,
			items
		});
		if (state.playlistError) log(`playlists ${account.title}: recovered`);
		state.playlistError = '';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== state.playlistError) {
			log(`playlists ${account.title} failed: ${message.split('\n')[0]}`);
			state.playlistError = message;
		}
	}
}

/**
 * The channel's subscriber count, and the rise since the last read credited
 * to its videos (followers.mjs). `rows` are the videos as just read, `byVideo`
 * the stored rows with their view history. Every ten minutes; a failure is
 * said once and never stops the stats.
 */
async function readSubscribers(pb, config, log, account, rows, byVideo) {
	const state = stateOf(account.channelId);
	if (Date.now() - state.subscribersAt < SUBSCRIBERS_TTL_MS) return;
	state.subscribersAt = Date.now();
	try {
		const res = await api(config, account, '/channels?part=statistics&mine=true');
		const stats = res?.items?.[0]?.statistics ?? {};
		// Above 1,000 YouTube rounds the count down to three figures.
		if (stats.hiddenSubscriberCount || stats.subscriberCount == null) throw new Error('the channel hides its subscriber count');
		const posts = rows.map((row) => ({
			id: row.video_id,
			at: Date.parse(row.published_at),
			views: row.views,
			history: byVideo.get(row.video_id)?.history ?? []
		}));
		const step = await followerStep({
			pb,
			platform: 'youtube',
			account: account.channelId,
			name: account.title,
			count: Number(stats.subscriberCount),
			posts
		});
		if (step.gained) {
			const titles = new Map(rows.map((row) => [row.video_id, row.title]));
			log(creditWords(account.title, step, (id) => titles.get(id) ?? ''));
		}
		if (state.subscriberError) log(`subscribers ${account.title}: recovered`);
		state.subscriberError = '';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== state.subscriberError) {
			log(`subscribers ${account.title} not read: ${message.split('\n')[0]}`);
			state.subscriberError = message;
		}
	}
}

async function api(config, account, path, retry = true) {
	const token = await youtubeToken(config, account);
	const res = await fetchOrExplain(`${API}${path}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	// Every read that reaches YouTube costs a unit, refused or not.
	charge('stats', 1);
	const text = await res.text();

	if (res.status === 401 && retry) {
		forgetToken(account.refreshToken);
		return api(config, account, path, false);
	}
	if (!res.ok) {
		if (res.status === 403 && /insufficient|scope/i.test(text)) {
			throw new Error(
				'The Google grant cannot read the channel. Re-authorise with:  pnpm worker:auth ' +
					'(stats need the read-only scope, which earlier grants did not ask for)'
			);
		}
		if (res.status === 403 && /quota/i.test(text)) {
			throw new Error('YouTube quota exhausted for today. Resumes at midnight Pacific.');
		}
		const err = new Error(`YouTube GET ${path.split('?')[0]} -> ${res.status}: ${text.slice(0, 300)}`);
		err.status = res.status;
		err.body = text;
		throw err;
	}
	return text ? JSON.parse(text) : null;
}

/** Ids of the newest videos on a channel, newest first, private and unlisted included. */
async function recentIds(config, account, count) {
	const state = stateOf(account.channelId);
	if (state.listed.ids.length > 0 && Date.now() - state.listed.at < LIST_TTL_MS) return state.listed.ids;

	if (!state.uploadsPlaylist) {
		const channels = await api(config, account, '/channels?part=contentDetails&mine=true');
		state.uploadsPlaylist = channels?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? '';
		if (!state.uploadsPlaylist) throw new Error('Google returned no uploads playlist for this channel.');
	}

	const max = Math.min(50, Math.max(1, count));
	const res = await api(
		config,
		account,
		`/playlistItems?part=contentDetails&playlistId=${state.uploadsPlaylist}&maxResults=${max}`
	);
	const ids = (res?.items ?? []).map((item) => item.contentDetails?.videoId).filter(Boolean);
	state.listed = { at: Date.now(), ids };
	return ids;
}

/** The video items for a set of ids, in one request. */
async function fetchVideos(config, account, ids) {
	const state = stateOf(account.channelId);
	const query = (list) => `/videos?part=${list.join(',')}&id=${ids.join(',')}&maxResults=50`;
	try {
		const res = await api(config, account, query(state.parts));
		return res?.items ?? [];
	} catch (err) {
		// A 400 naming the part means this grant is not allowed the owner-only
		// parts after all. Drop them for the rest of the run rather than fail
		// every pass over three fields.
		if (err.status === 400 && state.parts !== PUBLIC_PARTS && /part/i.test(err.body || '')) {
			state.parts = PUBLIC_PARTS;
			const res = await api(config, account, query(state.parts));
			return res?.items ?? [];
		}
		throw err;
	}
}

/** "PT1H2M3S" -> seconds. */
function seconds(iso) {
	const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
	if (!m) return 0;
	return (
		Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)
	);
}

/**
 * Key-sorted JSON, for comparing what Google sent with what PocketBase stored.
 * PocketBase re-serialises JSON columns through Go, which sorts object keys, so
 * a plain JSON.stringify of the two never matches even when the data does.
 */
function canon(value) {
	if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function toRow(item) {
	const stats = item.statistics ?? {};
	// Likes and comments are absent, not zero, when the owner has hidden them.
	const count = (v) => (v == null ? null : Number(v));
	return {
		video_id: item.id,
		title: item.snippet?.title ?? '',
		published_at: item.snippet?.publishedAt ?? '',
		privacy: item.status?.privacyStatus ?? '',
		duration: seconds(item.contentDetails?.duration),
		views: count(stats.viewCount),
		likes: count(stats.likeCount),
		comments: count(stats.commentCount),
		data: item
	};
}

/**
 * The heartbeat the Dashboard reads: when the worker last read, what the day's
 * units went on (`quota`, every kind of work; `unitsToday` its total), the
 * stops and whether one holds (`stopped`), and why it failed if it did —
 * overall, and in `channels` per channel. Lives in app_settings beside the
 * watch index, the same small abuse for the same reason — the SPA already has
 * a way to read that collection and no way to talk to the worker.
 * `intervalSeconds` is how often each channel is read: the tick times the
 * number of channels taking turns; `paceSeconds` the tick itself and
 * `paceFrom` whether the page set it. A day that ended goes into the history.
 */
async function report(pb, config, count, extra) {
	const quota = quotaToday();
	const stopped = stopState(config);
	await pb.setSetting('stats_status', {
		polledAt: lastRead,
		unitsToday: quota.units,
		quota,
		budget: config.statsBudget,
		ceiling: config.statsCeiling,
		stopped,
		intervalSeconds: paceSeconds(config) * Math.max(1, count),
		paceSeconds: paceSeconds(config),
		paceFrom: pace.seconds ? 'setting' : 'config',
		videos: 0,
		error: '',
		runs: runs ?? [],
		channels: reports ?? {},
		...extra
	});
	reported = `${quota.day}|${quota.units}|${quota.uploads}|${stopped}`;
	await saveFinishedDays(pb);
}

/**
 * One poll of one channel: newest ids, one videos.list, upsert whatever
 * changed.
 *
 * Rows are written only when the canonical item differs from what is stored,
 * and a history sample only when a counter moved — so a quiet video costs
 * nothing per poll however fast the pass runs. Videos that fall out of the
 * window keep their rows and their history; they just stop refreshing. A
 * row's channel is in its item (`snippet.channelId`), which is how the screen
 * tells the channels apart.
 */
async function pollChannel({ pb, config, log, account }) {
	const state = stateOf(account.channelId);
	const note = (entry) => {
		reports[account.channelId] = {
			title: account.title,
			polledAt: new Date().toISOString(),
			videos: 0,
			error: '',
			...entry
		};
	};
	try {
		const ids = await recentIds(config, account, config.statsVideos);
		if (ids.length === 0) {
			note({ videos: 0 });
			return 0;
		}

		const items = await fetchVideos(config, account, ids);
		await refreshPlaylists(pb, config, log, account);
		const existing = await pb.listVideoStats();
		const byVideo = new Map(existing.map((row) => [row.video_id, row]));
		const now = new Date().toISOString();

		for (const item of items) {
			const row = toRow(item);
			const prev = byVideo.get(row.video_id);
			const sample = [now, row.views, row.likes, row.comments];

			if (!prev) {
				await pb.createVideoStats({ ...row, fetched_at: now, history: [sample] });
				log(`stats: new video on ${account.title}: "${row.title.slice(0, 50)}" (${row.privacy})`);
				continue;
			}
			if (canon(prev.data) === canon(row.data)) continue;

			const moved =
				prev.views !== row.views || prev.likes !== row.likes || prev.comments !== row.comments;
			const history = Array.isArray(prev.history) ? prev.history : [];
			await pb.updateVideoStats(prev.id, {
				...row,
				fetched_at: now,
				history: moved ? [...history, sample].slice(-HISTORY_CAP) : history
			});
		}
		await readSubscribers(pb, config, log, account, items.map(toRow), byVideo);
		// YouTube's own subscribers per video, every six hours, its own quota (ytanalytics.mjs).
		await analyticsPass({ pb, config, log, account });

		if (state.lastError) log(`stats ${account.title}: recovered`);
		state.lastError = '';
		note({ videos: items.length });
		return items.length;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/quota exhausted/.test(message)) exhausted = pacificDay();
		// Reported once per distinct failure rather than every 30 seconds.
		if (message !== state.lastError) {
			log(`stats ${account.title} failed: ${message.split('\n')[0]}`);
			state.lastError = message;
		}
		note({ error: message });
		return 0;
	}
}

/**
 * One tick: the next channel in turn — or, with `every` (the one-shot
 * `pnpm worker:stats`, and a Refresh pressed on the Dashboard), all of them.
 * `manual` reads past the automatic stop, up to the ceiling. Says what it
 * did: `read`, `stopped` (automatic reads, past the budget), `ceiling`,
 * `exhausted` (Google said so) or `failed`.
 */
export function statsPass(args) {
	const run = chain.then(() => passOnce(args));
	chain = run.catch(() => {});
	return run;
}

async function passOnce({ pb, config, log, every = false, manual = false }) {
	const count = config.google.accounts.length;
	try {
		await loadRuns(pb);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== passError) log(`stats failed: ${message.split('\n')[0]}`);
		passError = message;
		return 'failed';
	}

	const may =
		exhausted === pacificDay()
			? 'exhausted'
			: statsMayRead({ units: unitsToday(), budget: config.statsBudget, ceiling: config.statsCeiling, manual });
	if (may !== 'read') {
		const said = `${pacificDay()}|${may}`;
		if (stopSaid !== said) {
			stopSaid = said;
			log(
				may === 'stopped'
					? `stats: automatic reads stopped — ${unitsToday()} units of today's quota spent (stop at ${config.statsBudget}); ` +
							`a Refresh on the Dashboard still reads until ${config.statsCeiling}. Resumes at midnight Pacific.`
					: may === 'ceiling'
						? `stats: reads stopped — ${unitsToday()} units of today's quota spent (ceiling ${config.statsCeiling}); ` +
							'the rest is kept for playlist adds, renames and Calendar edits. Resumes at midnight Pacific.'
						: 'stats: YouTube says the quota is used up — no reads until midnight Pacific.'
			);
		}
		// The day's spend still moves (playlist adds, renames, moves), and the
		// Dashboard shows it, so it is written whenever it changed.
		const quota = quotaToday();
		if (reported !== `${quota.day}|${quota.units}|${quota.uploads}|${stopState(config)}`) {
			await report(pb, config, count).catch(() => {});
		}
		return may;
	}

	try {
		const list = await youtubeChannels(config);
		if (list.length === 0) {
			const problem = config.google.accounts.find((account) => account.problem)?.problem;
			throw new Error(problem || 'No YouTube channel is connected. Run:  pnpm worker:auth');
		}
		// A channel no longer connected leaves the report.
		for (const id of Object.keys(reports)) {
			if (!list.some((account) => account.channelId === id)) delete reports[id];
		}

		const due = every ? list : [list[turn++ % list.length]];
		noteRun(config, list.length);
		let videos = 0;
		for (const account of due) videos += await pollChannel({ pb, config, log, account });
		lastRead = new Date().toISOString();
		await report(pb, config, list.length, { videos });
		passError = '';
		return 'read';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== passError) log(`stats failed: ${message.split('\n')[0]}`);
		passError = message;
		await report(pb, config, count, { error: message }).catch(() => {});
		return 'failed';
	}
}
