// The Instagram adapter: one upload_targets row -> one Reel on the account,
// through the Instagram API with Instagram Login.
//
// Instagram cannot schedule either, but its publishing comes in two halves: a
// container is created and the bytes uploaded and processed first, and a
// separate media_publish call is what puts it on the profile. So the loop
// hands a target over a few minutes ahead of its slot, the container is made
// ready, and the publish call waits for the minute — the one platform here
// that can hit it. Everything read out of `options` is a parameter the
// container call actually takes.

import { fetchOrExplain, isNetworkError } from './net.mjs';
import { saveSection } from './config.mjs';
import { streamRequest, videoMime, sleep, msUntil, MiB } from './upload.mjs';

/**
 * The cover server (covers.mjs), when the worker runs one. Instagram takes a
 * custom cover only as a public address it fetches, never as bytes, so a
 * reel's cover image is leased to that server for the length of the publish.
 * Null means no public address is configured, and the frame at the cover
 * time is used instead.
 */
let covers = null;

export function setCoverServer(server) {
	covers = server;
}

const GRAPH = 'https://graph.instagram.com';
const UPLOAD = 'https://rupload.facebook.com/ig-api-upload';

/** Reading the account, and publishing to it. Nothing about comments or insights. */
export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

// Instagram's stated limits for a Reel.
const MAX_BYTES = 1024 * MiB;
const MIN_SECONDS = 3;
const MAX_SECONDS = 15 * 60;
const ACCEPTED_MIME = new Set(['video/mp4', 'video/quicktime']);
const CAPTION_LIMIT = 2200;
const MAX_COLLABORATORS = 3;

// The container is polled this often and for this long. Instagram suggests
// once a minute for five minutes; a long reel can take more. A poll that
// cannot reach Instagram is a missed poll, not a failed reel; this many in a
// row, with the wait growing to three intervals, is when it stops.
const STATUS_EVERY_MS = 10_000;
const STATUS_TIMEOUT_MS = 30 * 60_000;
const MAX_STATUS_MISSES = 12;
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

// How often the account's details are re-read for the compose screen.
const ACCOUNT_TTL_MS = 30 * 60_000;

// A long-lived token lasts sixty days and can be renewed once it is a day
// old; renewing at a month leaves a month of slack for a worker left off.
const DAY_MS = 24 * 60 * 60_000;
const RENEW_AFTER_MS = 30 * DAY_MS;
const DEFAULT_LIFE_MS = 60 * DAY_MS;

const REAUTH = 'Re-authorise with:  pnpm worker:auth --instagram';

function base(config) {
	return `${GRAPH}/${config.instagram.apiVersion}`;
}

let renewError = '';

/**
 * Renews the long-lived token when it is due, writing the new one back.
 *
 * Instagram will not renew a token under a day old or one already expired,
 * so this runs on the token's age rather than on every call. `force` is for
 * a token the API has just rejected: if that cannot be renewed either, the
 * only way forward is the consent flow again.
 */
export async function renewToken(config, { force = false } = {}) {
	const ig = config.instagram;
	if (!ig.accessToken) throw new Error(`No Instagram access token. ${REAUTH}`);
	const obtained = Date.parse(ig.tokenObtainedAt) || 0;
	const expires = Date.parse(ig.tokenExpiresAt) || obtained + DEFAULT_LIFE_MS;
	const age = Date.now() - obtained;
	if (!force && age < RENEW_AFTER_MS && expires - Date.now() > RENEW_AFTER_MS) return false;
	if (age < DAY_MS + 5 * 60_000) {
		if (force) {
			throw new Error(`Instagram rejected a token under a day old, which cannot be renewed yet. ${REAUTH}`);
		}
		return false;
	}

	const url = new URL(`${GRAPH}/refresh_access_token`);
	url.searchParams.set('grant_type', 'ig_refresh_token');
	url.searchParams.set('access_token', ig.accessToken);
	const res = await fetchOrExplain(url);
	const text = await res.text();
	if (!res.ok) {
		const message = `Instagram would not renew the token (${res.status}): ${text.slice(0, 300)}`;
		if (force) throw new Error(`${message}\nIt has expired or been revoked. ${REAUTH}`);
		renewError = message;
		return false;
	}

	const body = JSON.parse(text);
	const now = new Date();
	ig.accessToken = body.access_token;
	ig.tokenObtainedAt = now.toISOString();
	ig.tokenExpiresAt = new Date(
		now.getTime() + (Number(body.expires_in) || DEFAULT_LIFE_MS / 1000) * 1000
	).toISOString();
	saveSection('instagram', {
		accessToken: ig.accessToken,
		tokenObtainedAt: ig.tokenObtainedAt,
		tokenExpiresAt: ig.tokenExpiresAt
	});
	renewError = '';
	return true;
}

/** The token to use, renewed first if it is time. */
export async function accessToken(config) {
	await renewToken(config);
	return config.instagram.accessToken;
}

class GraphError extends Error {
	constructor(err, status) {
		const code = err.code ?? status;
		const sub = err.error_subcode ? `/${err.error_subcode}` : '';
		const trace = err.fbtrace_id ? ` (trace ${err.fbtrace_id})` : '';
		super(`Instagram ${code}${sub}: ${err.error_user_msg || err.message || 'unknown error'}${trace}`);
		this.code = Number(err.code ?? status);
		this.subcode = Number(err.error_subcode ?? 0);
		this.status = status;
	}
}

/**
 * One Graph API call. Parameters go in the query for a GET and the form body
 * for a POST; objects and arrays are sent as JSON, which is how the API takes
 * a list of collaborators. A token the API has just rejected (code 190) is
 * renewed and the call retried once.
 */
async function graph(config, path, { method = 'GET', params = {}, retry = true } = {}) {
	const token = await accessToken(config);
	const url = new URL(`${base(config)}${path}`);
	const form = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === '') continue;
		form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
	}
	form.set('access_token', token);

	let res;
	if (method === 'GET') {
		url.search = form.toString();
		res = await fetchOrExplain(url);
	} else {
		res = await fetchOrExplain(url, {
			method,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: form
		});
	}
	const text = await res.text();
	let json = {};
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		// Reported below with the status.
	}
	if (!res.ok || json.error) {
		const err = json.error ?? { message: text.slice(0, 300) };
		if (Number(err.code) === 190 && retry) {
			await renewToken(config, { force: true });
			return graph(config, path, { method, params, retry: false });
		}
		throw new GraphError(err, res.status);
	}
	return json;
}

/** What a Graph error means for the person reading the log. */
function explain(err) {
	if (!(err instanceof GraphError)) return err;
	const byCode = {
		190: `The Instagram token is dead. ${REAUTH}`,
		10: 'The Instagram grant lacks the permission for this, or the account is not a professional (Business or Creator) account.',
		200: 'The Instagram grant lacks the permission for this, or the account is not a professional (Business or Creator) account.',
		4: 'Instagram rate limit hit; upload again later.',
		17: 'Instagram rate limit hit; upload again later.',
		32: 'Instagram rate limit hit; upload again later.',
		613: 'Instagram rate limit hit; upload again later.'
	};
	const bySubcode = {
		2207001: 'Instagram says this account is not eligible to publish through the API (it must be a Business or Creator account).',
		2207003: 'Instagram timed out reading the video.',
		2207026: 'Instagram does not support this video. It takes MP4 or MOV with H.264/HEVC video and AAC audio, 23 to 60 fps.',
		2207027: 'The media was not ready to publish.',
		2207032: 'Instagram failed to create the media.',
		2207042: "Instagram's publishing limit for this account (100 posts a day) is reached.",
		2207050: 'The Instagram account is restricted from publishing.',
		2207051: 'Instagram blocked the post as spam.',
		2207053: 'Instagram reported an unknown upload error. Upload again.'
	};
	const hint = bySubcode[err.subcode] ?? byCode[err.code];
	return hint ? new Error(`${hint} (${err.message})`) : err;
}

/**
 * Who the token posts as, plus how much of the day's publishing allowance
 * is used. The allowance is informational — the account itself answering is
 * the check that matters — so a failure there is swallowed.
 */
export async function accountInfo(config) {
	const me = await graph(config, '/me', { params: { fields: 'user_id,username,account_type,name' } });
	const info = {
		userId: String(me.user_id ?? me.id ?? ''),
		username: me.username ?? '',
		accountType: me.account_type ?? '',
		name: me.name ?? '',
		quotaUsed: null,
		quotaTotal: null
	};
	try {
		const limit = await graph(config, '/me/content_publishing_limit', {
			params: { fields: 'quota_usage,config' }
		});
		const row = limit.data?.[0];
		if (row) {
			info.quotaUsed = Number(row.quota_usage ?? 0);
			info.quotaTotal = Number(row.config?.quota_total ?? 0);
		}
	} catch {
		// Informational only.
	}
	return info;
}

/** The container's parameters, from the target's options. */
function buildContainer(target, options, durationSeconds) {
	const params = {
		media_type: 'REELS',
		upload_type: 'resumable',
		caption: (target.description || target.title || '').slice(0, CAPTION_LIMIT),
		share_to_feed: options.shareToFeed !== false
	};

	// Seconds in the registry, milliseconds on the wire, and never past the
	// end of the video.
	const cover = Number(options.coverFrame);
	if (Number.isFinite(cover) && cover > 0) {
		let ms = Math.round(cover * 1000);
		if (durationSeconds > 0) ms = Math.min(ms, Math.max(0, durationSeconds * 1000 - 500));
		params.thumb_offset = ms;
	}

	const collaborators = (Array.isArray(options.collaborators) ? options.collaborators : [])
		.map((handle) => String(handle).trim().replace(/^@/, ''))
		.filter(Boolean)
		.slice(0, MAX_COLLABORATORS);
	if (collaborators.length > 0) params.collaborators = collaborators;

	const audio = String(options.audioName ?? '').trim();
	if (audio) params.audio_name = audio;
	return params;
}

/**
 * Sends the bytes to the container in one declared-length POST, the way the
 * resumable upload endpoint documents it. A byte range resume exists in the
 * protocol; a failure here restarts from zero, as YouTube's does.
 */
async function uploadBytes(config, container, video, log) {
	const token = await accessToken(config);
	const url = container.uri || `${UPLOAD}/${config.instagram.apiVersion}/${container.id}`;
	const res = await streamRequest({
		url,
		method: 'POST',
		headers: {
			Authorization: `OAuth ${token}`,
			offset: '0',
			file_size: String(video.size),
			'Content-Type': 'application/octet-stream'
		},
		body: video.stream,
		size: video.size,
		onProgress: (pct) => log(`  ${pct}%`)
	});
	let body = {};
	try {
		body = JSON.parse(res.text);
	} catch {
		// Reported below with the status.
	}
	if (res.status < 200 || res.status >= 300 || body.success === false || body.error) {
		const err = body.error ?? {};
		throw new Error(
			`Instagram refused the upload (${res.status}): ${err.message || res.text.slice(0, 300)}`
		);
	}
}

/**
 * Polls the container until Instagram has processed the video.
 *
 * A poll that cannot reach Instagram, or gets a server error or a rate
 * limit, is a missed poll rather than a failed reel: the container is
 * Instagram's to finish. Only a definite answer, too many misses in a row,
 * or the overall cap ends the wait. Nothing is published until the publish
 * call, so giving up here leaves no stray post behind.
 */
async function waitForContainer(config, id, log) {
	const started = Date.now();
	let last = '';
	let misses = 0;
	while (Date.now() - started < STATUS_TIMEOUT_MS) {
		let container;
		try {
			container = await graph(config, `/${id}`, { params: { fields: 'status_code,status' } });
			misses = 0;
		} catch (err) {
			const transient =
				isNetworkError(err) ||
				(err instanceof GraphError && (err.status >= 500 || RATE_LIMIT_CODES.has(err.code)));
			if (!transient) throw err;
			misses += 1;
			if (misses > MAX_STATUS_MISSES) {
				throw new Error(`Lost Instagram while it was processing container ${id}: ${err.message.split('\n')[0]}`);
			}
			log(`status poll failed (${err.message.split('\n')[0]}) — retrying`);
			await sleep(STATUS_EVERY_MS * Math.min(misses, 3));
			continue;
		}
		const code = String(container.status_code || '');
		if (code !== last) {
			log(`Instagram: ${code.toLowerCase().replace(/_/g, ' ') || 'no status yet'}`);
			last = code;
		}
		if (code === 'FINISHED' || code === 'PUBLISHED') return;
		if (code === 'ERROR') {
			throw new Error(`Instagram could not process the video: ${container.status || 'no detail given'}`);
		}
		if (code === 'EXPIRED') throw new Error('The Instagram container expired before it was published.');
		await sleep(STATUS_EVERY_MS);
	}
	throw new Error(
		`Instagram was still processing container ${id} after ${STATUS_TIMEOUT_MS / 60000} minutes.`
	);
}

/**
 * Publishes a finished container. Instagram occasionally answers "not ready"
 * for a container it has just called FINISHED, so that one answer is retried
 * a few times before it counts as a failure.
 */
async function publishContainer(config, id) {
	let last;
	for (let attempt = 1; attempt <= 6; attempt++) {
		try {
			return await graph(config, '/me/media_publish', { method: 'POST', params: { creation_id: id } });
		} catch (err) {
			last = err;
			const notReady =
				err instanceof GraphError &&
				(err.subcode === 2207027 || /not ready|try again|in progress/i.test(err.message));
			// A lost network at the minute is retried the same way: nothing has
			// been published, so a second call is safe.
			if (!notReady && !isNetworkError(err)) throw err;
			await sleep(15_000);
		}
	}
	throw last;
}

export async function publishToInstagram({ target, job, pb, config, log }) {
	const options = target.options ?? {};
	const name = job.video_name || job.video;
	const duration = Number(job.video_duration) || 0;
	if (duration > 0 && (duration < MIN_SECONDS || duration > MAX_SECONDS)) {
		throw new Error(
			`Instagram takes Reels between 3 seconds and 15 minutes; this one runs ${Math.round(duration)}s.`
		);
	}

	const video = await pb.openVideo(job);
	const mime = videoMime(video, name);
	if (!ACCEPTED_MIME.has(mime)) {
		video.stream.destroy();
		throw new Error(`Instagram takes MP4 or MOV; ${name} is ${mime}.`);
	}
	if (video.size > MAX_BYTES) {
		video.stream.destroy();
		throw new Error(`Instagram caps a Reel at 1 GB; this one is ${(video.size / MiB).toFixed(0)} MB.`);
	}

	const params = buildContainer(target, options, duration);

	// A custom cover is leased to the cover server for Instagram to fetch while
	// the container is processed, and released the moment that is over. With
	// no server configured the frame at the cover time stands in, and the log
	// says so, because the reel still goes out.
	let lease = null;
	if (job.cover) {
		if (covers) {
			const image = await pb.openCover(job);
			lease = covers.lease(image.bytes, image.mimeType);
			params.cover_url = lease.url;
			delete params.thumb_offset;
			log(`cover: ${job.cover} served to Instagram from ${lease.url}`);
		} else {
			log(
				'cover skipped: no instagram.coverPublicBase in the worker config, ' +
					'so Instagram uses the frame at the cover time'
			);
		}
	}

	let container;
	try {
		container = await graph(config, '/me/media', { method: 'POST', params });
	} catch (err) {
		lease?.release();
		video.stream.destroy();
		throw explain(err);
	}
	if (!container.id) {
		lease?.release();
		video.stream.destroy();
		throw new Error('Instagram returned no container id.');
	}

	log(`uploading ${name} (${(video.size / MiB).toFixed(1)} MB) into container ${container.id}`);
	try {
		await uploadBytes(config, container, video, log);
		await waitForContainer(config, container.id, log);
	} catch (err) {
		throw explain(err);
	} finally {
		lease?.release();
	}

	// The container is ready; the publish call is what hits the minute.
	const wait = msUntil(target.scheduled_at);
	if (wait > 0) {
		log(
			`ready — holding until ${new Date(target.scheduled_at).toLocaleTimeString()} ` +
				`(${Math.round(wait / 1000)}s)`
		);
		await sleep(wait);
	} else if (wait < -60_000) {
		log(`ready ${Math.round(-wait / 60000)} min past the slot — publishing now`);
	}

	let published;
	try {
		published = await publishContainer(config, container.id);
	} catch (err) {
		throw explain(err);
	}
	const mediaId = String(published.id ?? '');

	let url = config.instagram.username
		? `https://www.instagram.com/${config.instagram.username}/`
		: 'https://www.instagram.com/';
	try {
		const media = await graph(config, `/${mediaId}`, { params: { fields: 'permalink' } });
		if (media.permalink) url = media.permalink;
	} catch {
		// The reel is up; the permalink is a nicety.
	}

	return {
		url,
		mediaId,
		containerId: container.id,
		scheduled: false,
		privacyStatus: params.share_to_feed ? 'a reel, shown in the feed too' : 'a reel, in the Reels tab only'
	};
}

let accountAt = 0;
let accountError = '';

/**
 * Publishes the account's details to `app_settings` / `instagram_account`,
 * the same arrangement as TikTok's creator row and the YouTube playlists:
 * the browser holds no Instagram credentials, so the worker reads them and
 * leaves them where the compose screen can show who the reel goes out as.
 * A failed read keeps the last good details and records the error beside them.
 */
export async function refreshInstagramAccount(pb, config, log, force = false) {
	if (!force && Date.now() - accountAt < ACCOUNT_TTL_MS) return;
	accountAt = Date.now();
	const now = new Date().toISOString();
	try {
		const account = await accountInfo(config);
		await pb.setSetting('instagram_account', {
			fetchedAt: now,
			...account,
			tokenExpiresAt: config.instagram.tokenExpiresAt || '',
			// Whether a custom cover can be served to Instagram at all; the
			// compose screen says so beside the cover box when it cannot.
			coverBase: covers?.base ?? '',
			error: renewError
		});
		if (accountError) log('instagram: recovered');
		accountError = '';
	} catch (err) {
		const message = explain(err).message;
		if (message !== accountError) {
			log(`instagram account failed: ${message.split('\n')[0]}`);
			accountError = message;
		}
		const row = await pb.getSetting('instagram_account').catch(() => null);
		await pb
			.setSetting('instagram_account', { ...(row?.value ?? {}), checkedAt: now, error: message })
			.catch(() => {});
	}
}
