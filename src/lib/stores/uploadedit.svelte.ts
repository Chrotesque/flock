import { brands } from './brands.svelte';
import { settings } from './settings.svelte';
import { accounts } from './accounts.svelte';
import { draft, type EditSession, type KeptVideo } from './draft.svelte';
import { paste } from './paste.svelte';
import { jobFileUrl, loadJobImage, loadUploadState } from '../repo';
import { listJobLog } from '../log';
import { buildPlan } from '../plan';
import { PLATFORMS, PLATFORM_IDS } from '../platforms';
import { isoDate, makeTime } from '../format';
import { HAND_PICKED, withoutHandPicked } from '../projects';
import { readUploadRecord, type RecordTarget } from '../uploadrecord';
import { editHold, type EditState } from '../uploadedit';
import { isImagePlatform, type ImagePlatform } from '../coverimage';
import type { PlatformId, UploadJob, UploadTarget } from '../types';

/**
 * Opening a queued upload in the wizard to edit it (uploadedit.ts), from
 * the Calendar's right-click menu. The Calendar `offer`s the upload and goes
 * to /upload; the upload page `take`s it, as it takes a paste or a project,
 * because only it knows whether the draft may change now, and `enter`s it.
 *
 * The wizard is filled the way a resumed project is: each post's text as
 * typed (from the upload's last record, while the post still holds what that
 * record sent — else what it holds, after the rules), its options, its time,
 * the pictures, and the upload's own video kept in the shared slot. TikTok's
 * hand-picked choices are left unmade, as for a project, so they are picked
 * again — or filled by a local module that fills unmade ones (devtest.ts).
 * A post that cannot change any more opens locked, with why.
 */
/** TikTok's hand-picked choices that are on/off switches (tiktok.ts). */
const SWITCHES = ['allowComments', 'allowDuet', 'allowStitch', 'discloseContent', 'brandOrganic', 'brandContent'];

class UploadEditStore {
	pending = $state<string | null>(null);
	/** Which `enter` is current: an older one still loading stops. */
	#entering = 0;

	offer(job: string) {
		this.pending = job;
	}

	take(): string | null {
		const job = this.pending;
		this.pending = null;
		return job;
	}

	async enter(jobId: string) {
		const seq = ++this.#entering;
		paste.cancel();
		draft.reset();
		const fail = (error: string) => paste.show({ title: 'Upload not opened for editing', error });

		let job: UploadJob | null;
		let targets: UploadTarget[];
		let records: (RecordTarget[] | null)[];
		try {
			const [state, rows] = await Promise.all([loadUploadState(jobId), listJobLog(jobId)]);
			job = state.job;
			targets = state.targets;
			records = rows.map((row) => readUploadRecord(row.data)?.targets ?? null);
			await Promise.all([brands.load(), settings.load(), accounts.load()]);
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
			return;
		}
		if (seq !== this.#entering) return;
		if (!job) return fail('That upload is gone.');
		if (job.brand && brands.byId(job.brand)) brands.select(job.brand);
		else if (brands.multiple) return fail(`Its brand${job.brand_name ? `, ${job.brand_name},` : ''} is gone, and its settings with it.`);
		draft.followBrand(brands.currentId);

		const now = Date.now();
		const posts = [...targets]
			.filter((t) => PLATFORM_IDS.includes(t.platform))
			.sort((a, b) => PLATFORM_IDS.indexOf(a.platform) - PLATFORM_IDS.indexOf(b.platform))
			.map((target) => {
				const hold = editHold(target, now);
				return { target, locked: 'refused' in hold ? hold.refused : '' };
			});
		if (!posts.some((p) => !p.locked)) {
			const why = posts.map((p) => `${PLATFORMS[p.target.platform].label}: ${p.locked}`).join(' ');
			return fail(`Nothing in this upload can change any more. ${why}`);
		}

		// Every platform off unless the upload has it open; one ticked now is added.
		draft.selected = Object.fromEntries(PLATFORM_IDS.map((id) => [id, false]));
		let repick = false;
		for (const { target, locked } of posts) {
			const platform = target.platform;
			draft.selected[platform] = !locked;
			draft.texts[platform] = typedText(target, records);
			if (platform === 'tiktok') {
				const { overrides, dropped } = withoutHandPicked({ tiktok: target.options ?? {} });
				draft.overrides.tiktok = overrides.tiktok ?? {};
				repick ||= dropped && !locked;
			} else {
				draft.overrides[platform] = { ...(target.options ?? {}) };
			}
			const at = new Date(target.scheduled_at);
			if (!Number.isNaN(at.getTime())) {
				draft.schedule[platform] = { date: isoDate(at), time: makeTime(at.getHours(), at.getMinutes()) };
			}
		}

		draft.product = job.product ?? '';
		draft.useOwnSplit([]);
		draft.keepVideo('all', keptVideo(job));
		await loadImages(job);
		if (seq !== this.#entering) return;

		const open = posts.filter((p) => !p.locked).map((p) => p.target.platform);
		draft.composing = open[0] ?? null;
		draft.step = 0;
		const images: EditSession['images'] = {};
		for (const platform of draft.activePlatforms.filter(isImagePlatform)) images[platform] = draft.imageFor(platform);
		const baseline = baselineOf(open);
		// TikTok's hand-picked choices open unmade, but what counts as changed
		// is what differs from the post: picked again the same, they are not.
		const tiktok = posts.find((p) => p.target.platform === 'tiktok')?.target;
		if (tiktok && baseline.tiktok) {
			for (const key of HAND_PICKED.tiktok ?? []) {
				const held = tiktok.options?.[key];
				// A switch the post never wrote down was off.
				if (held !== undefined) baseline.tiktok.options[key] = held;
				else if (SWITCHES.includes(key)) baseline.tiktok.options[key] = false;
			}
		}
		draft.editing = {
			job: job.id,
			title: job.title || job.video_name || 'Untitled',
			product: job.product ?? '',
			posts: posts.map(({ target, locked }) => ({ id: target.id, platform: target.platform, locked })),
			targets: posts.map(({ target }) => $state.snapshot(target) as UploadTarget),
			baseline,
			images
		};

		const notes: string[] = [];
		for (const { target, locked } of posts) {
			if (locked) notes.push(`${PLATFORMS[target.platform].label} stays as it is: ${locked}`);
		}
		if (repick) {
			notes.push("TikTok's audience, comments, Duet, Stitch and disclosure are chosen again: they are picked by hand on every post.");
		}
		if (records.every((r) => r === null)) {
			notes.push("Uploaded before flock kept what was typed, so the text is what was sent — after the platforms' rules.");
		}
		paste.show({ title: `Editing ${draft.editing.title}`, brand: brands.multiple ? (brands.current?.name ?? '') : '', notes });
	}
}

/**
 * A post's text as typed, from the newest record that sent exactly what the
 * post holds now; else what it holds. A rename or another edit since makes
 * the older records stale, and the post itself is then the truth.
 */
function typedText(target: UploadTarget, records: (RecordTarget[] | null)[]): { title: string; description: string } {
	for (const targets of [...records].reverse()) {
		const sent = targets?.find((t) => t.platform === target.platform);
		if (sent && sent.title === target.title && sent.description === target.description) return { ...sent.typed };
	}
	return { title: target.title, description: target.description };
}

function keptVideo(job: UploadJob): KeptVideo {
	return {
		job: job.id,
		name: job.video_name || job.video || 'video',
		size: job.video_size ?? 0,
		duration: job.video_duration ?? 0,
		source: job.video ? 'browser' : job.source_local || job.source_origin ? 'local' : 'nas',
		path: job.source_path ?? '',
		url: job.video ? jobFileUrl(job, job.video) : ''
	};
}

/**
 * The upload's pictures back in the draft: one for every platform while
 * Instagram's and Facebook's are the same picture, else each its own.
 * TikTok's was made from one of them, so it is not loaded on its own unless
 * it is the only one.
 */
async function loadImages(job: UploadJob) {
	const [instagram, facebook, tiktok] = await Promise.all([
		job.cover ? loadJobImage(job, job.cover).catch(() => null) : null,
		job.facebook_cover ? loadJobImage(job, job.facebook_cover).catch(() => null) : null,
		job.tiktok_cover && !job.cover && !job.facebook_cover ? loadJobImage(job, job.tiktok_cover).catch(() => null) : null
	]);
	const linked = !(instagram && facebook) || instagram.size === facebook.size;
	draft.imagesLinked = linked;
	if (linked) {
		draft.thumbnail = instagram ?? facebook ?? tiktok;
	} else {
		draft.cover = instagram;
		draft.thumbnail = facebook;
	}
}

/** The posts as the wizard now holds them, for a save to compare against. */
function baselineOf(platforms: PlatformId[]): Partial<Record<PlatformId, EditState>> {
	const out: Partial<Record<PlatformId, EditState>> = {};
	for (const row of buildPlan()) {
		if (!platforms.includes(row.platform)) continue;
		out[row.platform] = {
			title: row.title,
			description: row.description,
			options: $state.snapshot(row.options),
			at: new Date(`${row.date}T${row.time}`).toISOString()
		};
	}
	return out;
}

/** Whether a picture of the draft is the one the edit opened with. */
export function sameImage(platform: ImagePlatform, file: File | null): boolean {
	const opened = draft.editing?.images[platform];
	return (opened ?? null) === file;
}

export const uploadEdit = new UploadEditStore();
