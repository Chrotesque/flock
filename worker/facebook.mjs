// The Facebook adapter: one upload_targets row -> one Reel on a Facebook Page,
// through the Reels Publishing API (v0.16.0).
//
// The same Meta app and the same kind of Page token as Instagram (the Pages
// reached through it, until `pnpm worker:auth --facebook` lists its own), and
// the same resumable upload: a session is started on the Page, the bytes go to
// rupload.facebook.com in one declared-length POST, and a finish call puts it
// out. Unlike Instagram, Facebook schedules by itself — `video_state=SCHEDULED`
// with a time 10 minutes to 29 days ahead — so the reel is uploaded early, as
// YouTube is, and the row goes `scheduled`; a slot closer than that goes out
// at once. A reel on a Page is always public: there is no audience to choose.
//
// Proven on 12 and 13 Oct 2026 with a scratch script before this was written:
// 13 s reels on a Page in ~27 s, hidden from everyone without a role on the
// Meta app while it was in Development mode, public once it was Live.
//
// A reel Facebook holds can be given another time (POST /{video_id} with
// `scheduled_publish_time`) and deleted (DELETE /{video_id}): both proven on
// 14 Oct 2026 with a test reel scheduled 20 days ahead on a Page — the time
// read back changed, and after the delete the reel no longer existed.
//
// The cover (v0.16.2) goes to POST /{video_id}/thumbnails as the preferred
// thumbnail, between the upload and the finish call. Proven on 14 Oct 2026
// with a test reel on a Page, on the grant the Instagram setup gives (no
// pages_manage_engagement, which Meta's reference lists): the Page's Reels
// tab showed the cover, and the reel itself still opens on its first frame.

import { msUntil, sleep, streamRequest, videoMime, MiB } from './upload.mjs';
import { facebookReady, pickAccount } from './accounts.mjs';
import { GraphError, graph, transientGraphError } from './instagram.mjs';
import { facebookVideoId } from './moves.mjs';
import { captionWithTitle } from './retitle.mjs';
import { COVER_MISSING, triedFor, withCoverRetries } from './coverretry.mjs';

/**
 * Listing the Pages, reading them and taking their tokens, and publishing to
 * them. `business_management` is what lists a Page held in a business
 * portfolio. The Instagram setup asks for all of these too, which is why its
 * Pages can post reels without a setup of their own.
 */
export const FACEBOOK_PERMISSIONS = [
	{ name: 'pages_show_list', use: 'finding the Pages you manage', required: true },
	{ name: 'pages_read_engagement', use: 'reading a Page and taking its token', required: true },
	{ name: 'pages_manage_posts', use: 'publishing reels to the Page', required: true },
	{
		name: 'business_management',
		use: 'finding a Page that sits in a business portfolio',
		required: false,
		without: 'a Page held in a business portfolio may not be found'
	},
	{
		name: 'read_insights',
		use: 'reading how many views each reel on the Page has',
		required: false,
		without: 'no reel views; their likes and comments are still read'
	}
];

export const FACEBOOK_SCOPES = FACEBOOK_PERMISSIONS.map((p) => p.name);

/** Which of these a token lacks, from /me/permissions rows; like instagram.mjs checkGrant. */
export function checkFacebookGrant(rows) {
	const granted = new Set((rows ?? []).filter((row) => row.status === 'granted').map((row) => row.permission));
	const absent = FACEBOOK_PERMISSIONS.filter((p) => !granted.has(p.name));
	return { missing: absent.filter((p) => p.required), optional: absent.filter((p) => !p.required) };
}

// Facebook's stated limits for a reel (Reels Publishing API, video specs).
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 90;
const ACCEPTED_MIME = new Set(['video/mp4', 'video/quicktime']);

/** Facebook takes a scheduled time 10 minutes to 29 days ahead; a minute's margin on the near side. */
export const SCHEDULE_MIN_MS = 11 * 60_000;
export const SCHEDULE_MAX_MS = 29 * 24 * 3_600_000;
/** How far ahead the worker takes a row up: a day short of Facebook's 29, so the time is always in range. */
export const LEAD_SECONDS = 28 * 24 * 3600;

const STATUS_EVERY_MS = 10_000;
const STATUS_TIMEOUT_MS = 30 * 60_000;
const MAX_STATUS_MISSES = 12;
const ACCOUNT_TTL_MS = 30 * 60_000;

const SETUP = 'pnpm worker:auth --facebook';
const REAUTH = `Re-authorise with:  ${SETUP}`;

/**
 * The Page a post goes out on: the one it names, or the only one, never a
 * guess (accounts.mjs pickAccount). Carries what graph() needs to call as it
 * and to name Facebook in its errors.
 */
export function facebookAccount(config, wanted = '') {
	const ready = config.facebook.accounts.filter(facebookReady);
	const page = pickAccount(ready, wanted, (p) => p.pageId, 'Facebook', SETUP);
	return { ...page, apiVersion: config.facebook.apiVersion, label: 'Facebook', reauth: REAUTH };
}

/** What a Graph error means for the person reading the log. */
export function explainFacebook(err) {
	if (!(err instanceof GraphError)) return err;
	const byCode = {
		190: `The Facebook Page token is dead (revoked, or the password changed). ${REAUTH}`,
		10: `The grant lacks a permission publishing a reel needs (pages_manage_posts). ${REAUTH}`,
		200: `The grant lacks a permission this needs, or this Facebook account cannot post for the Page. ${REAUTH}`,
		368: 'Facebook has blocked this Page from posting for now.',
		4: 'Facebook rate limit hit; upload again later.',
		17: 'Facebook rate limit hit; upload again later.',
		32: 'Facebook rate limit hit; upload again later.',
		613: 'Facebook rate limit hit (it allows 30 reels a Page in 24 hours through the API); upload again later.'
	};
	const hint = byCode[err.code];
	return hint ? new Error(`${hint} (${err.message})`) : err;
}

/**
 * When the reel goes out, from its slot: `SCHEDULED` at the slot while that is
 * far enough ahead for Facebook to hold it, `PUBLISHED` at once when it is
 * near or past (`lateMs` past it), and `TOO_EARLY` beyond the 29 days Facebook
 * can hold a reel — which the worker never takes up (LEAD_SECONDS), and which
 * must never fall through to going out at once.
 */
export function releasePlan(slot, now = Date.now()) {
	const at = Date.parse(String(slot ?? '').replace(' ', 'T'));
	if (!Number.isFinite(at)) return { state: 'PUBLISHED', lateMs: 0 };
	const ahead = at - now;
	if (ahead > SCHEDULE_MAX_MS) return { state: 'TOO_EARLY' };
	if (ahead >= SCHEDULE_MIN_MS) return { state: 'SCHEDULED', publishTime: Math.floor(at / 1000) };
	return { state: 'PUBLISHED', lateMs: Math.max(0, -ahead) };
}

/**
 * Where a reel has got to, from the video's `status` (Reels Publishing API,
 * "Check status"), as orphans.mjs reads a probe — and as the publish waits for
 * it: `done` (published or held by Facebook), `gone` (failed or expired),
 * `uploading` (with the bytes so far), `ready` (the bytes are in but the
 * finish call was never made), or `processing`.
 */
export function reelState(status, { finished = true } = {}) {
	const s = status ?? {};
	const publish = s.publishing_phase?.publish_status;
	if (publish === 'published') return { state: 'done', scheduled: false };
	if (publish === 'scheduled') return { state: 'done', scheduled: true };
	const failed = ['error', 'upload_failed', 'expired'].includes(s.video_status);
	const phaseError = [s.uploading_phase, s.processing_phase, s.publishing_phase].find((phase) => phase?.status === 'error');
	if (failed || phaseError) {
		const why = phaseError?.errors?.[0]?.message || phaseError?.error?.message || s.video_status;
		return { state: 'gone', reason: `Facebook reports the reel ${why}` };
	}
	if (s.uploading_phase?.status && s.uploading_phase.status !== 'complete') {
		return { state: 'uploading', bytes: Number(s.uploading_phase.bytes_transferred ?? 0) };
	}
	if (!finished) return { state: 'ready' };
	return { state: 'processing' };
}

/** A reel's address: Facebook's permalink (often a bare path), else the reel's own. */
export function reelUrl(permalink, videoId) {
	if (permalink) return permalink.startsWith('http') ? permalink : `https://www.facebook.com${permalink}`;
	return `https://www.facebook.com/reel/${videoId}/`;
}

async function readStatus(page, videoId) {
	return (await graph(page, `/${videoId}`, { params: { fields: 'status' } })).status ?? {};
}

/**
 * Waits for Facebook to have the reel out (or held for its time). A poll that
 * cannot reach Facebook is a missed poll, not a failed reel — the finish call
 * has been made, so the reel is Facebook's to put out.
 */
async function waitForReel(page, videoId, log) {
	const started = Date.now();
	let last = '';
	let misses = 0;
	while (Date.now() - started < STATUS_TIMEOUT_MS) {
		let status;
		try {
			status = await readStatus(page, videoId);
			misses = 0;
		} catch (err) {
			if (!transientGraphError(err)) throw err;
			misses += 1;
			if (misses > MAX_STATUS_MISSES) throw new Error(`Lost Facebook while it was processing reel ${videoId}: ${err.message.split('\n')[0]}`);
			log(`status poll failed (${err.message.split('\n')[0]}) — retrying`);
			await sleep(STATUS_EVERY_MS * Math.min(misses, 3));
			continue;
		}
		const now = reelState(status);
		const word = status.video_status || 'no status yet';
		if (word !== last) {
			log(`Facebook: ${String(word).replace(/_/g, ' ')}`);
			last = word;
		}
		if (now.state === 'done') return now;
		if (now.state === 'gone') throw new Error(now.reason);
		await sleep(STATUS_EVERY_MS);
	}
	throw new Error(`Facebook was still processing reel ${videoId} after ${STATUS_TIMEOUT_MS / 60000} minutes.`);
}

/** The finish call, with the caption and the release the slot gives. */
async function finishReel(page, videoId, description, plan) {
	await graph(page, `/${page.pageId}/video_reels`, {
		method: 'POST',
		params: {
			upload_phase: 'finish',
			video_id: videoId,
			video_state: plan.state,
			description,
			...(plan.state === 'SCHEDULED' ? { scheduled_publish_time: String(plan.publishTime) } : {})
		}
	});
}

/**
 * Makes the image the reel's preferred thumbnail — its cover. Set before the
 * finish call, so a reel Facebook holds for its slot is held with it.
 */
async function setReelCover(page, videoId, image, name) {
	await graph(page, `/${videoId}/thumbnails`, {
		method: 'POST',
		params: { is_preferred: 'true' },
		files: { source: { ...image, name } }
	});
}

/**
 * Why a cover was not set, in a line: a refused permission names the one Meta
 * lists, and `tried` (withCoverRetries' answer) how long it was tried.
 */
export function coverNote(err, tried = { attempts: 1 }) {
	const why =
		err instanceof GraphError && (err.code === 10 || err.code === 200)
			? 'the grant lacks a permission it needs (Meta’s reference names pages_manage_engagement, which flock does not ask for)'
			: String(err?.message ?? err).split('\n')[0];
	return `${COVER_MISSING} ${why}${triedFor(tried)}. Facebook shows a frame it picks.`;
}

async function permalinkOf(page, videoId) {
	try {
		return reelUrl((await graph(page, `/${videoId}`, { params: { fields: 'permalink_url' } })).permalink_url, videoId);
	} catch {
		// The reel is up; the link is a nicety.
		return reelUrl('', videoId);
	}
}

/**
 * Deletes a reel from the Page a post went out on, for a post moved to
 * another brand (moves.mjs). Meta documents deleting videos, not reels held
 * for their time in particular (it worked on one in the test above), so the
 * reel is read back afterwards and only a Page that no longer has it counts:
 * otherwise the old Page would put it out at its slot while flock believed
 * it gone.
 */
export async function deleteFacebookReel(config, pageId, videoId) {
	const page = facebookAccount(config, pageId);
	const name = page.pageName || page.pageId;
	let alreadyGone = false;
	try {
		await graph(page, `/${videoId}`, { method: 'DELETE' });
	} catch (err) {
		// "Does not exist" — or a delete Facebook does not support; the read
		// below tells which.
		if (!(err instanceof GraphError && err.code === 100)) throw explainFacebook(err);
		alreadyGone = true;
	}
	for (let look = 0; look < 3; look++) {
		try {
			await readStatus(page, videoId);
		} catch (err) {
			if (err instanceof GraphError && err.code === 100) return { page: name, alreadyGone };
			throw explainFacebook(err);
		}
		await sleep(2000);
	}
	throw new Error(`Facebook still has reel ${videoId} on ${name} after it was deleted. Delete it in Meta Business Suite.`);
}

/** Facebook's "2026-11-04T19:57:44+0000" as ISO. */
function isoOf(time) {
	const at = Date.parse(String(time ?? '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
	return Number.isFinite(at) ? new Date(at).toISOString() : '';
}

/** Whether Facebook holds a reel for its time, and for when. */
async function heldRelease(page, videoId) {
	const video = await graph(page, `/${videoId}`, { params: { fields: 'status,scheduled_publish_time' } });
	return {
		held: video.status?.publishing_phase?.publish_status === 'scheduled',
		at: isoOf(video.scheduled_publish_time)
	};
}

/** The Page and reel a scheduled Facebook post names. */
function postReel(config, row) {
	const videoId = facebookVideoId(row);
	if (!videoId) throw new Error('it names no Facebook video');
	return { page: facebookAccount(config, row.account || row.handle?.account || ''), videoId };
}

/**
 * Gives a reel Facebook holds for its time another one, for a post moved in
 * the Calendar (reschedule.mjs), and reads it back: only a reel that now
 * shows the new time counts as moved.
 */
export async function rescheduleFacebookReel(config, row, at) {
	const { page, videoId } = postReel(config, row);
	const plan = releasePlan(at);
	if (plan.state === 'TOO_EARLY') throw new Error('Facebook holds a reel at most 29 days ahead');
	if (plan.state !== 'SCHEDULED') throw new Error('the new time is less than 11 minutes away');
	try {
		if (!(await heldRelease(page, videoId)).held) throw new Error('Facebook has put it out already');
		await graph(page, `/${videoId}`, { method: 'POST', params: { scheduled_publish_time: String(plan.publishTime) } });
		const after = await heldRelease(page, videoId);
		if (!after.held || Math.floor(Date.parse(after.at) / 1000) !== plan.publishTime) {
			throw new Error(`Facebook still shows ${after.at || 'no time'} after the change`);
		}
		return { release: after.at };
	} catch (err) {
		throw explainFacebook(err);
	}
}

/** A reel's caption as Facebook has it now. */
async function readCaption(page, videoId) {
	const video = await graph(page, `/${videoId}`, { params: { fields: 'description' } });
	return String(video.description ?? '');
}

/**
 * Gives a reel on the Page another name, for a rename on the Dashboard
 * (retitle.mjs): the caption's title line is replaced, the rest kept, and
 * the caption read back until it shows the change. Meta documents updating
 * a video's `description`; on a reel it is the same call that moves one
 * (rescheduleFacebookReel), not yet run live for this.
 */
export async function retitleFacebookReel(config, pageId, videoId, title) {
	const page = facebookAccount(config, pageId);
	try {
		const before = await readCaption(page, videoId);
		const caption = captionWithTitle(before, title);
		if (caption.trim() === before.trim()) return { before, caption, unchanged: true };
		await graph(page, `/${videoId}`, { method: 'POST', params: { description: caption } });
		for (let look = 0; look < 3; look++) {
			if ((await readCaption(page, videoId)).trim() === caption.trim()) return { before, caption, unchanged: false };
			await sleep(2000);
		}
		throw new Error('Facebook still shows the old caption after the change');
	} catch (err) {
		throw explainFacebook(err);
	}
}

/**
 * The time Facebook holds a post's reel for, or that it is out (or gone) —
 * for an upload from before flock kept that (reschedule.mjs `learn`).
 */
export async function facebookRelease(config, row) {
	const { page, videoId } = postReel(config, row);
	try {
		const now = await heldRelease(page, videoId);
		return now.held && now.at ? { at: now.at } : { out: true };
	} catch (err) {
		if (err instanceof GraphError && err.code === 100) return { out: true };
		throw explainFacebook(err);
	}
}

export async function publishToFacebook({ target, job, pb, config, log, saveHandle }) {
	// The Page this post is for, or an error — never another Page.
	const page = facebookAccount(config, target.account ?? '');
	if (releasePlan(target.scheduled_at).state === 'TOO_EARLY') {
		throw new Error('Facebook holds a reel at most 29 days ahead; this one was taken up too early. It goes out once it is within reach.');
	}
	const name = job.video_name || job.video;
	const duration = Number(job.video_duration) || 0;
	if (duration > 0 && (duration < MIN_SECONDS || duration > MAX_SECONDS)) {
		throw new Error(`Facebook takes reels of ${MIN_SECONDS} to ${MAX_SECONDS} seconds; this one runs ${Math.round(duration)}s.`);
	}

	const video = await pb.openVideo(job);
	const mime = videoMime(video, name);
	if (!ACCEPTED_MIME.has(mime)) {
		video.stream.destroy();
		throw new Error(`Facebook takes reels as MP4 (or MOV); ${name} is ${mime}.`);
	}

	let session;
	try {
		session = await graph(page, `/${page.pageId}/video_reels`, { method: 'POST', params: { upload_phase: 'start' } });
	} catch (err) {
		video.stream.destroy();
		throw explainFacebook(err);
	}
	const videoId = String(session.video_id ?? '');
	if (!videoId || !session.upload_url) {
		video.stream.destroy();
		throw new Error('Facebook started no upload session (no video id or upload address).');
	}

	// Recorded before a byte goes up, or nothing does — see orphans.mjs.
	const handle = { kind: 'facebook-reel', videoId, account: page.pageId, finished: false };
	try {
		await saveHandle(handle);
	} catch (err) {
		video.stream.destroy();
		throw err;
	}

	log(`uploading ${name} (${(video.size / MiB).toFixed(1)} MB) as reel ${videoId} for the Page ${page.pageName || page.pageId}`);
	const res = await streamRequest({
		url: session.upload_url,
		method: 'POST',
		headers: {
			Authorization: `OAuth ${page.pageAccessToken}`,
			offset: '0',
			file_size: String(video.size),
			'Content-Type': 'application/octet-stream'
		},
		body: video.stream,
		size: video.size,
		onProgress: (pct) => log(`  ${pct}%`)
	});
	let answer = {};
	try {
		answer = JSON.parse(res.text);
	} catch {
		// Reported below with the status.
	}
	if (res.status < 200 || res.status >= 300 || answer.success === false || answer.error) {
		throw new Error(`Facebook refused the upload (${res.status}): ${answer.error?.message || res.text.slice(0, 300)}`);
	}

	// A failed connection or a passing Graph error is tried again for up to
	// five minutes (coverretry.mjs); after that, or refused, the reel goes out
	// with Facebook's frame and a warning.
	const notes = [];
	if (job.facebook_cover) {
		const got = await withCoverRetries(
			async () => setReelCover(page, videoId, await pb.openFacebookCover(job), job.facebook_cover),
			{ retryable: transientGraphError, log }
		);
		if (!('error' in got)) {
			log(`cover: ${job.facebook_cover} set as the reel's cover`);
		} else {
			notes.push(coverNote(got.error, got));
			log(notes[0]);
		}
	}

	// Read again after the upload, which can take minutes: a slot can have come within the 10 minutes.
	const plan = releasePlan(target.scheduled_at);
	if (plan.state === 'PUBLISHED' && plan.lateMs > 60_000) log(`${Math.round(plan.lateMs / 60000)} min past the slot — publishing now`);
	try {
		await finishReel(page, videoId, target.description ?? '', plan);
	} catch (err) {
		throw explainFacebook(err);
	}
	// From here Facebook puts it out by itself; a worker taking over must not call finish again.
	await saveHandle({ ...handle, finished: true }).catch(() => {});

	let done;
	try {
		done = await waitForReel(page, videoId, log);
	} catch (err) {
		throw explainFacebook(err);
	}
	return {
		url: await permalinkOf(page, videoId),
		videoId,
		scheduled: done.scheduled,
		privacyStatus: 'a public reel on the Page',
		notes
	};
}

/**
 * Where a reel left `publishing` by another run has got to (orphans.mjs). A
 * video Facebook no longer has is gone; the bytes all in without the finish
 * call is `ready`, which `publishReadyReel` completes.
 */
export async function probeFacebook(config, handle) {
	const page = facebookAccount(config, handle.account ?? '');
	let status;
	try {
		status = await readStatus(page, handle.videoId);
	} catch (err) {
		if (err instanceof GraphError && err.code === 100) return { state: 'gone', reason: 'Facebook no longer has the video' };
		throw err;
	}
	const now = reelState(status, { finished: handle.finished !== false });
	if (now.state === 'done') {
		return {
			state: 'done',
			result: { url: await permalinkOf(page, handle.videoId), scheduled: now.scheduled, privacyStatus: 'a public reel on the Page' }
		};
	}
	return now;
}

/** Makes the finish call another run never got to, for its row's caption and slot. */
export async function publishReadyReel(config, handle, row) {
	const page = facebookAccount(config, handle.account ?? '');
	const plan = releasePlan(row.scheduled_at);
	try {
		await finishReel(page, handle.videoId, row.description ?? '', plan);
		const done = await waitForReel(page, handle.videoId, () => {});
		return { url: await permalinkOf(page, handle.videoId), scheduled: done.scheduled, privacyStatus: 'a public reel on the Page' };
	} catch (err) {
		throw explainFacebook(err);
	}
}

let pagesAt = 0;
const pageErrors = new Map();

/**
 * Publishes each Page's public half to the `accounts` collection — id, name,
 * username, link and followers, never the token — so Settings can offer the
 * Pages to brands and the Review step can say which Page a reel goes to. A
 * failed read keeps the last good details beside the error; a row for a Page
 * no longer configured goes.
 */
export async function refreshFacebookPages(pb, config, log, force = false) {
	if (!force && Date.now() - pagesAt < ACCOUNT_TTL_MS) return;
	pagesAt = Date.now();
	const now = new Date().toISOString();
	const pages = config.facebook.accounts.filter(facebookReady);
	for (const entry of pages) {
		const page = facebookAccount(config, entry.pageId);
		const said = pageErrors.get(page.pageId) ?? '';
		try {
			const info = await graph(page, `/${page.pageId}`, { params: { fields: 'id,name,username,link' } });
			await pb.upsertAccount('facebook', page.pageId, {
				handle: info.username ?? '',
				name: info.name || page.pageName,
				details: {
					fetchedAt: now,
					pageId: page.pageId,
					link: info.link ?? '',
					error: ''
				},
				error: '',
				fetched_at: now
			});
			if (said) log(`facebook ${page.pageName}: recovered`);
			pageErrors.delete(page.pageId);
		} catch (err) {
			const message = explainFacebook(err).message;
			if (message !== said) {
				log(`facebook ${page.pageName || page.pageId} failed: ${message.split('\n')[0]}`);
				pageErrors.set(page.pageId, message);
			}
			await pb
				.upsertAccount('facebook', page.pageId, { name: page.pageName, error: message.slice(0, 1900) })
				.catch(() => {});
		}
	}
	await pb.pruneAccounts('facebook', pages.map((p) => p.pageId)).catch(() => {});
}
