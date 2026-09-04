// The stats pass: the newest videos on the channel, read every half minute and
// written to PocketBase so the Analytics screen can show them live.
//
// The whole design turns on one fact about the Data API's quota: a videos.list
// call costs one unit however many ids it carries, up to fifty. So reading the
// newest fifty every 30 seconds costs exactly what reading one would, and the
// cadence alone sets the bill — 2,880 units a day out of the 10,000 that also
// has to pay 1,600 for every upload. `statsBudget` is the guard: once a day's
// polling has spent that much, the pass pauses until Google's reset at midnight
// Pacific. A poll set too fast can then cost the day its stats, but never an
// upload.

import { accessToken, forgetToken } from './google.mjs';
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

// The channel's playlists, for the compose screen's dropdown. They change
// rarely and the listing costs a unit, so this is how often it is re-read.
const PLAYLIST_TTL_MS = 30 * 60 * 1000;

let uploadsPlaylist = '';
let listed = { at: 0, ids: [] };
let spent = { day: '', units: 0 };
let paused = false;
let parts = ALL_PARTS;
let lastError = '';
let runs = null;
let playlistsAt = 0;
let playlistError = '';

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
}

function noteRun(config) {
	const now = new Date().toISOString();
	const last = runs[runs.length - 1];
	const gap = last ? Date.parse(now) - Date.parse(last.to) : Infinity;
	if (last && gap <= 3 * Math.max(5, config.statsSeconds) * 1000) last.to = now;
	else runs.push({ from: now, to: now });
	if (runs.length > 100) runs.splice(0, runs.length - 100);
}

/**
 * Publishes the channel's playlists to `app_settings` / `youtube_playlists`,
 * the same arrangement as the watch index: the browser has no Google
 * credentials, so the worker lists them and leaves the list where the compose
 * screen can read it. A failed read keeps the previous list in place.
 */
async function refreshPlaylists(pb, config, log) {
	if (Date.now() - playlistsAt < PLAYLIST_TTL_MS) return;
	playlistsAt = Date.now();
	try {
		const res = await api(config, '/playlists?part=snippet,contentDetails&mine=true&maxResults=50');
		charge(1);
		const items = (res?.items ?? []).map((p) => ({
			id: p.id,
			title: p.snippet?.title ?? '',
			count: Number(p.contentDetails?.itemCount ?? 0)
		}));
		await pb.setSetting('youtube_playlists', { fetchedAt: new Date().toISOString(), items });
		if (playlistError) log('playlists: recovered');
		playlistError = '';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== playlistError) {
			log(`playlists failed: ${message.split('\n')[0]}`);
			playlistError = message;
		}
	}
}

async function api(config, path, retry = true) {
	const token = await accessToken(config.google);
	const res = await fetchOrExplain(`${API}${path}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	const text = await res.text();

	if (res.status === 401 && retry) {
		forgetToken();
		return api(config, path, false);
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

/** Ids of the newest videos on the channel, newest first, private and unlisted included. */
async function recentIds(config, count) {
	if (listed.ids.length > 0 && Date.now() - listed.at < LIST_TTL_MS) return listed.ids;

	if (!uploadsPlaylist) {
		const channels = await api(config, '/channels?part=contentDetails&mine=true');
		charge(1);
		uploadsPlaylist = channels?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? '';
		if (!uploadsPlaylist) throw new Error('Google returned no uploads playlist for this account.');
	}

	const max = Math.min(50, Math.max(1, count));
	const res = await api(
		config,
		`/playlistItems?part=contentDetails&playlistId=${uploadsPlaylist}&maxResults=${max}`
	);
	charge(1);
	const ids = (res?.items ?? []).map((item) => item.contentDetails?.videoId).filter(Boolean);
	listed = { at: Date.now(), ids };
	return ids;
}

/** The video items for a set of ids, in one request. */
async function fetchVideos(config, ids) {
	const query = (list) => `/videos?part=${list.join(',')}&id=${ids.join(',')}&maxResults=50`;
	try {
		const res = await api(config, query(parts));
		charge(1);
		return res?.items ?? [];
	} catch (err) {
		// A 400 naming the part means this grant is not allowed the owner-only
		// parts after all. Drop them for the rest of the run rather than fail
		// every pass over three fields.
		if (err.status === 400 && parts !== PUBLIC_PARTS && /part/i.test(err.body || '')) {
			charge(1);
			parts = PUBLIC_PARTS;
			const res = await api(config, query(parts));
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
 * it spent, and why it stopped if it did. Lives in app_settings beside the
 * watch index, the same small abuse for the same reason — the SPA already has
 * a way to read that collection and no way to talk to the worker.
 */
async function report(pb, config, extra) {
	await pb.setSetting('stats_status', {
		polledAt: new Date().toISOString(),
		unitsToday: unitsToday(),
		budget: config.statsBudget,
		intervalSeconds: config.statsSeconds,
		videos: 0,
		error: '',
		runs: runs ?? [],
		...extra
	});
}

/**
 * One poll: newest ids, one videos.list, upsert whatever changed.
 *
 * Rows are written only when the canonical item differs from what is stored,
 * and a history sample only when a counter moved — so a quiet video costs
 * nothing per poll however fast the pass runs. Videos that fall out of the
 * window keep their rows and their history; they just stop refreshing.
 */
export async function statsPass({ pb, config, log }) {
	if (paused && spent.day === pacificDay()) return;

	const budget = Math.max(0, Number(config.statsBudget) || 0);
	if (budget && unitsToday() + 2 > budget) {
		paused = true;
		const why = `Paused: ${unitsToday()} of ${budget} units spent today. Resumes at midnight Pacific.`;
		log(`stats ${why.toLowerCase()}`);
		await report(pb, config, { error: why }).catch(() => {});
		return;
	}

	try {
		await loadRuns(pb);
		const ids = await recentIds(config, config.statsVideos);
		if (ids.length === 0) {
			await report(pb, config, { videos: 0 });
			return;
		}

		const items = await fetchVideos(config, ids);
		noteRun(config);
		await refreshPlaylists(pb, config, log);
		const existing = await pb.listVideoStats();
		const byVideo = new Map(existing.map((row) => [row.video_id, row]));
		const now = new Date().toISOString();

		for (const item of items) {
			const row = toRow(item);
			const prev = byVideo.get(row.video_id);
			const sample = [now, row.views, row.likes, row.comments];

			if (!prev) {
				await pb.createVideoStats({ ...row, fetched_at: now, history: [sample] });
				log(`stats: new video "${row.title.slice(0, 50)}" (${row.privacy})`);
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

		if (lastError) log('stats: recovered');
		lastError = '';
		await report(pb, config, { videos: items.length, ids });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/quota exhausted/.test(message)) paused = true;
		// Reported once per distinct failure rather than every 30 seconds.
		if (message !== lastError) {
			log(`stats failed: ${message.split('\n')[0]}`);
			lastError = message;
		}
		await report(pb, config, { error: message }).catch(() => {});
	}
}
