// The YouTube adapter: one upload_targets row -> one video on the channel.
//
// Everything it reads out of `options` is a field that videos.insert actually
// accepts. The mapping lives here rather than in platforms.ts so the registry
// stays a description of the interface, not of Google's wire format.

import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { accessToken, forgetToken } from './google.mjs';
import { pickAccount } from './accounts.mjs';
import { fetchOrExplain } from './net.mjs';

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

async function api(token, path, options = {}) {
	const res = await fetchOrExplain(`${API}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			...options.headers
		}
	});
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
	const body = await api(token, '/channels?part=snippet&mine=true');
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
			await pb.upsertAccount('youtube', own.id, {
				handle: own.handle,
				name: own.title,
				details: { fetchedAt: now, thumbnail: own.thumbnail },
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
		req.on('error', reject);

		pipeline(body, progressMeter(size, onProgress), req).catch(reject);
	});
}

/**
 * Adds the finished video to a playlist by name.
 *
 * Deliberately non-fatal: the video is already up, and losing the whole publish
 * because a playlist was renamed would be a worse outcome than the video simply
 * not being in it.
 */
async function addToPlaylist(token, videoId, name, log) {
	const wanted = name.trim().toLowerCase();
	const list = await api(token, '/playlists?part=snippet&mine=true&maxResults=50');
	const match = (list.items ?? []).find((p) => (p.snippet?.title ?? '').trim().toLowerCase() === wanted);

	if (!match) {
		log(`playlist "${name}" not found on the channel — video left out of it`);
		return;
	}
	await api(token, '/playlistItems?part=snippet', {
		method: 'POST',
		body: JSON.stringify({
			snippet: { playlistId: match.id, resourceId: { kind: 'youtube#video', videoId } }
		})
	});
	log(`added to playlist "${match.snippet.title}"`);
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
	const text = await res.text();
	if (!res.ok) {
		const err = new Error(`thumbnails.set -> ${res.status}: ${text.slice(0, 300)}`);
		err.status = res.status;
		throw err;
	}
	log(`thumbnail set (${Math.round(image.bytes.length / 1024)} KB)`);
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
		req.on('error', reject);
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

	if (job.thumbnail) {
		try {
			await setThumbnail(token, videoId, job, pb, log);
		} catch (err) {
			log(
				err.status === 403
					? 'thumbnail skipped: YouTube refused it. Custom thumbnails need a verified ' +
							'channel (youtube.com/verify). The video is up without it.'
					: `thumbnail failed (video is still up): ${err.message}`
			);
		}
	}

	if (options.playlist && String(options.playlist).trim()) {
		try {
			await addToPlaylist(token, videoId, String(options.playlist), log);
		} catch (err) {
			// The default grant is upload-only on purpose, so this is the expected
			// outcome rather than a fault — name the cause instead of the status.
			const denied = /\b(403|401)\b/.test(err.message) || err.message.includes('insufficient');
			log(
				denied
					? 'playlist skipped: the upload-only grant cannot touch playlists. ' +
							'Re-authorise with `pnpm worker:auth --with-playlists` to allow it.'
					: `playlist add failed (video is still up): ${err.message}`
			);
		}
	}

	return { videoId, url, scheduled: release.scheduled, privacyStatus: got, locked };
}
