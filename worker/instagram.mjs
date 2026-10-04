// The Instagram adapter: one upload_targets row -> one Reel on the account,
// through the Instagram API with Facebook Login, where the Instagram account
// is reached through the Facebook Page it is linked to.
//
// Facebook Login rather than Instagram Login, because only this flavour takes
// the video as bytes (the resumable upload on rupload.facebook.com): Instagram
// Login takes a reel only as a `video_url` it fetches, which needs a public
// address no self-hosted install should have to provide. The cover is the one
// thing Instagram still fetches by URL with either login, so the image is
// put on the linked Page as an unpublished photo, its address on Meta's own
// image servers handed over as `cover_url`, and the photo deleted afterwards.
//
// Instagram cannot schedule either, but its publishing comes in two halves: a
// container is created and the bytes uploaded and processed first, and a
// separate media_publish call is what puts it on the profile. So the loop
// hands a target over a few minutes ahead of its slot, the container is made
// ready, and the publish call waits for the minute — the one platform here
// that can hit it. Everything read out of `options` is a parameter the
// container call actually takes.

import { fetchOrExplain, isNetworkError } from './net.mjs';
import { streamRequest, videoMime, sleep, msUntil, MiB } from './upload.mjs';

const GRAPH = 'https://graph.facebook.com';
const UPLOAD = 'https://rupload.facebook.com/ig-api-upload';

/**
 * Reading the account and the Page, publishing to the account, and putting
 * an unpublished photo on the Page for the cover. `business_management` is
 * what lets /me/accounts list a Page that sits in a business portfolio.
 */
export const INSTAGRAM_SCOPES = [
	'instagram_basic',
	'instagram_content_publish',
	'pages_show_list',
	'pages_read_engagement',
	'pages_manage_posts',
	'business_management'
];

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

const REAUTH = 'Re-authorise with:  pnpm worker:auth --instagram';

function base(config) {
	return `${GRAPH}/${config.instagram.apiVersion}`;
}

/**
 * The Page token. Derived from a long-lived user token it does not expire,
 * so there is nothing to renew — it dies only when the grant is revoked, the
 * password changes or the person loses the Page, and then the consent flow is
 * the way back.
 */
function token(config) {
	const t = config.instagram.pageAccessToken;
	if (!t) throw new Error(`Instagram is not set up. ${REAUTH}`);
	return t;
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

async function parse(res) {
	const text = await res.text();
	let json = {};
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		// Reported below with the status.
	}
	if (!res.ok || json.error) throw new GraphError(json.error ?? { message: text.slice(0, 300) }, res.status);
	return json;
}

/**
 * One Graph API call. Parameters go in the query for a GET or DELETE and the
 * form body for a POST; objects and arrays are sent as JSON, which is how the
 * API takes a list of collaborators.
 */
async function graph(config, path, { method = 'GET', params = {} } = {}) {
	const url = new URL(`${base(config)}${path}`);
	const form = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === '') continue;
		form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
	}
	form.set('access_token', token(config));

	if (method === 'POST') {
		return parse(
			await fetchOrExplain(url, {
				method,
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: form
			})
		);
	}
	url.search = form.toString();
	return parse(await fetchOrExplain(url, { method }));
}

/** What a Graph error means for the person reading the log. */
export function explain(err) {
	if (!(err instanceof GraphError)) return err;
	const byCode = {
		190: `The Instagram token is dead (revoked, or the password changed). ${REAUTH}`,
		10: `The grant lacks a permission this needs. ${REAUTH}`,
		200: `The grant lacks a permission this needs, or this Facebook account cannot act for the Page. ${REAUTH}`,
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
 * Every Page the user token can act for, with the Instagram account linked to
 * it, if any. Used once, by the consent flow, to find the account and to
 * take the Page's own token.
 */
export async function listPages(apiVersion, userToken) {
	const url = new URL(`${GRAPH}/${apiVersion}/me/accounts`);
	url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}');
	url.searchParams.set('limit', '100');
	url.searchParams.set('access_token', userToken);
	const body = await parse(await fetchOrExplain(url));
	return (body.data ?? []).map((page) => ({
		id: String(page.id),
		name: page.name ?? '',
		accessToken: page.access_token ?? '',
		igUserId: page.instagram_business_account ? String(page.instagram_business_account.id) : '',
		username: page.instagram_business_account?.username ?? ''
	}));
}

/**
 * Who the token posts as, plus how much of the day's publishing allowance
 * is used. The allowance is informational — the account itself answering is
 * the check that matters — so a failure there is swallowed.
 */
export async function accountInfo(config) {
	const ig = config.instagram;
	const me = await graph(config, `/${ig.igUserId}`, { params: { fields: 'id,username,name' } });
	const info = {
		userId: String(me.id ?? ig.igUserId),
		username: me.username ?? '',
		name: me.name ?? '',
		pageId: ig.pageId,
		pageName: ig.pageName,
		quotaUsed: null,
		quotaTotal: null
	};
	try {
		const limit = await graph(config, `/${ig.igUserId}/content_publishing_limit`, {
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
export function buildContainer(target, options, durationSeconds) {
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
 * Puts the cover on the linked Page as an unpublished photo — it never shows
 * on the Page — and returns its address on Meta's image servers, which is
 * public, so Instagram can fetch it as `cover_url`. The caller deletes the
 * photo once Instagram has processed the container.
 */
async function hostCover(config, image, name) {
	const ig = config.instagram;
	const form = new FormData();
	form.set('published', 'false');
	form.set('source', new Blob([image.bytes], { type: image.mimeType }), name || 'cover');
	form.set('access_token', token(config));
	const photo = await parse(
		await fetchOrExplain(`${base(config)}/${ig.pageId}/photos`, { method: 'POST', body: form })
	);
	const id = String(photo.id ?? '');
	if (!id) throw new Error('the Page returned no photo id');
	try {
		const read = await graph(config, `/${id}`, { params: { fields: 'images' } });
		// The largest rendition; Meta lists several sizes.
		const best = [...(read.images ?? [])].sort((a, b) => b.width * b.height - a.width * a.height)[0];
		if (!best?.source) throw new Error('the photo has no image address');
		return { id, url: best.source };
	} catch (err) {
		await graph(config, `/${id}`, { method: 'DELETE' }).catch(() => {});
		throw err;
	}
}

/**
 * Sends the bytes to the container in one declared-length POST, the way the
 * resumable upload endpoint documents it. A byte range resume exists in the
 * protocol; a failure here restarts from zero, as YouTube's does.
 */
async function uploadBytes(config, container, video, log) {
	const url = container.uri || `${UPLOAD}/${config.instagram.apiVersion}/${container.id}`;
	const res = await streamRequest({
		url,
		method: 'POST',
		headers: {
			Authorization: `OAuth ${token(config)}`,
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
			return await graph(config, `/${config.instagram.igUserId}/media_publish`, {
				method: 'POST',
				params: { creation_id: id }
			});
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

/**
 * Where a reel's container has got to — the check a worker taking over makes
 * before uploading a row again (see orphans.mjs). FINISHED is a processed
 * container nobody has published yet, which `publishReady` can finish.
 */
export async function probeInstagram(config, handle) {
	const container = await graph(config, `/${handle.containerId}`, { params: { fields: 'status_code,status' } });
	const code = String(container.status_code || '');
	if (code === 'PUBLISHED') {
		const profile = config.instagram.username
			? `https://www.instagram.com/${config.instagram.username}/`
			: 'https://www.instagram.com/';
		return { state: 'done', result: { url: profile, scheduled: false, privacyStatus: 'a reel' } };
	}
	if (code === 'FINISHED') return { state: 'ready' };
	if (code === 'IN_PROGRESS' || code === '') return { state: 'incomplete' };
	return { state: 'gone', reason: `the container is ${code.toLowerCase()}: ${container.status || 'no detail'}` };
}

/** Publishes a container another worker left processed but unpublished. */
export async function publishReady(config, handle) {
	let published;
	try {
		published = await publishContainer(config, handle.containerId);
	} catch (err) {
		throw explain(err);
	}
	let url = config.instagram.username
		? `https://www.instagram.com/${config.instagram.username}/`
		: 'https://www.instagram.com/';
	try {
		const media = await graph(config, `/${published.id}`, { params: { fields: 'permalink' } });
		if (media.permalink) url = media.permalink;
	} catch {
		// The reel is up; the permalink is a nicety.
	}
	return { url, scheduled: false, privacyStatus: 'a reel' };
}

/** Deletes a cover photo another worker left on the Page. */
export async function dropHostedCover(config, id) {
	await graph(config, `/${id}`, { method: 'DELETE' });
}

export async function publishToInstagram({ target, job, pb, config, log, saveHandle }) {
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

	// A custom cover goes up to the Page as an unpublished photo for Instagram
	// to fetch while it processes the container, and is deleted once that is
	// over. If that fails the frame at the cover time stands in, and the log
	// says so, because the reel still goes out.
	let hosted = null;
	if (job.cover) {
		try {
			hosted = await hostCover(config, await pb.openCover(job), job.cover);
			params.cover_url = hosted.url;
			delete params.thumb_offset;
			log(`cover: ${job.cover} put on the Page as unpublished photo ${hosted.id} for Instagram to fetch`);
		} catch (err) {
			log(
				`cover skipped: could not put it on the Page (${explain(err).message.split('\n')[0]}), ` +
					'so Instagram uses the frame at the cover time'
			);
		}
	}
	const dropCover = async () => {
		if (!hosted) return;
		const id = hosted.id;
		hosted = null;
		try {
			await graph(config, `/${id}`, { method: 'DELETE' });
		} catch (err) {
			log(`cover photo ${id} could not be deleted from the Page — it is unpublished, so nobody sees it (${err.message.split('\n')[0]})`);
		}
	};

	let container;
	try {
		container = await graph(config, `/${config.instagram.igUserId}/media`, { method: 'POST', params });
	} catch (err) {
		await dropCover();
		video.stream.destroy();
		throw explain(err);
	}
	if (!container.id) {
		await dropCover();
		video.stream.destroy();
		throw new Error('Instagram returned no container id.');
	}

	// Recorded before a byte goes up, or nothing does — see orphans.mjs.
	try {
		await saveHandle({
			kind: 'instagram-container',
			containerId: container.id,
			...(hosted ? { coverPhotoId: hosted.id } : {})
		});
	} catch (err) {
		await dropCover();
		video.stream.destroy();
		throw err;
	}

	log(`uploading ${name} (${(video.size / MiB).toFixed(1)} MB) into container ${container.id}`);
	try {
		await uploadBytes(config, container, video, log);
		await waitForContainer(config, container.id, log);
	} catch (err) {
		throw explain(err);
	} finally {
		await dropCover();
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
		await pb.setSetting('instagram_account', { fetchedAt: now, ...account, error: '' });
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
