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

export function makeClient(baseUrl) {
	async function request(path, options = {}) {
		const res = await fetch(`${baseUrl}${path}`, {
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
		 * Everything `pending` is picked up immediately rather than at its slot:
		 * YouTube takes the release time itself via `publishAt`, so uploading
		 * early is what stops a slow transfer from missing the window. A platform
		 * that cannot schedule server-side will need a due-time filter here.
		 */
		async pendingTargets(platform) {
			const filter = encodeURIComponent(`platform="${platform}" && status="pending"`);
			const res = await request(
				`/api/collections/upload_targets/records?perPage=50&sort=scheduled_at&filter=${filter}`
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
			const filter = encodeURIComponent('destination_path != "" && status = "stored"');
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

		videoUrl(job) {
			return `${baseUrl}/api/files/upload_jobs/${job.id}/${encodeURIComponent(job.video)}`;
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
				return { stream: createReadStream(path), size: info.size, mimeType: 'video/*' };
			}

			const res = await fetch(this.videoUrl(job));
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

		/**
		 * Fire-and-forget, exactly like the SPA's logAction: a failed log write
		 * must never take down the publish it describes. `device` is the machine
		 * that acted, and for these rows that machine is the worker.
		 */
		log(action, detail = '') {
			request('/api/collections/activity_log/records', {
				method: 'POST',
				body: JSON.stringify({
					category: 'upload',
					action: action.slice(0, 200),
					detail: detail.slice(0, 1900),
					device: 'worker'
				})
			}).catch(() => {});
		}
	};
}
