// The YouTube adapter: one upload_targets row -> one video on the channel.
//
// Everything it reads out of `options` is a field that videos.insert actually
// accepts. The mapping lives here rather than in platforms.ts so the registry
// stays a description of the interface, not of Google's wire format.

import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { accessToken, forgetToken, grantedScope } from './google.mjs';
import { pickAccount } from './accounts.mjs';
import { youtubeVideoId } from './moves.mjs';
import { sameTitle, snippetPatch } from './retitle.mjs';
import { describeNetworkError, fetchOrExplain } from './net.mjs';
import { charge, countUpload, unitCost } from './quota.mjs';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

// videos.insert wants a numeric categoryId. These are the stable global ids;
// videoCategories.list is the authoritative per-region source if this ever
// needs to grow beyond the handful the registry offers.
const CATEGORY_IDS = {
	'Film & Animation': '1',
	'Autos & Vehicles': '2',
	Music: '10',
	'Pets & Animals': '15',
	Sports: '17',
	'Travel & Events': '19',
	Gaming: '20',
	'People & Blogs': '22',
	Comedy: '23',
	Entertainment: '24',
	'News & Politics': '25',
	'Howto & Style': '26',
	Education: '27',
	'Science & Technology': '28',
	'Nonprofits & Activism': '29'
};

// snippet.defaultLanguage and defaultAudioLanguage take BCP-47 codes; the
// registry offers names. Keep this in step with YOUTUBE_LANGUAGES there.
const LANGUAGE_CODES = {
	'English (US)': 'en-US',
	'English (UK)': 'en-GB',
	German: 'de',
	French: 'fr',
	Spanish: 'es',
	Italian: 'it',
	Dutch: 'nl',
	'Portuguese (Brazil)': 'pt-BR',
	Japanese: 'ja',
	Korean: 'ko',
	Polish: 'pl',
	Swedish: 'sv',
	Turkish: 'tr',
	Russian: 'ru',
	'Chinese (Simplified)': 'zh-CN'
};

const THUMBNAIL_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

const PRIVACY = { Public: 'public', Unlisted: 'unlisted', Private: 'private' };
const LICENSE = { 'Standard YouTube License': 'youtube', 'Creative Commons': 'creativeCommon' };

// Any of these lets a grant edit a video after upload: add it to a playlist,
// or set paid promotion, which videos.insert does not reliably take.
// youtube.upload alone cannot; `pnpm worker:auth --with-playlists` adds
// `youtube`.
const EDIT_SCOPES = [
	'https://www.googleapis.com/auth/youtube',
	'https://www.googleapis.com/auth/youtube.force-ssl',
	'https://www.googleapis.com/auth/youtubepartner'
];

/** Whether a grant's scope string allows editing a video: true, false, or null when unknown. */
export function scopeCanEdit(scope) {
	if (typeof scope !== 'string' || !scope.trim()) return null;
	const granted = scope.trim().split(/\s+/);
	return EDIT_SCOPES.some((s) => granted.includes(s));
}

// The thumbnail waits for YouTube to finish processing: one set seconds
// after the upload, while YouTube was still making its own, did not stay on
// 11 Oct 2026 although thumbnails.set had accepted it. Shorts finish in a
// minute or two; a long upload that has not finished by the cap goes ahead
// anyway rather than holding the queue.
const PROCESSING_POLL_MS = 15_000;
const PROCESSING_WAIT_MS = 15 * 60_000;

/**
 * What a video's processingDetails say for the steps after upload: `wait`
 * while YouTube is processing or has not made its own thumbnails yet, `done`
 * once both are finished, `failed` when processing will not finish.
 */
/** Seconds in an ISO 8601 duration as videos.list gives it ("PT1M5S"); null if unreadable. */
export function isoSeconds(value) {
	const text = String(value ?? '');
	const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text);
	if (!match || text === 'P' || text.endsWith('T')) return null;
	const [, d, h, m, s] = match;
	return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

// Up to three minutes is a Short — the same line as the SPA's studio.ts.
const SHORT_MAX_SECONDS = 180;

/**
 * Whether the upload is a Short, whose cover YouTube takes only in Studio
 * (thumbnails.set changes just the 16:9 thumbnail; found 11 Oct 2026): true,
 * false, or null when its length is not known — which the caller counts as
 * a possible Short, as the SPA does.
 */
export function isShortVideo(seconds) {
	if (!(Number(seconds) > 0)) return null;
	return Number(seconds) <= SHORT_MAX_SECONDS;
}

/** A video's edit page in YouTube Studio, where what the API cannot set is set. */
export function studioUrl(videoId) {
	return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`;
}

export function processingState(details) {
	const status = details?.processingStatus;
	if (status === 'failed' || status === 'terminated') return 'failed';
	if (status === 'succeeded' && details.thumbnailsAvailability === 'available') return 'done';
	return 'wait';
}

/**
 * Whether this release can be handed to YouTube to publish later.
 *
 * `publishAt` flips a private video public at the given instant, so it only
 * means anything for a release that was going to be public. An unlisted or
 * private target is uploaded at that visibility immediately — scheduling it
 * would silently turn it public, which is not what was confirmed on screen.
 */
function resolveRelease(options, scheduledAt) {
	const wanted = PRIVACY[options.visibility] ?? 'private';
	const at = new Date(scheduledAt);
	const future = Number.isFinite(at.getTime()) && at.getTime() > Date.now();

	if (wanted === 'public' && future) {
		return { privacyStatus: 'private', publishAt: at.toISOString(), scheduled: true, wanted };
	}
	return { privacyStatus: wanted, publishAt: null, scheduled: false, wanted };
}

function buildResource(target, options, release) {
	const status = {
		privacyStatus: release.privacyStatus,
		license: LICENSE[options.license] ?? 'youtube',
		embeddable: options.allowEmbedding !== false,
		selfDeclaredMadeForKids: Boolean(options.madeForKids),
		containsSyntheticMedia: Boolean(options.syntheticMedia)
	};
	if (release.publishAt) status.publishAt = release.publishAt;

	const snippet = {
		// The API rejects an empty title outright, and a target with no title
		// should not take the whole upload down at the last step.
		title: (target.title || 'Untitled').slice(0, 100),
		description: (target.description || '').slice(0, 5000),
		tags: Array.isArray(options.tags) ? options.tags : [],
		categoryId: CATEGORY_IDS[options.category] ?? '22'
	};
	// Two languages: the one written (title and description) and the one spoken.
	const textLanguage = LANGUAGE_CODES[options.textLanguage];
	const videoLanguage = LANGUAGE_CODES[options.videoLanguage];
	if (textLanguage) snippet.defaultLanguage = textLanguage;
	if (videoLanguage) snippet.defaultAudioLanguage = videoLanguage;

	const resource = { snippet, status };
	// Only when ticked: an untouched upload sends exactly the request it always
	// has, and the first ticked one is what proves the part is accepted.
	if (options.paidPromotion) {
		resource.paidProductPlacementDetails = { hasPaidProductPlacement: true };
	}
	return resource;
}

/**
 * One Data API call. `kind` is what the units went on (quota.mjs): every
 * call that reaches YouTube is charged, refused or not.
 */
async function api(token, path, { kind = 'other', ...options } = {}) {
	const res = await fetchOrExplain(`${API}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			...options.headers
		}
	});
	charge(kind, unitCost(options.method));
	const text = await res.text();
	if (!res.ok) throw new Error(`YouTube ${options.method || 'GET'} ${path} -> ${res.status}\n${text}`);
	return text ? JSON.parse(text) : null;
}

const SETUP = 'pnpm worker:auth';

/** A channel's grant, in the shape google.mjs refreshes. */
function grant(config, account) {
	return {
		clientId: config.google.clientId,
		clientSecret: config.google.clientSecret,
		refreshToken: account.refreshToken
	};
}

/** An access token for one channel's grant. */
export function youtubeToken(config, account) {
	return accessToken(grant(config, account));
}

/**
 * Whether a channel's grant can edit its videos, from what Google reported on
 * the last refresh, else what `pnpm worker:auth` wrote down. Null when
 * neither says.
 */
export async function grantCanEdit(config, account) {
	await youtubeToken(config, account);
	return scopeCanEdit(grantedScope(account.refreshToken) ?? account.scope);
}

// The channel each grant uploads to: read once a process for the check before
// every upload (one unit), and every half hour for the `accounts` rows.
const CHANNEL_TTL_MS = 30 * 60_000;
const channels = new Map();
let channelsAt = 0;
const channelErrors = new Map();

/** The channel a grant uploads to, as YouTube says. */
export async function ownChannel(config, account, { fresh = false } = {}) {
	const known = channels.get(account.refreshToken);
	if (known && !fresh) return known;
	const token = await youtubeToken(config, account);
	const body = await api(token, '/channels?part=snippet&mine=true', { kind: 'channel' });
	const item = body?.items?.[0];
	if (!item) throw new Error('The Google account has no YouTube channel.');
	const channel = {
		id: String(item.id),
		title: item.snippet?.title ?? '',
		handle: item.snippet?.customUrl ?? '',
		thumbnail: item.snippet?.thumbnails?.default?.url ?? ''
	};
	channels.set(account.refreshToken, channel);
	return channel;
}

/**
 * The channels this worker can upload to, each named. A grant from a config
 * written before the list (one bare refresh token) does not say whose it is,
 * so YouTube is asked once a process; the next `pnpm worker:auth` writes the
 * answer down. A grant that cannot be read is left out, with its reason.
 */
export async function youtubeChannels(config) {
	for (const account of config.google.accounts) {
		if (account.channelId) continue;
		try {
			const channel = await ownChannel(config, account);
			Object.assign(account, { channelId: channel.id, title: channel.title, handle: channel.handle });
		} catch (err) {
			account.problem = err instanceof Error ? err.message : String(err);
		}
	}
	return config.google.accounts.filter((account) => account.channelId);
}

/**
 * The channel a post goes out on: exactly the one it names, or the only one
 * when it names none — never a guess between several (accounts.mjs).
 */
export async function youtubeAccount(config, wanted = '') {
	// Several grants and a post naming none: refused, even when only one of
	// them can be read right now — the unreadable one may be the post's.
	if (!wanted && config.google.accounts.length > 1) {
		return pickAccount(config.google.accounts, '', (account) => account.channelId, 'YouTube', SETUP);
	}
	const list = await youtubeChannels(config);
	const unreadable = config.google.accounts.find((account) => !account.channelId && account.problem);
	if (list.length === 0 && unreadable) throw new Error(unreadable.problem);
	return pickAccount(list, wanted, (account) => account.channelId, 'YouTube', SETUP);
}

/**
 * Publishes every channel to the `accounts` collection, so Settings can offer
 * each to a brand, and drops the rows of channels no longer connected. A
 * failed read is said once per channel and leaves its last good row.
 */
export async function refreshYouTubeChannels(pb, config, log, force = false) {
	if (!force && Date.now() - channelsAt < CHANNEL_TTL_MS) return;
	channelsAt = Date.now();
	const now = new Date().toISOString();
	const ids = [];

	for (const account of config.google.accounts) {
		const name = account.title || account.channelId || 'a channel';
		const said = channelErrors.get(account.refreshToken) ?? '';
		try {
			const own = await ownChannel(config, account, { fresh: true });
			Object.assign(account, { channelId: own.id, title: own.title, handle: own.handle });
			ids.push(own.id);
			// For the compose and review screens: a grant that cannot edit
			// cannot add to a playlist or set paid promotion after upload.
			const canEdit = await grantCanEdit(config, account);
			await pb.upsertAccount('youtube', own.id, {
				handle: own.handle,
				name: own.title,
				details: { fetchedAt: now, thumbnail: own.thumbnail, ...(canEdit === null ? {} : { canEdit }) },
				error: '',
				fetched_at: now
			});
			if (said) log(`youtube ${own.title}: recovered`);
			channelErrors.delete(account.refreshToken);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message !== said) {
				log(`youtube ${name} could not be read: ${message.split('\n')[0]}`);
				channelErrors.set(account.refreshToken, message);
			}
			if (account.channelId) {
				ids.push(account.channelId);
				await pb
					.upsertAccount('youtube', account.channelId, { error: message.slice(0, 1900) })
					.catch(() => {});
			}
		}
	}
	await pb.pruneAccounts('youtube', ids).catch(() => {});
}

/** Opens a resumable session and returns the URL the bytes go to. */
async function startSession(token, resource, { size, mimeType, notifySubscribers }) {
	const url = new URL(UPLOAD);
	url.searchParams.set('uploadType', 'resumable');
	url.searchParams.set(
		'part',
		resource.paidProductPlacementDetails
			? 'snippet,status,paidProductPlacementDetails'
			: 'snippet,status'
	);
	url.searchParams.set('notifySubscribers', String(Boolean(notifySubscribers)));

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json; charset=UTF-8',
			'X-Upload-Content-Length': String(size),
			'X-Upload-Content-Type': mimeType
		},
		body: JSON.stringify(resource)
	});

	if (!res.ok) {
		throw new Error(`Could not start the upload (${res.status}): ${await res.text()}`);
	}
	// videos.insert draws on its own bucket of 100 a day, not on the units.
	countUpload();
	const location = res.headers.get('location');
	if (!location) throw new Error('YouTube accepted the metadata but returned no upload URL.');
	return location;
}

/** Counts bytes through the pipe so a multi-GB transfer is not a silent wait. */
function progressMeter(size, onProgress) {
	let sent = 0;
	let reported = 0;
	return new Transform({
		transform(chunk, _enc, done) {
			sent += chunk.length;
			const pct = Math.floor((sent / size) * 100);
			if (pct >= reported + 10) {
				reported = pct;
				onProgress(pct);
			}
			done(null, chunk);
		}
	});
}

/**
 * PUTs the bytes in one streamed request.
 *
 * node:https rather than fetch because the length has to be declared: a stream
 * body through fetch goes out chunked, which the resumable endpoint will not
 * take. A failure here restarts from zero — the session supports byte-range
 * resume, which is the obvious next improvement if a big upload ever drops.
 */
function putVideo(uploadUrl, body, { size, mimeType, onProgress }) {
	return new Promise((resolve, reject) => {
		const url = new URL(uploadUrl);
		const req = httpsRequest(
			{
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				method: 'PUT',
				headers: { 'Content-Length': size, 'Content-Type': mimeType }
			},
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => (text += chunk));
				res.on('end', () => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						try {
							resolve(JSON.parse(text));
						} catch {
							reject(new Error(`Upload finished but the reply was not JSON: ${text.slice(0, 400)}`));
						}
					} else {
						reject(new Error(`Upload failed (${res.statusCode}): ${text.slice(0, 800)}`));
					}
				});
			}
		);
		req.on('error', (err) => reject(describeNetworkError(uploadUrl, err)));

		pipeline(body, progressMeter(size, onProgress), req).catch(reject);
	});
}

/**
 * The playlists a post names, by title: `playlists` (a list, since v0.16.23)
 * and the single `playlist` of rows queued before — trimmed, blanks and
 * repeats (case aside) left out. The page reads them the same way
 * (src/lib/playlists.ts).
 */
export function playlistNames(options) {
	const given = [options?.playlists, options?.playlist].flatMap((v) => (Array.isArray(v) ? v : [v]));
	const seen = new Set();
	const out = [];
	for (const item of given) {
		if (typeof item !== 'string') continue;
		const title = item.trim();
		if (!title || seen.has(title.toLowerCase())) continue;
		seen.add(title.toLowerCase());
		out.push(title);
	}
	return out;
}

/** The channel's playlists, fifty a page (1 unit each), up to 200. */
async function listPlaylists(token) {
	const items = [];
	let pageToken = '';
	for (let page = 0; page < 4; page++) {
		const next = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
		const list = await api(token, `/playlists?part=snippet&mine=true&maxResults=50${next}`, { kind: 'playlist' });
		items.push(...(list.items ?? []));
		pageToken = list.nextPageToken ?? '';
		if (!pageToken) break;
	}
	return items;
}

/** The default grant is upload-only on purpose, so this refusal is expected rather than a fault. */
function grantRefused(err) {
	return /\b(403|401)\b/.test(err.message) || err.message.includes('insufficient');
}

/**
 * Adds the finished video to each named playlist; the names it could not
 * add it to come back.
 *
 * Deliberately non-fatal: the video is already up, and losing the whole publish
 * because a playlist was renamed would be a worse outcome than the video simply
 * not being in it. A refusal of the grant itself is thrown, since it holds
 * for every playlist alike.
 */
async function addToPlaylists(token, videoId, names, log) {
	const list = await listPlaylists(token);
	const missed = [];
	for (const name of names) {
		const wanted = name.toLowerCase();
		const match = list.find((p) => (p.snippet?.title ?? '').trim().toLowerCase() === wanted);
		if (!match) {
			log(`playlist "${name}" not found on the channel — video left out of it`);
			missed.push(name);
			continue;
		}
		try {
			await api(token, '/playlistItems?part=snippet', {
				kind: 'playlist',
				method: 'POST',
				body: JSON.stringify({
					snippet: { playlistId: match.id, resourceId: { kind: 'youtube#video', videoId } }
				})
			});
			log(`added to playlist "${match.snippet.title}"`);
		} catch (err) {
			if (grantRefused(err)) throw err;
			log(`playlist "${match.snippet.title}" add failed (video is still up): ${err.message}`);
			missed.push(name);
		}
	}
	return missed;
}

/**
 * Puts the chosen image on the video. Non-fatal, like the playlist add: the
 * video is already up, and YouTube picks a frame itself if this fails.
 * thumbnails.set costs 50 units, takes up to 2 MB, and only works on a channel
 * YouTube has verified — custom thumbnails are a per-channel feature.
 */
async function setThumbnail(token, videoId, job, pb, log) {
	const image = await pb.openThumbnail(job);
	const res = await fetchOrExplain(`${THUMBNAIL_UPLOAD}?videoId=${videoId}&uploadType=media`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': image.mimeType,
			'Content-Length': String(image.bytes.length)
		},
		body: image.bytes
	});
	charge('other', 50);
	const text = await res.text();
	if (!res.ok) {
		const err = new Error(`thumbnails.set -> ${res.status}: ${text.slice(0, 300)}`);
		err.status = res.status;
		throw err;
	}
	log(`thumbnail set (${Math.round(image.bytes.length / 1024)} KB)`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until YouTube has processed the video and made its own thumbnails,
 * reading processingDetails and the length (1 unit together) every 15 s up
 * to the cap. Returns `{ outcome, seconds }`: `done`, `failed`, `timeout`, or
 * `unreadable` when the reading itself fails — the steps after it go ahead
 * in every case, and the log says which — and the video's length once
 * YouTube has it, else null. `getToken` is asked on every reading, as the
 * wait can outlast a token.
 */
async function waitForProcessing(getToken, videoId, log) {
	const started = Date.now();
	let seconds = null;
	log('waiting for YouTube to finish processing before the thumbnail');
	for (;;) {
		let details;
		try {
			const body = await api(await getToken(), `/videos?part=processingDetails,contentDetails&id=${videoId}`);
			const item = body?.items?.[0];
			details = item?.processingDetails;
			seconds = isoSeconds(item?.contentDetails?.duration) || seconds;
		} catch (err) {
			log(`processing could not be read (${err.message.split('\n')[0]}) — going ahead`);
			return { outcome: 'unreadable', seconds };
		}
		const state = processingState(details);
		const took = Math.round((Date.now() - started) / 1000);
		if (state === 'done') {
			log(`processed after ${took} s`);
			return { outcome: 'done', seconds };
		}
		if (state === 'failed') {
			log(`YouTube reports processing ${details.processingStatus} — going ahead`);
			return { outcome: 'failed', seconds };
		}
		if (Date.now() - started >= PROCESSING_WAIT_MS) {
			log(`still processing after ${Math.round(took / 60)} min — going ahead`);
			return { outcome: 'timeout', seconds };
		}
		await sleep(PROCESSING_POLL_MS);
	}
}

/**
 * Asks YouTube how far an upload session got — the check the worker taking
 * over makes before it uploads a row again (see orphans.mjs). A complete
 * session answers with the video itself; an incomplete one with 308 and the
 * bytes received; an expired or unknown one with 404 or 410.
 */
export async function probeYouTube(config, handle) {
	const account = await youtubeAccount(config, handle.account ?? '');
	const token = await youtubeToken(config, account);
	const url = new URL(handle.uploadUrl);
	const { status, headers, text } = await new Promise((resolve, reject) => {
		const req = httpsRequest(
			{
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Length': 0,
					'Content-Range': `bytes */${handle.size}`
				}
			},
			(res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => (body += chunk));
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: body }));
			}
		);
		req.on('error', (err) => reject(describeNetworkError(handle.uploadUrl, err)));
		req.end();
	});

	if (status === 200 || status === 201) {
		const video = JSON.parse(text);
		return { state: 'done', result: resultOf(video, Boolean(video.status?.publishAt)) };
	}
	if (status === 308) {
		// "bytes=0-1234" once anything has arrived; no header at all before that.
		const match = /bytes=\d+-(\d+)/.exec(String(headers.range ?? ''));
		return { state: 'uploading', bytes: match ? Number(match[1]) + 1 : 0 };
	}
	if (status === 404 || status === 410) return { state: 'gone', reason: `the upload session has expired (${status})` };
	throw new Error(`YouTube upload status -> ${status}: ${text.slice(0, 300)}`);
}

function resultOf(video, scheduled) {
	return {
		videoId: video.id,
		url: `https://www.youtube.com/watch?v=${video.id}`,
		scheduled,
		privacyStatus: video.status?.privacyStatus
	};
}

/**
 * A token for changing a video on the channel a post went out on — for a
 * delete (moves.mjs) or a new release time (reschedule.mjs). Only through
 * the channel's own grant, checked like an upload, and only a broad grant
 * can: an upload-only one is refused here rather than by YouTube.
 */
async function editingToken(config, channelId, doing) {
	const account = await youtubeAccount(config, channelId);
	const own = await ownChannel(config, account);
	if (own.id !== account.channelId) {
		throw new Error(
			`The grant listed for the YouTube channel ${account.channelId} belongs to "${own.title}" (${own.id}). ` +
				`Not ${doing} anything. Re-connect the channel with:  ${SETUP}`
		);
	}
	if ((await grantCanEdit(config, account)) === false) {
		throw new Error(
			`${own.title}'s grant is upload-only and cannot change videos. Sign it in again with:  ${SETUP} --with-playlists`
		);
	}
	return { token: await youtubeToken(config, account), channel: own.title };
}

/**
 * Deletes a video from the channel a post went out on, for a post moved to
 * another brand (moves.mjs) — 50 units. A video YouTube no longer has
 * counts as deleted.
 */
export async function deleteYouTubeVideo(config, channelId, videoId) {
	const { token, channel } = await editingToken(config, channelId, 'deleting');
	try {
		await api(token, `/videos?id=${encodeURIComponent(videoId)}`, { method: 'DELETE', kind: 'delete' });
		return { channel, alreadyGone: false };
	} catch (err) {
		if (/ -> 404\b/.test(err.message)) return { channel, alreadyGone: true };
		throw err;
	}
}

/** The channel and video a scheduled YouTube post names. */
function postVideo(row) {
	const videoId = youtubeVideoId(row.remote_url);
	if (!videoId) throw new Error('its YouTube link names no video');
	return { channelId: row.account || row.handle?.account || '', videoId };
}

/** A video's `status`, or an error when YouTube no longer has it — 1 unit, charged to `kind`. */
async function videoStatus(token, videoId, kind) {
	const body = await api(token, `/videos?part=status&id=${encodeURIComponent(videoId)}`, { kind });
	const status = body?.items?.[0]?.status;
	if (!status) throw new Error('YouTube no longer has the video');
	return status;
}

/** Held by YouTube for its time: private, with a `publishAt` it will act on. */
function heldStatus(status) {
	return status.privacyStatus === 'private' && Boolean(status.publishAt);
}

/**
 * What goes back as `status` to move a video's release: videos.update wants
 * every mutable field of a part it is sent, or resets the ones left out, so
 * it is what was read with only the time changed. Read-only fields (upload
 * state, `madeForKids`) stay out.
 */
export function statusPatch(status, at) {
	const keep = ['license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia'];
	const out = {};
	for (const key of keep) if (status?.[key] !== undefined) out[key] = status[key];
	return { ...out, privacyStatus: 'private', publishAt: new Date(at).toISOString() };
}

/**
 * Gives a video YouTube holds for its time another one, for a post moved in
 * the Calendar (reschedule.mjs) — 51 units: the status read, then the
 * update. Refused when YouTube has put it out already. Returns the time
 * YouTube now holds, as it answers.
 */
export async function rescheduleYouTube(config, row, at) {
	const { channelId, videoId } = postVideo(row);
	const { token } = await editingToken(config, channelId, 'moving');
	const status = await videoStatus(token, videoId, 'move');
	if (!heldStatus(status)) throw new Error('YouTube has put it out already');
	const body = await api(token, '/videos?part=status', {
		kind: 'move',
		method: 'PUT',
		body: JSON.stringify({ id: videoId, status: statusPatch(status, at) })
	});
	const release = body?.status?.publishAt;
	if (!release || Math.floor(Date.parse(release) / 1000) !== Math.floor(Date.parse(at) / 1000)) {
		throw new Error(`YouTube answered with ${release || 'no time'} for ${at}`);
	}
	return { release };
}

/**
 * What goes back as `status` to put a held video out now: as `statusPatch`,
 * but public and with no `publishAt` — the part is written whole, so leaving
 * the time out is what clears it.
 */
export function publicPatch(status) {
	const { publishAt: _at, ...rest } = statusPatch(status, 0);
	return { ...rest, privacyStatus: 'public' };
}

/**
 * Makes a video YouTube holds for its time public now, for "Release
 * immediately" in the Calendar (requests.mjs) — 51 units. One YouTube put
 * out already counts as done.
 */
export async function releaseYouTubeNow(config, row) {
	const { channelId, videoId } = postVideo(row);
	const { token } = await editingToken(config, channelId, 'releasing');
	const status = await videoStatus(token, videoId, 'release');
	if (!heldStatus(status)) {
		if (status.privacyStatus === 'public') return { alreadyOut: true };
		throw new Error(`YouTube no longer holds it for a time (it is ${status.privacyStatus}); nothing changed`);
	}
	const body = await api(token, '/videos?part=status', {
		kind: 'release',
		method: 'PUT',
		body: JSON.stringify({ id: videoId, status: publicPatch(status) })
	});
	if (body?.status?.privacyStatus !== 'public' || body?.status?.publishAt) {
		throw new Error(`YouTube answered ${body?.status?.privacyStatus ?? 'nothing'}${body?.status?.publishAt ? ` at ${body.status.publishAt}` : ''}`);
	}
	return { alreadyOut: false };
}

/**
 * Gives a video on the channel another title, for a rename on the Dashboard
 * (retitle.mjs) — 51 units: the snippet read, then the update with it
 * written back whole. Returns what YouTube had and the snippet it answered
 * with; a video that has the title already is left alone.
 */
export async function retitleYouTube(config, channelId, videoId, title) {
	const { token } = await editingToken(config, channelId, 'renaming');
	const read = await api(token, `/videos?part=snippet&id=${encodeURIComponent(videoId)}`, { kind: 'rename' });
	const snippet = read?.items?.[0]?.snippet;
	if (!snippet) throw new Error('YouTube no longer has the video');
	const before = snippet.title ?? '';
	if (sameTitle(before, title)) return { before, title: before, snippet, unchanged: true };
	const body = await api(token, '/videos?part=snippet', {
		kind: 'rename',
		method: 'PUT',
		body: JSON.stringify({ id: videoId, snippet: snippetPatch(snippet, title) })
	});
	const now = body?.snippet?.title;
	if (!sameTitle(now, title)) throw new Error(`YouTube answered with ${now ? `"${now}"` : 'no title'}`);
	return { before, title: now, snippet: body.snippet, unchanged: false };
}

/**
 * What goes back as `snippet` for an edit (uploadedit.ts): as `snippetPatch`,
 * the snippet as read written back whole, with the title, description and
 * tags the edit gives — cut to YouTube's lengths as an upload is.
 */
export function editedSnippet(snippet, { title, description, tags }) {
	return {
		...snippetPatch(snippet, (title || 'Untitled').slice(0, 100)),
		description: (description || '').slice(0, 5000),
		tags: Array.isArray(tags) ? tags : []
	};
}

/**
 * Whether YouTube's snippet already holds what an edit gives — line ends
 * and trailing space aside, which YouTube may tidy, and tags case aside.
 */
export function snippetHolds(snippet, { title, description, tags }) {
	const text = (value) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
	const list = (value) => JSON.stringify((Array.isArray(value) ? value : []).map((t) => String(t).toLowerCase()));
	return (
		sameTitle(snippet?.title, (title || 'Untitled').slice(0, 100)) &&
		text(snippet?.description) === text((description || '').slice(0, 5000)) &&
		list(snippet?.tags) === list(tags)
	);
}

/**
 * The playlists an edit adds the video to and takes it out of, compared
 * case aside, as the adds always were.
 */
export function playlistChanges(before, after) {
	const had = playlistNames(before);
	const wanted = playlistNames(after);
	const lower = (list) => list.map((name) => name.toLowerCase());
	return {
		add: wanted.filter((name) => !lower(had).includes(name.toLowerCase())),
		remove: had.filter((name) => !lower(wanted).includes(name.toLowerCase()))
	};
}

/**
 * Takes the video out of each named playlist: its entries found
 * (playlistItems.list, 1 unit) and deleted (50 each). The names it could not
 * take it out of come back; a refusal of the grant itself is thrown.
 */
async function removeFromPlaylists(token, videoId, names, log) {
	const list = await listPlaylists(token);
	const missed = [];
	for (const name of names) {
		const match = list.find((p) => (p.snippet?.title ?? '').trim().toLowerCase() === name.toLowerCase());
		if (!match) {
			log(`playlist "${name}" not found on the channel — nothing to take the video out of`);
			continue;
		}
		try {
			const items = await api(
				token,
				`/playlistItems?part=id&maxResults=50&playlistId=${encodeURIComponent(match.id)}&videoId=${encodeURIComponent(videoId)}`,
				{ kind: 'playlist' }
			);
			for (const item of items?.items ?? []) {
				await api(token, `/playlistItems?id=${encodeURIComponent(item.id)}`, { kind: 'playlist', method: 'DELETE' });
			}
			log(`taken out of playlist "${match.snippet.title}"`);
		} catch (err) {
			if (grantRefused(err)) throw err;
			log(`playlist "${match.snippet.title}" could not be left: ${err.message}`);
			missed.push(name);
		}
	}
	return missed;
}

/**
 * Edits a video on the channel a post went out on, as an edit in the upload
 * wizard asked (requests.mjs `retext`): its title, description and tags —
 * 51 units, the snippet read and written back whole, skipped when YouTube
 * holds them already — then the playlists it joins or leaves. What could not
 * be done with the playlists comes back with the snippet YouTube answered.
 */
export async function editYouTube(config, row, edit, { log = () => {} } = {}) {
	const { channelId, videoId } = postVideo(row);
	const { token } = await editingToken(config, channelId, 'editing');
	const read = await api(token, `/videos?part=snippet&id=${encodeURIComponent(videoId)}`, { kind: 'edit' });
	const snippet = read?.items?.[0]?.snippet;
	if (!snippet) throw new Error('YouTube no longer has the video');
	const text = { title: edit.title, description: edit.description, tags: edit.options?.tags };
	let answered = snippet;
	if (!snippetHolds(snippet, text)) {
		const body = await api(token, '/videos?part=snippet', {
			kind: 'edit',
			method: 'PUT',
			body: JSON.stringify({ id: videoId, snippet: editedSnippet(snippet, text) })
		});
		// The title is what proves it, as for a rename: YouTube may tidy the rest.
		if (!sameTitle(body?.snippet?.title, (text.title || 'Untitled').slice(0, 100))) {
			throw new Error(`YouTube answered with ${body?.snippet?.title ? `"${body.snippet.title}"` : 'no title'}`);
		}
		answered = body.snippet;
	}
	const { add, remove } = playlistChanges(edit.before?.options, edit.options);
	const notAdded = add.length > 0 ? await addToPlaylists(token, videoId, add, log) : [];
	const notLeft = remove.length > 0 ? await removeFromPlaylists(token, videoId, remove, log) : [];
	const notes = [...notAdded.map((n) => `not added to playlist "${n}"`), ...notLeft.map((n) => `still in playlist "${n}"`)];
	return { snippet: answered, textChanged: answered !== snippet, notAdded, notLeft, notes };
}

/**
 * The time YouTube holds a post's video for, or that it is out — for an
 * upload from before flock kept that (reschedule.mjs `learn`). 1 unit; any
 * grant that reads the channel will do.
 */
export async function youtubeRelease(config, row) {
	const { channelId, videoId } = postVideo(row);
	const token = await youtubeToken(config, await youtubeAccount(config, channelId));
	const status = await videoStatus(token, videoId, 'move').catch((err) => {
		if (/no longer has/.test(err.message)) return null;
		throw err;
	});
	return status && heldStatus(status) ? { at: status.publishAt } : { out: true };
}

export async function publishToYouTube({ target, job, pb, config, log, saveHandle }) {
	const options = target.options ?? {};
	const release = resolveRelease(options, target.scheduled_at);

	// The channel the post's brand chose, or none at all: a post for a channel
	// this worker holds no grant for is refused before a byte goes anywhere.
	const account = await youtubeAccount(config, target.account ?? '');
	let token = await youtubeToken(config, account);

	// And the grant must still upload where the config says it does — a
	// hand-edited list must not send a brand's video to another channel.
	const own = await ownChannel(config, account);
	if (own.id !== account.channelId) {
		throw new Error(
			`The grant listed for the YouTube channel ${account.channelId} uploads to "${own.title}" ` +
				`(${own.id}). Not uploading. Re-connect the channel with:  ${SETUP}`
		);
	}
	log(`uploading to the channel ${own.title}${own.handle ? ` (${own.handle})` : ''}`);

	const video = await pb.openVideo(job);

	const resource = buildResource(target, options, release);
	log(
		`uploading ${job.video_name || job.video} (${(video.size / 1024 / 1024).toFixed(1)} MB) as ` +
			`${release.privacyStatus}${release.publishAt ? `, public at ${release.publishAt}` : ''}`
	);

	let uploadUrl;
	try {
		uploadUrl = await startSession(token, resource, {
			size: video.size,
			mimeType: video.mimeType,
			notifySubscribers: options.notifySubscribers
		});
	} catch (err) {
		// A stale cached token is the one failure worth a single silent retry.
		if (!String(err.message).includes('401')) throw err;
		forgetToken(account.refreshToken);
		token = await youtubeToken(config, account);
		uploadUrl = await startSession(token, resource, {
			size: video.size,
			mimeType: video.mimeType,
			notifySubscribers: options.notifySubscribers
		});
	}

	// Recorded before a byte goes up, and the upload does not start unless it
	// was: it is how a worker taking over finds out how far this got.
	try {
		await saveHandle({ kind: 'youtube-session', uploadUrl, size: video.size, account: account.channelId });
	} catch (err) {
		video.stream.destroy();
		throw err;
	}

	const result = await putVideo(uploadUrl, video.stream, {
		size: video.size,
		mimeType: video.mimeType,
		onProgress: (pct) => log(`  ${pct}%`)
	});

	const videoId = result.id;
	const url = `https://www.youtube.com/watch?v=${videoId}`;
	const got = result.status?.privacyStatus;

	// An unaudited API project has every upload locked to private, whatever was
	// asked for. Saying so here is the difference between "the schedule is
	// broken" and "the project has not been audited yet".
	let locked = false;
	if (got === 'private' && release.wanted !== 'private' && !release.publishAt) {
		locked = true;
		log(
			`YouTube stored this as private although ${release.wanted} was requested — ` +
				'that is the unaudited-API-project restriction, not a flock bug.'
		);
	}

	// What did not reach YouTube and has to be set in Studio; the log entry
	// for the release names it, with the video's Studio page.
	const todo = [];

	// Paid promotion went with the insert, and the API reads it back as on —
	// but on 11 Oct 2026 viewers never got the notice until it was ticked in
	// Studio. So it is always a Studio step; the request stays in case
	// YouTube starts honouring it.
	if (options.paidPromotion) {
		log("paid promotion sent, but YouTube's API does not apply it — tick it in Studio");
		todo.push('paid promotion');
	}

	// A long upload (and the wait below) can outlast the hour an access token
	// lives. A failed refresh must not fail the publish: the video is up, and
	// a failed row would be uploaded again.
	const freshToken = () => youtubeToken(config, account).catch(() => token);
	token = await freshToken();

	const playlists = playlistNames(options);
	if (playlists.length > 0) {
		const which = playlists.length === 1 ? 'playlist' : 'playlists';
		try {
			const missed = await addToPlaylists(token, videoId, playlists, log);
			if (missed.length > 0) todo.push(missed.length === 1 ? 'playlist' : 'playlists');
		} catch (err) {
			// Name the cause instead of the status when it is the grant.
			log(
				grantRefused(err)
					? `${which} skipped: the upload-only grant cannot touch playlists. ` +
							'Re-authorise with `pnpm worker:auth --with-playlists` to allow it.'
					: `playlist add failed (video is still up): ${err.message}`
			);
			todo.push(which);
		}
	}

	if (job.thumbnail) {
		const { seconds } = await waitForProcessing(freshToken, videoId, log);
		token = await freshToken();
		try {
			await setThumbnail(token, videoId, job, pb, log);
			if (isShortVideo(seconds) !== false) {
				log(
					`${seconds ? 'a Short' : 'length unknown, so possibly a Short'}: its cover is set in Studio — ` +
						'the image above only becomes the 16:9 thumbnail'
				);
				todo.push('Shorts cover');
			}
		} catch (err) {
			log(
				err.status === 403
					? 'thumbnail skipped: YouTube refused it. Custom thumbnails need a verified ' +
							'channel (youtube.com/verify). The video is up without it.'
					: `thumbnail failed (video is still up): ${err.message}`
			);
			todo.push('thumbnail');
		}
	}

	return { videoId, url, scheduled: release.scheduled, privacyStatus: got, locked, todo, todoUrl: studioUrl(videoId) };
}
