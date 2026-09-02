// The YouTube adapter: one upload_targets row -> one video on the channel.
//
// Everything it reads out of `options` is a field that videos.insert actually
// accepts. The mapping lives here rather than in platforms.ts so the registry
// stays a description of the interface, not of Google's wire format.

import { request as httpsRequest } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { accessToken, forgetToken } from './google.mjs';

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

	return {
		snippet: {
			// The API rejects an empty title outright, and a target with no title
			// should not take the whole upload down at the last step.
			title: (target.title || 'Untitled').slice(0, 100),
			description: (target.description || '').slice(0, 5000),
			tags: Array.isArray(options.tags) ? options.tags : [],
			categoryId: CATEGORY_IDS[options.category] ?? '22'
		},
		status
	};
}

async function api(token, path, options = {}) {
	const res = await fetch(`${API}${path}`, {
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

/** Opens a resumable session and returns the URL the bytes go to. */
async function startSession(token, resource, { size, mimeType, notifySubscribers }) {
	const url = new URL(UPLOAD);
	url.searchParams.set('uploadType', 'resumable');
	url.searchParams.set('part', 'snippet,status');
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

		pipeline(Readable.fromWeb(body), progressMeter(size, onProgress), req).catch(reject);
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

export async function publishToYouTube({ target, job, pb, config, log }) {
	const options = target.options ?? {};
	const release = resolveRelease(options, target.scheduled_at);

	let token = await accessToken(config.google);
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
		forgetToken();
		token = await accessToken(config.google);
		uploadUrl = await startSession(token, resource, {
			size: video.size,
			mimeType: video.mimeType,
			notifySubscribers: options.notifySubscribers
		});
	}

	const result = await putVideo(uploadUrl, video.body, {
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

	if (options.playlist && String(options.playlist).trim()) {
		try {
			await addToPlaylist(token, videoId, String(options.playlist), log);
		} catch (err) {
			log(`playlist add failed (video is still up): ${err.message}`);
		}
	}

	return { videoId, url, scheduled: release.scheduled, privacyStatus: got, locked };
}
