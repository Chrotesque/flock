// flock's PocketBase, over plain REST.
//
// No credentials, deliberately: every collection has fully open rules because
// the app is local, single-user and unauthenticated. `assertDeviceNamed()` is a
// guard inside the SPA, not a PocketBase rule, so the worker writes freely.
//
// The SDK is not used here — the worker has no bundler and wants a readable
// stream of the video file, which the SDK does not hand back.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { resolveFolder } from './paths.mjs';
import { fetchOrExplain } from './net.mjs';
import { mimeFromName, pbDate } from './upload.mjs';
import { currentJob } from './jobscope.mjs';

export function makeClient(baseUrl) {
	async function request(path, options = {}) {
		const res = await fetchOrExplain(`${baseUrl}${path}`, {
			...options,
			headers: {
				...(options.body ? { 'Content-Type': 'application/json' } : {}),
				...options.headers
			}
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`${options.method || 'GET'} ${path} -> ${res.status}\n${text}`);
		}
		return text ? JSON.parse(text) : null;
	}

	return {
		baseUrl,

		/** Health probe, so a misconfigured URL fails loudly at startup. */
		async health() {
			return request('/api/health');
		},

		/**
		 * Targets waiting to go out for one platform, oldest slot first.
		 *
		 * Without `dueBy`, everything `pending` is picked up immediately rather
		 * than at its slot: YouTube takes the release time itself via
		 * `publishAt`, so uploading early is what stops a slow transfer from
		 * missing the window. The platforms that cannot schedule server-side
		 * pass `dueBy` — an instant, usually now plus their lead — and get only
		 * the rows whose slot falls on or before it.
		 */
		async pendingTargets(platform, dueBy = null) {
			let clause = `platform="${platform}" && status="pending"`;
			if (dueBy) clause += ` && scheduled_at <= "${pbDate(dueBy)}"`;
			const filter = encodeURIComponent(clause);
			const res = await request(
				`/api/collections/upload_targets/records?perPage=50&sort=scheduled_at&filter=${filter}`
			);
			return res.items ?? [];
		},

		/**
		 * What the warning card looks at (alerts.mjs undelivered): posts that
		 * failed since `since`, and every one still waiting, each with its job's
		 * creation, title and whether it is a local pick not on the NAS yet.
		 */
		async undeliveredCandidates(since) {
			const filter = encodeURIComponent(`(status="failed" && scheduled_at >= "${pbDate(since)}") || status="pending"`);
			const fields = encodeURIComponent(
				'id,job,platform,status,scheduled_at,updated,title,error,expand.job.created,expand.job.title,expand.job.source_local'
			);
			const res = await request(
				`/api/collections/upload_targets/records?perPage=200&expand=job&fields=${fields}&filter=${filter}`
			);
			return res.items ?? [];
		},

		/** Rows left mid-flight by a crash. Only safe to call when nothing is running. */
		async stalePublishing(platform) {
			const filter = encodeURIComponent(`platform="${platform}" && status="publishing"`);
			const res = await request(`/api/collections/upload_targets/records?perPage=50&filter=${filter}`);
			return res.items ?? [];
		},

		/** Scoring asks waiting to be answered, oldest first. */
		async pendingScores() {
			const filter = encodeURIComponent('status="pending"');
			const res = await request(
				`/api/collections/score_requests/records?perPage=20&sort=created&filter=${filter}`
			);
			return res.items ?? [];
		},

		async updateScore(id, data) {
			return request(`/api/collections/score_requests/records/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
		},

		/** The compose screen's asks for an image on this machine, oldest first. */
		/**
		 * Every project row, with the worker's half of its fields only — the
		 * page's draft and images are none of the worker's business.
		 */
		async listProjects() {
			const fields = 'id,key,path,name,root,local,manifest,manifest_name,manifest_modified,videos,missing,error,archived_at';
			const out = [];
			for (let page = 1; ; page++) {
				const res = await request(`/api/collections/projects/records?perPage=500&page=${page}&fields=${fields}`);
				out.push(...(res.items ?? []));
				if (page >= (res.totalPages ?? 1)) return out;
			}
		},

		/** Whether any row of a platform is waiting — one id, for nudging the main loop. */
		async hasPending(platform) {
			const filter = encodeURIComponent(`platform="${platform}" && status="pending"`);
			const res = await request(`/api/collections/upload_targets/records?perPage=1&skipTotal=1&fields=id&filter=${filter}`);
			return (res.items ?? []).length > 0;
		},

		/** Projects sent whose file has not been renamed yet (see archivePass). */
		async projectsToArchive() {
			const filter = encodeURIComponent('status = "uploaded" && archived_at = ""');
			const fields = 'id,key,path,name,local,manifest_name';
			const res = await request(`/api/collections/projects/records?perPage=50&filter=${filter}&fields=${fields}`);
			return res.items ?? [];
		},

		async createProject(data) {
			return request('/api/collections/projects/records', { method: 'POST', body: JSON.stringify(data) });
		},

		async updateProject(id, data) {
			return request(`/api/collections/projects/records/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
		},

		async pendingFileRequests() {
			const filter = encodeURIComponent('status="pending"');
			const res = await request(
				`/api/collections/file_requests/records?perPage=10&sort=created&filter=${filter}`
			);
			return res.items ?? [];
		},

		async updateFileRequest(id, data) {
			return request(`/api/collections/file_requests/records/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
		},

		/** Answers an ask with the image itself — multipart, which `request` does not do. */
		async answerFileRequest(id, { bytes, name, type }) {
			const form = new FormData();
			form.set('status', 'done');
			form.set('name', name);
			form.set('error', '');
			form.set('file', new Blob([bytes], { type }), name);
			const path = `/api/collections/file_requests/records/${id}`;
			const res = await fetchOrExplain(`${baseUrl}${path}`, { method: 'PATCH', body: form });
			if (!res.ok) throw new Error(`PATCH ${path} -> ${res.status}\n${await res.text()}`);
		},

		/** Deletes asks made before `before`, answered or not; the page deletes its own once it has the image. */
		async pruneFileRequests(before) {
			const filter = encodeURIComponent(`created < "${pbDate(before)}"`);
			const res = await request(
				`/api/collections/file_requests/records?perPage=200&fields=id&skipTotal=1&filter=${filter}`
			);
			for (const item of res.items ?? []) {
				await request(`/api/collections/file_requests/records/${item.id}`, { method: 'DELETE' });
			}
		},

		async getJob(id) {
			return request(`/api/collections/upload_jobs/records/${id}`);
		},

		/**
		 * Jobs with a destination folder that have not been filed into it yet.
		 *
		 * `stored` means "in PocketBase, not yet copied"; `done` means the copy
		 * landed. Nothing in the SPA branches on this field — Analytics only
		 * displays it — so those two values are free to carry that meaning.
		 */
		async pendingCopies() {
			// A local pick waits for its import: until then there is nothing on
			// the NAS to file.
			const filter = encodeURIComponent(
				'destination_path != "" && status = "stored" && source_local = false'
			);
			const res = await request(
				`/api/collections/upload_jobs/records?perPage=50&sort=created&filter=${filter}`
			);
			return res.items ?? [];
		},

		/** Jobs whose video is still in a local folder, waiting to be copied to the NAS. */
		async pendingImports() {
			const filter = encodeURIComponent('source_local = true');
			const res = await request(
				`/api/collections/upload_jobs/records?perPage=50&sort=created&filter=${filter}`
			);
			return res.items ?? [];
		},

		async updateJob(id, data) {
			return request(`/api/collections/upload_jobs/records/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
		},

		async getTarget(id) {
			return request(`/api/collections/upload_targets/records/${id}`);
		},

		async updateTarget(id, data) {
			return request(`/api/collections/upload_targets/records/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
		},

		/** Every video the stats pass has ever seen, newest first. */
		async listVideoStats() {
			const res = await request(
				'/api/collections/video_stats/records?perPage=200&sort=-published_at'
			);
			return res.items ?? [];
		},

		async createVideoStats(data) {
			return request('/api/collections/video_stats/records', {
				method: 'POST',
				body: JSON.stringify(data)
			});
		},

		async updateVideoStats(id, data) {
			return request(`/api/collections/video_stats/records/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
		},

		/** Every `post_stats` row of a platform (igstats.mjs). */
		async listPostStats(platform) {
			const filter = encodeURIComponent(`platform = '${platform}'`);
			const out = [];
			for (let page = 1; ; page++) {
				const res = await request(`/api/collections/post_stats/records?perPage=500&page=${page}&filter=${filter}`);
				out.push(...(res.items ?? []));
				if (page >= (res.totalPages ?? 1)) return out;
			}
		},

		async createPostStats(data) {
			return request('/api/collections/post_stats/records', {
				method: 'POST',
				body: JSON.stringify(data)
			});
		},

		async updatePostStats(id, data) {
			return request(`/api/collections/post_stats/records/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data)
			});
		},

		videoUrl(job) {
			return `${baseUrl}/api/files/upload_jobs/${job.id}/${encodeURIComponent(job.video)}`;
		},

		thumbnailUrl(job) {
			return `${baseUrl}/api/files/upload_jobs/${job.id}/${encodeURIComponent(job.thumbnail)}`;
		},

		/** The chosen thumbnail as bytes. Small enough to hold in memory: YouTube caps it at 2 MB. */
		async openThumbnail(job) {
			const res = await fetchOrExplain(this.thumbnailUrl(job));
			if (!res.ok) throw new Error(`Cannot read the stored thumbnail (${res.status})`);
			return {
				bytes: Buffer.from(await res.arrayBuffer()),
				mimeType: res.headers.get('content-type') || 'image/jpeg'
			};
		},

		coverUrl(job) {
			return `${baseUrl}/api/files/upload_jobs/${job.id}/${encodeURIComponent(job.cover)}`;
		},

		/** The chosen reel cover as bytes, capped at Instagram's 8 MB by the schema. */
		async openCover(job) {
			const res = await fetchOrExplain(this.coverUrl(job));
			if (!res.ok) throw new Error(`Cannot read the stored cover (${res.status})`);
			return {
				bytes: Buffer.from(await res.arrayBuffer()),
				mimeType: res.headers.get('content-type') || 'image/jpeg'
			};
		},

		/** Facebook's reel cover as bytes, capped at Facebook's 10 MB by the schema. */
		async openFacebookCover(job) {
			const url = `${baseUrl}/api/files/upload_jobs/${job.id}/${encodeURIComponent(job.facebook_cover)}`;
			const res = await fetchOrExplain(url);
			if (!res.ok) throw new Error(`Cannot read the stored Facebook cover (${res.status})`);
			return {
				bytes: Buffer.from(await res.arrayBuffer()),
				mimeType: res.headers.get('content-type') || 'image/jpeg'
			};
		},

		/**
		 * Opens a job's video for reading, whichever route it arrived by.
		 *
		 * Always hands back a Node stream and a byte length: callers pipe it, and
		 * YouTube's resumable upload has to declare the length up front. A job
		 * with `source_path` never went through PocketBase at all — the bytes are
		 * read straight off the NAS, which is what makes a file above the 5 GiB
		 * upload cap publishable.
		 */
		async openVideo(job) {
			if (job.source_path) {
				const path = await resolveFolder(job.source_path);
				let info;
				try {
					info = await stat(path);
				} catch (err) {
					throw new Error(`Referenced video is gone: ${job.source_path} (${err.code || err.message})`);
				}
				if (!info.isFile() || info.size === 0) {
					throw new Error(`Referenced video is not a readable file: ${job.source_path}`);
				}
				// Typed from the name: YouTube accepts a wildcard, but TikTok and
				// Instagram refuse one, and a file on disk reports no type itself.
				return {
					stream: createReadStream(path),
					size: info.size,
					mimeType: mimeFromName(job.video_name || path, 'video/*')
				};
			}

			const res = await fetchOrExplain(this.videoUrl(job));
			if (!res.ok || !res.body) {
				throw new Error(`Cannot read the stored video (${res.status}) at ${this.videoUrl(job)}`);
			}
			const size = Number(res.headers.get('content-length'));
			if (!Number.isFinite(size) || size <= 0) {
				throw new Error('PocketBase did not report a size for the stored video.');
			}
			return {
				stream: Readable.fromWeb(res.body),
				size,
				mimeType: res.headers.get('content-type') || 'video/*'
			};
		},

		/** app_settings is key/value; the worker uses it for the watch index. */
		async getSetting(key) {
			const filter = encodeURIComponent(`key="${key}"`);
			const res = await request(`/api/collections/app_settings/records?perPage=1&filter=${filter}`);
			return res.items?.[0] ?? null;
		},

		async setSetting(key, value) {
			const existing = await this.getSetting(key);
			if (existing) {
				return request(`/api/collections/app_settings/records/${existing.id}`, {
					method: 'PATCH',
					body: JSON.stringify({ value })
				});
			}
			return request('/api/collections/app_settings/records', {
				method: 'POST',
				body: JSON.stringify({ key, value })
			});
		},

		/** The accounts the worker has published for one platform. */
		async listAccounts(platform) {
			const filter = encodeURIComponent(`platform="${platform}"`);
			const res = await request(`/api/collections/accounts/records?perPage=200&filter=${filter}`);
			return res.items ?? [];
		},

		/**
		 * Writes the public half of an account — never a token — keyed by the
		 * platform and the platform's own id for it, which a unique index holds.
		 */
		async upsertAccount(platform, accountId, data) {
			const filter = encodeURIComponent(`platform="${platform}" && account_id="${accountId}"`);
			const res = await request(`/api/collections/accounts/records?perPage=1&filter=${filter}`);
			const existing = res.items?.[0];
			if (existing) {
				return request(`/api/collections/accounts/records/${existing.id}`, {
					method: 'PATCH',
					body: JSON.stringify(data)
				});
			}
			return request('/api/collections/accounts/records', {
				method: 'POST',
				body: JSON.stringify({ platform, account_id: accountId, ...data })
			});
		},

		async deleteAccount(id) {
			return request(`/api/collections/accounts/records/${id}`, { method: 'DELETE' });
		},

		/**
		 * Brings a platform's rows in line with the accounts this worker holds:
		 * a row for an account no longer configured goes, so the screens stop
		 * offering an account nothing can post through.
		 */
		async pruneAccounts(platform, keepIds) {
			for (const row of await this.listAccounts(platform)) {
				if (!keepIds.includes(row.account_id)) await this.deleteAccount(row.id);
			}
		},

		/** One line of the worker's console, for the Log screen — see remotelog.mjs. */
		async appendWorkerLog(row) {
			return request('/api/collections/worker_log/records', {
				method: 'POST',
				body: JSON.stringify(row)
			});
		},

		/** Deletes worker console lines written before `before`, a page at a time. */
		async pruneWorkerLog(before) {
			const filter = encodeURIComponent(`created < "${pbDate(before)}"`);
			for (let round = 0; round < 50; round++) {
				const res = await request(
					`/api/collections/worker_log/records?perPage=200&fields=id&skipTotal=1&filter=${filter}`
				);
				const items = res.items ?? [];
				for (const item of items) {
					await request(`/api/collections/worker_log/records/${item.id}`, { method: 'DELETE' });
				}
				if (items.length < 200) return;
			}
		},

		/**
		 * Fire-and-forget, exactly like the SPA's logAction: a failed log write
		 * must never take down the publish it describes. `device` is the machine
		 * that acted, and for these rows that machine is the worker. Written
		 * while an upload is handled, the row names its job (jobscope.mjs).
		 */
		log(action, detail = '') {
			const job = currentJob();
			request('/api/collections/activity_log/records', {
				method: 'POST',
				body: JSON.stringify({
					category: 'upload',
					action: action.slice(0, 200),
					detail: detail.slice(0, 1900),
					device: 'worker',
					...(job ? { job } : {})
				})
			}).catch(() => {});
		}
	};
}
