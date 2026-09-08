// The TikTok adapter: one upload_targets row -> one video on the account,
// through the Content Posting API's Direct Post.
//
// TikTok cannot hold a video for a release time: a post goes live the moment
// its processing finishes. So the worker holds it instead — the loop hands a
// target over only once its slot has come — and what lands on TikTok is the
// slot plus however long TikTok takes to process the file, usually a minute
// or two. Everything read out of `options` is a field the init call actually
// takes; the mapping lives here so the registry stays a description of the
// interface rather than of TikTok's wire format.

import { fetchOrExplain, isNetworkError } from './net.mjs';
import { saveSection } from './config.mjs';
import { planChunks, readChunks, videoMime, sleep, MiB } from './upload.mjs';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API = 'https://open.tiktokapis.com/v2';

/** What the consent asks for: the login itself, and posting. Nothing that reads. */
export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'];

// The registry's labels against TikTok's own levels. Followers exists only on
// a private account; creator_info says which of these the account offers.
const PRIVACY_LEVELS = {
	Public: 'PUBLIC_TO_EVERYONE',
	Everyone: 'PUBLIC_TO_EVERYONE',
	Friends: 'MUTUAL_FOLLOW_FRIENDS',
	Followers: 'FOLLOWER_OF_CREATOR',
	Private: 'SELF_ONLY',
	'Only you': 'SELF_ONLY'
};
const PRIVACY_LABELS = {
	PUBLIC_TO_EVERYONE: 'Public',
	MUTUAL_FOLLOW_FRIENDS: 'Friends',
	FOLLOWER_OF_CREATOR: 'Followers',
	SELF_ONLY: 'Private'
};

// TikTok's stated limits for a file upload. The duration cap is per account
// and comes from creator_info instead.
const MAX_BYTES = 4 * 1024 * MiB;
const ACCEPTED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const CAPTION_LIMIT = 2200;

// Status is polled this often (their limit is thirty a minute) and for this
// long before the row is given up on. Processing normally takes a minute.
// A poll that cannot reach TikTok is a missed poll, not a failed post; this
// many in a row, with the wait growing to three intervals, is when it stops.
const STATUS_EVERY_MS = 10_000;
const STATUS_TIMEOUT_MS = 30 * 60_000;
const MAX_STATUS_MISSES = 12;

// How often the creator's details are re-read for the compose screen.
const CREATOR_TTL_MS = 30 * 60_000;

/** Cached until a minute before it expires — TikTok's last a day. */
let cached = { token: '', expiresAt: 0 };

/**
 * Turns the stored refresh token into an access token.
 *
 * TikTok may hand back a *new* refresh token with every refresh. It is written
 * straight back into the config file when that happens: the old one may stop
 * working, and losing it means going through the consent flow again.
 */
export async function accessToken(config) {
	if (cached.token && Date.now() < cached.expiresAt) return cached.token;
	const t = config.tiktok;
	if (!t.refreshToken) throw new Error('No TikTok refresh token. Run:  pnpm worker:auth --tiktok');

	const res = await fetchOrExplain(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_key: t.clientKey,
			client_secret: t.clientSecret,
			grant_type: 'refresh_token',
			refresh_token: t.refreshToken
		})
	});
	const text = await res.text();
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		// Reported below as the raw text.
	}

	if (!res.ok || !body.access_token) {
		const code = body.error || `HTTP ${res.status}`;
		const why = body.error_description || text.slice(0, 300);
		if (code === 'invalid_grant' || /expired|revoked|invalid/i.test(why)) {
			throw new Error(
				`TikTok rejected the refresh token (${code}: ${why}).\n` +
					'It has expired, been revoked, or was rotated and the new one lost.\n' +
					'Re-authorise with:  pnpm worker:auth --tiktok'
			);
		}
		throw new Error(`TikTok token refresh failed (${code}): ${why}`);
	}

	cached = {
		token: body.access_token,
		expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 86400) - 60) * 1000
	};
	if (body.refresh_token && body.refresh_token !== t.refreshToken) {
		t.refreshToken = body.refresh_token;
		saveSection('tiktok', {
			refreshToken: body.refresh_token,
			...(body.open_id ? { openId: body.open_id } : {})
		});
	}
	return cached.token;
}

/** Drops the cache, so the next call re-refreshes. Used after a rejected token. */
export function forgetToken() {
	cached = { token: '', expiresAt: 0 };
}

class TikTokError extends Error {
	constructor(code, message, logId, status) {
		super(`TikTok ${code}: ${message}${logId ? ` (log ${logId})` : ''}`);
		this.code = code;
		this.status = status;
	}
}

/**
 * One call to the posting API. Every endpoint is a POST, and most failures
 * come back as HTTP 200 with an error code in the body, so the body's code is
 * what decides. A rejected access token is retried once with a fresh one.
 */
async function api(config, path, body, retry = true) {
	const token = await accessToken(config);
	const res = await fetchOrExplain(`${API}${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json; charset=UTF-8'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await res.text();
	let json = {};
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		// Fall through: a non-JSON body is reported with its status.
	}
	const code = json.error?.code ?? (res.ok ? 'ok' : `http_${res.status}`);
	if (code === 'access_token_invalid' && retry) {
		forgetToken();
		return api(config, path, body, false);
	}
	if (code !== 'ok') {
		throw new TikTokError(code, json.error?.message || text.slice(0, 300), json.error?.log_id, res.status);
	}
	return json.data ?? {};
}

/**
 * Who the token posts as, and what they are allowed.
 *
 * TikTok requires this before every post, and it is the only place their
 * rules for the account are stated: the privacy levels it offers, whether
 * comments, duets and stitches are switched off in its settings (in which
 * case a post may not switch them on), and the longest video it may post.
 */
export async function creatorInfo(config) {
	const data = await api(config, '/post/publish/creator_info/query/');
	return {
		username: data.creator_username ?? '',
		nickname: data.creator_nickname ?? '',
		avatar: data.creator_avatar_url ?? '',
		privacyOptions: Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [],
		commentDisabled: Boolean(data.comment_disabled),
		duetDisabled: Boolean(data.duet_disabled),
		stitchDisabled: Boolean(data.stitch_disabled),
		maxDurationSeconds: Number(data.max_video_post_duration_sec ?? 0)
	};
}

/** A privacy level in the registry's words. */
export function privacyLabel(level) {
	return PRIVACY_LABELS[level] ?? level;
}

/**
 * The level to post at, checked against what the account actually offers.
 *
 * Failing here is deliberate: TikTok rejects a level the account does not
 * offer anyway, and downgrading quietly — public asked for, private posted —
 * would hide a video the user meant to be seen. A private account, and an app
 * TikTok has not audited yet, both cannot post publicly at all.
 */
function resolvePrivacy(wanted, creator) {
	const label = String(wanted || 'Public');
	const level = PRIVACY_LEVELS[label] ?? 'PUBLIC_TO_EVERYONE';
	if (creator.privacyOptions.length > 0 && !creator.privacyOptions.includes(level)) {
		const offered = creator.privacyOptions.map(privacyLabel).join(', ');
		throw new Error(
			`TikTok does not offer "${label}" on @${creator.username} — it offers ${offered}. ` +
				(level === 'PUBLIC_TO_EVERYONE'
					? 'A private account cannot post publicly, and neither can an app TikTok has not audited yet. '
					: '') +
				'Pick another audience for TikTok and upload again.'
		);
	}
	return level;
}

/** The request body for the init call, from the target's options. */
function buildPostInfo(target, options, creator, level, durationSeconds) {
	const disclose = Boolean(options.discloseContent);
	// The compose screen writes the two kinds as booleans; a row from before it
	// did carries the old `disclosure` select instead.
	const legacy = String(options.disclosure || '');
	const brandOrganic =
		disclose && (options.brandOrganic === true || legacy === 'Your brand' || legacy === 'Both');
	const brandContent =
		disclose && (options.brandContent === true || legacy === 'Branded content' || legacy === 'Both');
	if (brandContent && level === 'SELF_ONLY') {
		throw new Error(
			'TikTok does not allow branded content on a post only you can see. ' +
				'Either widen the audience or disclose it as "Your brand".'
		);
	}

	// Seconds in the registry, milliseconds on the wire, and never past the
	// end of the video.
	let coverMs = Math.round(Math.max(0, Number(options.coverFrame) || 0) * 1000);
	if (durationSeconds > 0) coverMs = Math.min(coverMs, Math.max(0, durationSeconds * 1000 - 500));

	const info = {
		title: (target.description || target.title || '').slice(0, CAPTION_LIMIT),
		privacy_level: level,
		// Off unless ticked — TikTok's own default, and where the compose
		// screen's boxes start — and the account's own settings win either way:
		// TikTok refuses a post that switches on what the creator switched off.
		disable_comment: options.allowComments !== true || creator.commentDisabled,
		disable_duet: options.allowDuet !== true || creator.duetDisabled,
		disable_stitch: options.allowStitch !== true || creator.stitchDisabled,
		video_cover_timestamp_ms: coverMs,
		brand_content_toggle: brandContent,
		brand_organic_toggle: brandOrganic
	};
	// Only when ticked, so an untouched upload's request stays what it was.
	if (options.aiGenerated) info.is_aigc = true;
	return info;
}

/** What TikTok's init error codes mean for the person reading the log. */
function explainInit(err) {
	const hints = {
		unaudited_client_can_only_post_to_private_accounts:
			'TikTok has not audited the app yet. Until it has, it may only post to a TikTok ' +
			'account set to private (TikTok app: Settings, Privacy, Private account).',
		reached_active_user_cap:
			'An unaudited TikTok app may serve only a handful of accounts, and this one is over that cap.',
		privacy_level_option_mismatch: 'That audience is not offered on this account.',
		spam_risk_too_many_posts: 'TikTok says this account has posted too much today. Try again tomorrow.',
		spam_risk_user_banned_from_posting: 'TikTok has banned this account from posting.',
		scope_not_authorized:
			'The TikTok grant lacks video.publish. Re-authorise with:  pnpm worker:auth --tiktok',
		rate_limit_exceeded: 'TikTok rate limit hit; upload again in a few minutes.',
		url_ownership_unverified: 'TikTok refused the upload source.'
	};
	const hint = hints[err.code];
	return hint ? `${hint} (${err.message})` : err.message;
}

/** What a FAILED status's fail_reason means. */
function explainFailure(reason) {
	const hints = {
		file_format_check_failed:
			'TikTok rejected the file format. It takes MP4, MOV or WebM with H.264 video and AAC audio.',
		duration_check_failed: 'The video is too long or too short for this account.',
		frame_rate_check_failed: 'TikTok wants a frame rate between 23 and 60 fps.',
		picture_size_check_failed: 'The resolution is too small for TikTok (at least 360p).',
		spam_risk_text: 'TikTok flagged the caption as spam.',
		spam_risk_too_many_posts: 'TikTok says this account has posted too much today.',
		spam_risk_user_banned_from_posting: 'TikTok has banned this account from posting.',
		auth_removed:
			"The account revoked flock's access on TikTok. Re-authorise with:  pnpm worker:auth --tiktok",
		publish_cancelled: "The post was cancelled on TikTok's side.",
		internal: 'TikTok reported an internal error. Upload again.'
	};
	return hints[reason]
		? `${hints[reason]} (${reason})`
		: `TikTok failed the post: ${reason || 'no reason given'}`;
}

/**
 * PUTs one range of the file. Retried a few times on a network fault or a
 * server-side status; a 4xx other than a timeout is final, since re-sending
 * the same bytes to the same range will not change the answer.
 */
async function putChunk(uploadUrl, chunk, range, total, mime) {
	let last;
	for (let attempt = 1; attempt <= 3; attempt++) {
		let res;
		try {
			res = await fetchOrExplain(uploadUrl, {
				method: 'PUT',
				headers: {
					'Content-Type': mime,
					'Content-Range': `bytes ${range.start}-${range.end}/${total}`
				},
				body: chunk
			});
		} catch (err) {
			last = err;
			await sleep(2000 * attempt);
			continue;
		}
		const text = await res.text();
		if (res.ok) return;
		last = new Error(
			`TikTok refused bytes ${range.start}-${range.end} (${res.status}): ${text.slice(0, 300)}`
		);
		if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
		await sleep(2000 * attempt);
	}
	throw last;
}

/**
 * Polls the publish until TikTok says it is live, or says why it is not.
 *
 * Once the bytes are up, the post is TikTok's to finish whether or not this
 * side can see it. So a poll that cannot reach TikTok, or gets a server
 * error or a rate limit, is a missed poll rather than a failed post — only
 * a definite answer, too many misses in a row, or the overall cap ends the
 * wait, and the last two say so, because the post may still appear.
 */
async function waitForPublish(config, publishId, username, log) {
	const started = Date.now();
	let lastStatus = '';
	let misses = 0;
	const unsure = (what) =>
		new Error(
			`${what} The upload itself completed (publish ${publishId}), so the post may still ` +
				`appear on @${username} — check there before uploading again.`
		);

	while (Date.now() - started < STATUS_TIMEOUT_MS) {
		let data;
		try {
			data = await api(config, '/post/publish/status/fetch/', { publish_id: publishId });
			misses = 0;
		} catch (err) {
			const transient =
				isNetworkError(err) ||
				(err instanceof TikTokError && (err.status >= 500 || err.code === 'rate_limit_exceeded'));
			if (!transient) throw err;
			misses += 1;
			if (misses > MAX_STATUS_MISSES) {
				throw unsure(`Lost TikTok while it was processing: ${err.message.split('\n')[0]}.`);
			}
			log(`status poll failed (${err.message.split('\n')[0]}) — retrying`);
			await sleep(STATUS_EVERY_MS * Math.min(misses, 3));
			continue;
		}

		const status = String(data.status || '');
		if (status !== lastStatus) {
			log(`TikTok: ${status.toLowerCase().replace(/_/g, ' ') || 'no status yet'}`);
			lastStatus = status;
		}
		if (status === 'PUBLISH_COMPLETE') {
			// Sic: the field is misspelt in the API itself.
			const ids = data.publicaly_available_post_id ?? data.publicly_available_post_id ?? [];
			return { postIds: Array.isArray(ids) ? ids.map(String) : [] };
		}
		if (status === 'FAILED') throw new Error(explainFailure(data.fail_reason));
		await sleep(STATUS_EVERY_MS);
	}
	throw unsure(`TikTok was still processing after ${STATUS_TIMEOUT_MS / 60000} minutes.`);
}

export async function publishToTikTok({ target, job, pb, config, log }) {
	const options = target.options ?? {};

	// Their rules require this before every post: it is where the account's
	// privacy levels and interaction settings come from.
	const creator = await creatorInfo(config);
	const level = resolvePrivacy(options.privacy, creator);
	const duration = Number(job.video_duration) || 0;
	const postInfo = buildPostInfo(target, options, creator, level, duration);

	if (creator.maxDurationSeconds > 0 && duration > creator.maxDurationSeconds) {
		throw new Error(
			`The video runs ${Math.round(duration)}s but @${creator.username} may post ` +
				`at most ${creator.maxDurationSeconds}s through the API.`
		);
	}

	const video = await pb.openVideo(job);
	const mime = videoMime(video, job.video_name);
	if (!ACCEPTED_MIME.has(mime)) {
		video.stream.destroy();
		throw new Error(`TikTok takes MP4, MOV or WebM; ${job.video_name || job.video} is ${mime}.`);
	}
	if (video.size > MAX_BYTES) {
		video.stream.destroy();
		throw new Error(
			`TikTok caps an upload at 4 GB; this one is ${(video.size / 1024 / MiB).toFixed(2)} GB.`
		);
	}

	const plan = planChunks(video.size);
	log(
		`posting ${job.video_name || job.video} (${(video.size / MiB).toFixed(1)} MB, ` +
			`${plan.count} chunk${plan.count === 1 ? '' : 's'}) as @${creator.username}, ` +
			privacyLabel(level).toLowerCase()
	);

	let init;
	try {
		init = await api(config, '/post/publish/video/init/', {
			post_info: postInfo,
			source_info: {
				source: 'FILE_UPLOAD',
				video_size: video.size,
				chunk_size: plan.chunkSize,
				total_chunk_count: plan.count
			}
		});
	} catch (err) {
		video.stream.destroy();
		throw err instanceof TikTokError ? new Error(explainInit(err)) : err;
	}
	if (!init.publish_id || !init.upload_url) {
		video.stream.destroy();
		throw new Error('TikTok accepted the post but returned no upload URL.');
	}
	// Logged before a byte goes up: it is the only handle on the post if the
	// worker loses sight of it afterwards.
	log(`TikTok accepted the post as publish ${init.publish_id}`);

	// The upload URL is short-lived (TikTok says about an hour), which a very
	// large file over a slow uplink can outrun; the chunk error then names it.
	let index = 0;
	let reported = 0;
	for await (const chunk of readChunks(video.stream, plan.ranges)) {
		const range = plan.ranges[index++];
		await putChunk(init.upload_url, chunk, range, video.size, mime);
		const pct = Math.floor(((range.end + 1) / video.size) * 100);
		if (pct >= reported + 10 || index === plan.count) {
			reported = pct;
			log(`  ${pct}%`);
		}
	}

	const outcome = await waitForPublish(config, init.publish_id, creator.username, log);
	const postId = outcome.postIds[0] ?? '';
	const url = postId
		? `https://www.tiktok.com/@${creator.username}/video/${postId}`
		: `https://www.tiktok.com/@${creator.username}`;

	return {
		url,
		publishId: init.publish_id,
		postId,
		scheduled: false,
		privacyStatus: privacyLabel(level).toLowerCase()
	};
}

let creatorAt = 0;
let creatorError = '';

/**
 * Publishes the creator's details to `app_settings` / `tiktok_creator`, the
 * same arrangement as the YouTube playlists: the browser holds no TikTok
 * credentials, so the worker reads them and leaves them where the compose
 * screen can show who the post goes out as and which audiences exist. A
 * failed read keeps the last good details and records the error beside them.
 */
export async function refreshTikTokCreator(pb, config, log, force = false) {
	if (!force && Date.now() - creatorAt < CREATOR_TTL_MS) return;
	creatorAt = Date.now();
	const now = new Date().toISOString();
	try {
		const creator = await creatorInfo(config);
		await pb.setSetting('tiktok_creator', { fetchedAt: now, ...creator, error: '' });
		if (creatorError) log('tiktok: recovered');
		creatorError = '';
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message !== creatorError) {
			log(`tiktok creator info failed: ${message.split('\n')[0]}`);
			creatorError = message;
		}
		const row = await pb.getSetting('tiktok_creator').catch(() => null);
		await pb
			.setSetting('tiktok_creator', { ...(row?.value ?? {}), checkedAt: now, error: message })
			.catch(() => {});
	}
}
