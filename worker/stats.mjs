// The stats pass: the newest videos on each channel, read every half minute
// and written to PocketBase so the Analytics screen can show them live. With
// several channels they take turns, one per tick, so adding a channel slows
// each one's cadence rather than raising the bill.
//
// The whole design turns on one fact about the Data API's quota: a videos.list
// call costs one unit however many ids it carries, up to fifty. So reading the
// newest fifty every 30 seconds costs exactly what reading one would, and the
// cadence alone sets the bill — 2,880 units a day out of the 10,000 that also
// has to pay 1,600 for every upload. The quota is the Google Cloud project's,
// shared by every channel. `statsBudget` is the guard: once a day's polling
// has spent that much, the pass pauses until Google's reset at midnight
// Pacific. A poll set too fast can then cost the day its stats, but never an
// upload.

import { forgetToken } from './google.mjs';
import { youtubeChannels, youtubeToken } from './youtube.mjs';
import { fetchOrExplain } from './net.mjs';

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

// Shared by every channel: the day's spend, and the worker's polling runs.
let spent = { day: '', units: 0 };
let paused = false;
let runs = null;
// What the heartbeat says per channel, by channel id.
let reports = null;
let turn = 0;
const perChannel = new Map();
// What the pass last said about a failure of its own (no channel at all), so
// it is said once rather than every tick.
let passError = '';

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
			playlistError: ''
		};
		perChannel.set(channelId, state);
	}
	return state;
}

/** Google's quota resets at midnight Pacific, whatever clock the worker runs on. */
function pacificDay() {
	return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function charge(units) {
	const day = pacificDay();
	if (spent.day !== day) {
		spent = { day, units: 0 };
		paused = false;
	}
	spent.units += units;
}

export function unitsToday() {
	return spent.day === pacificDay() ? spent.units : 0;
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
}

function noteRun(config, count) {
	const now = new Date().toISOString();
	const last = runs[runs.length - 1];
	const gap = last ? Date.parse(now) - Date.parse(last.to) : Infinity;
	if (last && gap <= 3 * Math.max(5, config.statsSeconds) * Math.max(1, count) * 1000) last.to = now;
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
		charge(1);
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

async function api(config, account, path, retry = true) {
	const token = await youtubeToken(config, account);
	const res = await fetchOrExplain(`${API}${path}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
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
		charge(1);
		state.uploadsPlaylist = channels?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? '';
		if (!state.uploadsPlaylist) throw new Error('Google returned no uploads playlist for this channel.');
	}

	const max = Math.min(50, Math.max(1, count));
	const res = await api(
		config,
		account,
		`/playlistItems?part=contentDetails&playlistId=${state.uploadsPlaylist}&maxResults=${max}`
	);
	charge(1);
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
		charge(1);
		return res?.items ?? [];
	} catch (err) {
		// A 400 naming the part means this grant is not allowed the owner-only
		// parts after all. Drop them for the rest of the run rather than fail
		// every pass over three fields.
		if (err.status === 400 && state.parts !== PUBLIC_PARTS && /part/i.test(err.body || '')) {
			charge(1);
			state.parts = PUBLIC_PARTS;
			const res = await api(config, account, query(state.parts));
			charge(1);
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
 * The heartbeat the Analytics screen reads: when the worker last looked, what
 * it spent, and why it stopped if it did — overall, and in `channels` per
 * channel, since the screen shows one channel at a time. Lives in
 * app_settings beside the watch index, the same small abuse for the same
 * reason — the SPA already has a way to read that collection and no way to
 * talk to the worker. `intervalSeconds` is how often each channel is read:
 * the tick times the number of channels taking turns.
 */
async function report(pb, config, count, extra) {
	await pb.setSetting('stats_status', {
		polledAt: new Date().toISOString(),
		unitsToday: unitsToday(),
		budget: config.statsBudget,
		intervalSeconds: config.statsSeconds * Math.max(1, count),
		videos: 0,
		error: '',
		runs: runs ?? [],
		channels: reports ?? {},
		...extra
	});
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

		if (state.lastError) log(`stats ${account.title}: recovered`);
		state.lastError = '';
		note({ videos: items.length });
		return items.length;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/quota exhausted/.test(message)) paused = true;
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
 * `pnpm worker:stats`), all of them.
 */
export async function statsPass({ pb, config, log, every = false }) {
	if (paused && spent.day === pacificDay()) return;

	const budget = Math.max(0, Number(config.statsBudget) || 0);
	if (budget && unitsToday() + 2 > budget) {
		paused = true;
		const why = `Paused: ${unitsToday()} of ${budget} units spent today. Resumes at midnight Pacific.`;
		log(`stats ${why.toLowerCase()}`);
		await report(pb, config, config.google.accounts.length, { error: why }).catch(() => {});
		return;
	}

	try {
		await loadRuns(pb);
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
		await report(pb, config, list.length, { videos });
		passError = '';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== passError) log(`stats failed: ${message.split('\n')[0]}`);
		passError = message;
		await report(pb, config, config.google.accounts.length, { error: message }).catch(() => {});
	}
}
