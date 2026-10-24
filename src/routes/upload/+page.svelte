<script lang="ts">
	import { untrack } from 'svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import StepUpload from '$lib/components/steps/StepUpload.svelte';
	import StepDetails from '$lib/components/steps/StepDetails.svelte';
	import StepSchedule from '$lib/components/steps/StepSchedule.svelte';
	import StepConfirm from '$lib/components/steps/StepConfirm.svelte';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import PlatformSwitch from '$lib/components/PlatformSwitch.svelte';
	import { draft, type EditSession, type SlotVideo, type Step, type VideoSlot } from '$lib/stores/draft.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { buildPlan, type PlanRow } from '$lib/plan';
	import { base } from '$app/paths';
	import {
		applyEdit,
		createJob,
		loadUploadState,
		rememberTags,
		rememberUsedSources,
		toInstant,
		updateJobImages,
		type TargetPlan
	} from '$lib/repo';
	import { planEdit, stepWords, type EditRow } from '$lib/uploadedit';
	import { uploadEdit } from '$lib/stores/uploadedit.svelte';
	import { logAction } from '$lib/log';
	import { findMentions, handleKey, mentionNotes } from '$lib/tiktokmentions';
	import { tiktokHandles } from '$lib/stores/tiktokhandles.svelte';
	import { RECORD_VERSION, timingOfTargets, type UploadRecord } from '$lib/uploadrecord';
	import { allowanceWarning, postAllowance, youtubeGrantWarnings } from '$lib/accounts';
	import { facebookProblems } from '$lib/facebook';
	import { devtestActive } from '$lib/devtest';
	import { VERSION } from '$lib/version';
	import { formatBytes, isoDate } from '$lib/format';
	import { imageFits, type ImagePlatform } from '$lib/coverimage';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import { PLATFORMS } from '$lib/platforms';
	import type { OptionValues, PlatformId } from '$lib/types';
	import { paste } from '$lib/stores/paste.svelte';
	import { projects } from '$lib/stores/projects.svelte';
	import { uploadedName } from '$lib/projects';
	import { videoTodo } from '$lib/stores/videotodo.svelte';
	import { takenHours } from '$lib/stores/takenhours.svelte';
	import { hourKey, takenWhy } from '$lib/takenhours';
	import { onDestroy } from 'svelte';

	settings.load();
	general.load();

	// The draft drops its per-platform choices when the brand changes — here,
	// or in Settings while the draft waited. Read through untrack, so only the
	// brand is a dependency.
	$effect(() => {
		const brand = brands.currentId;
		untrack(() => draft.followBrand(brand));
	});

	let plan = $derived(draft.step === 3 ? buildPlan() : []);

	/**
	 * Why the confirm tick waits, for TikTok: its posting rules still unmet —
	 * the account check can turn up a cap on Review, and a folder pick's
	 * length is only known once the stage has loaded it — or its video not
	 * previewed yet, which TikTok's guidelines ask for before anything is sent.
	 */
	let tiktokHold = $derived.by(() => {
		if (draft.step !== 3 || !plan.some((row) => row.platform === 'tiktok')) return '';
		const problem = draft.tiktokProblems[0];
		if (problem) return `TikTok: ${problem}`;
		if (!draft.previewed[draft.slotFor('tiktok')]) {
			const tab = draft.slots.length > 1 ? ", on TikTok's tab" : '';
			return `TikTok asks for the video to be previewed before it is posted: let it load on the stage${tab}. A video picked from a folder plays through the PC worker.`;
		}
		return '';
	});

	/** Why the confirm tick waits, for Facebook: a video it would not take as a reel. */
	let facebookHold = $derived.by(() => {
		if (draft.step !== 3 || !plan.some((row) => row.platform === 'facebook')) return '';
		const problem = facebookProblems(draft.videoFor('facebook').duration)[0];
		return problem ? `Facebook: ${problem}` : '';
	});

	/** The wizard's posts as an edit would save them (uploadedit.ts). */
	function editRows(rows: PlanRow[], job: string): EditRow[] {
		return rows.map((row) => ({
			platform: row.platform,
			title: row.title,
			description: row.description,
			options: $state.snapshot(row.options) as OptionValues,
			at: toInstant(row.date, row.time),
			immediate: row.immediate,
			kept: draft.videoFor(row.platform).kept?.job === job
		}));
	}

	/**
	 * What saving an edit would do, worked out on the Review step against
	 * the posts as the edit opened them — the save itself reads them again.
	 */
	let editPreview = $derived.by(() => {
		const session = draft.editing;
		if (!session || draft.step !== 3) return null;
		const opened = session.posts.filter((post) => !post.locked).map((post) => post.platform);
		const { steps, refused } = planEdit({
			posts: session.targets,
			baseline: session.baseline,
			opened,
			rows: editRows(plan, session.job)
		});
		const kept = groupsOf(plan).find((group) => group.video.kept?.job === session.job);
		const others = groupsOf(plan).filter((group) => !group.video.kept);
		const lines = [
			...steps.map(stepWords),
			...imageEdits(session, kept).words,
			...others.map((group) => `${group.platforms.map((id) => PLATFORMS[id].label).join(', ')}: new video ${draft.slotName(group.slot)}`)
		];
		return { lines, refused };
	});

	/** Why an edit cannot be saved as it stands. */
	let editHold = $derived(
		editPreview?.refused.length ? editPreview.refused.join(' ') : editPreview && editPreview.lines.length === 0 ? 'Nothing changed yet.' : ''
	);

	/** Whatever holds the confirm tick back, TikTok's rules first. */
	let confirmHold = $derived(tiktokHold || facebookHold || editHold);

	// The confirm button deliberately takes two clicks, the second within two
	// seconds of the first: this is the point where a multi-GB upload and four
	// scheduled publishes become real.
	let armed = $state(false);
	let armTimer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		if (armTimer) clearTimeout(armTimer);
		armTimer = null;
		armed = false;
	}
	let phase = $state<'idle' | 'uploading' | 'done' | 'error'>('idle');
	let progress = $state(0);
	let failure = $state('');

	// Any edit disarms the confirmation, so a stale second click cannot fire.
	$effect(() => {
		void draft.step;
		disarm();
	});

	/** Which platforms sit in a taken hour, in words. */
	function takenWords(ids: PlatformId[]): string {
		const names = ids.map((id) => PLATFORMS[id].label).join(', ');
		const brand = brands.current?.name ?? 'this brand';
		return `${names} ${ids.length === 1 ? 'falls' : 'fall'} in an hour another ${brand} video goes out in.`;
	}

	/** Platforms ticked since the upload step whose video slot is still empty. */
	let missingVideo = $derived(
		draft.slots.filter((entry) => !draft.slotHasVideo(entry.slot)).flatMap((entry) => entry.platforms)
	);

	function goto(step: Step) {
		draft.step = step;
		disarm();
	}

	function next() {
		if (draft.step < 3) goto((draft.step + 1) as Step);
	}

	function back() {
		if (draft.step > 0) goto((draft.step - 1) as Step);
	}

	let canContinue = $derived(
		draft.step === 0
			? draft.canLeaveUpload
			: draft.step === 1
				? draft.canLeaveDetails && draft.hasVideo
				: draft.step === 2
					? draft.scheduleComplete && draft.pastPlatforms.length === 0 && draft.takenHold.length === 0
					: true
	);

	/** The video being sent right now, for the progress line. */
	let sending = $state<{ name: string; size: number; transfer: boolean; local: boolean } | null>(
		null
	);

	interface Group {
		slot: VideoSlot;
		/** The platforms the slot serves, the plan's or not. */
		platforms: PlatformId[];
		video: SlotVideo;
		rows: PlanRow[];
	}

	/**
	 * What one video's part of the upload confirmed, for its Log row
	 * (uploadrecord.ts): the file, each post's text as typed and as sent,
	 * its options, slot and account, and what the Review step warned about.
	 */
	function recordFor(
		group: Group,
		everyGroup: Group[],
		cover: File | null,
		facebookCover: File | null,
		tiktokCover: File | null
	): UploadRecord {
		const { file, nasFile, kept, duration } = group.video;
		const destination = general.defaultDestination;
		const targets = group.rows.map((row) => {
			const typed = draft.textFor(row.platform);
			const profileId = draft.profile[row.platform];
			const profile = profileId
				? (settings.get(row.platform)?.scheduling.profiles.find((p) => p.id === profileId)?.name ?? '')
				: '';
			return {
				platform: row.platform,
				account: accounts.postingAs(row.platform),
				accountId: accounts.for(row.platform)?.account_id ?? '',
				typed: { title: typed.title, description: typed.description },
				title: row.title,
				description: row.description,
				rules: row.allHits
					.filter((hit) => hit.count > 0 || hit.error)
					.map((hit) => ({
						find: hit.find,
						replace: hit.replace,
						count: hit.count,
						...(hit.error ? { error: hit.error } : {})
					})),
				options: row.options,
				immediate: row.immediate,
				date: row.date,
				time: row.time,
				scheduledAt: toInstant(row.date, row.time),
				profile,
				warnings: reviewWarnings(row)
			};
		});
		return {
			v: RECORD_VERSION,
			version: VERSION,
			confirmedAt: new Date().toISOString(),
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
			brand: brands.current?.name ?? '',
			project: draft.project ? (projects.byId(draft.project)?.name ?? '') : '',
			video: {
				name: file?.name ?? nasFile?.name ?? kept?.name ?? '',
				size: file?.size ?? nasFile?.size ?? kept?.size ?? 0,
				duration: Math.round(duration || 0),
				source: file ? 'browser' : nasFile ? (nasFile.local ? 'local' : 'nas') : (kept?.source ?? 'nas'),
				path: file ? '' : (nasFile?.path ?? kept?.path ?? ''),
				previewed: Boolean(draft.previewed[group.slot])
			},
			others: everyGroup
				.filter((other) => other.slot !== group.slot)
				.map((other) => ({
					name: other.video.file?.name ?? other.video.nasFile?.name ?? other.video.kept?.name ?? '',
					platforms: other.rows.map((row) => row.platform)
				})),
			destination: destination ? { label: destination.label, path: destination.path } : null,
			cover: cover ? { name: cover.name, size: cover.size } : null,
			facebookCover: facebookCover ? { name: facebookCover.name, size: facebookCover.size } : null,
			tiktokCover: tiktokCover ? { name: tiktokCover.name, size: tiktokCover.size } : null,
			devtest: devtestActive(),
			targets,
			timing: timingOfTargets(targets)
		};
	}

	/** The Review step's warnings for a post, in its words — none of them stop the confirm. */
	function reviewWarnings(row: PlanRow): string[] {
		const out: string[] = [];
		if (row.platform === 'youtube') {
			out.push(...youtubeGrantWarnings(row.options, accounts.for('youtube')));
			if (row.options.visibility === 'Private') out.push('Private: uploaded as private and left private.');
		}
		if (row.platform === 'tiktok') {
			const privacy = String(row.options.privacy ?? '');
			if (privacy && privacy !== 'Public') out.push(`Posted for ${privacy.toLowerCase()} only.`);
			for (const note of mentionNotes(row.description, tiktokHandles.rows)) {
				if (note.state !== 'found' && !out.includes(note.words)) out.push(note.words);
			}
		}
		const due = row.immediate ? Date.now() : Date.parse(toInstant(row.date, row.time));
		const allowance = allowanceWarning(postAllowance(accounts.for(row.platform)), due);
		if (allowance) out.push(allowance);
		if (draft.overrideTaken && draft.takenPlatforms.includes(row.platform)) {
			const at = new Date(due);
			const posts = takenHours
				.for(brands.currentId, draft.ownJobs)
				.get(hourKey(isoDate(at), at.getHours()));
			if (posts) out.push(`Put in a taken hour with Override. ${takenWhy(posts)}`);
		}
		return out;
	}

	/**
	 * The reel covers for a video's posts, each only for a platform on it
	 * that it fits — the picker has already said when it does not. YouTube
	 * gets no thumbnail any more (coverimage.ts).
	 */
	function coversFor(platforms: PlatformId[]) {
		const coverFor = (platform: ImagePlatform) =>
			platforms.includes(platform) && imageFits(draft.imageFor(platform), platform) ? draft.imageFor(platform) : null;
		return { cover: coverFor('instagram'), facebookCover: coverFor('facebook'), tiktokCover: coverFor('tiktok') };
	}

	/** A post as its row is written. */
	function targetPlan(row: PlanRow): TargetPlan {
		return {
			platform: row.platform,
			// The brand's account, so the worker posts through exactly it.
			account: accounts.for(row.platform)?.account_id ?? '',
			title: row.title,
			description: row.description,
			options: row.options,
			date: row.date,
			time: row.time
		};
	}

	/** One job per distinct video, each with the plan's posts it serves. */
	function groupsOf(rows: PlanRow[]): Group[] {
		return draft.slots
			.map((entry) => ({
				...entry,
				video: draft.videos[entry.slot],
				rows: rows.filter((row) => entry.platforms.includes(row.platform))
			}))
			.filter((group) => group.rows.length > 0);
	}

	/**
	 * One video and its posts, written as an upload: the bytes sent (a folder
	 * pick sends none), its rows created, its slot marked queued so a second
	 * confirm after a failure sends only the rest. The new job's id.
	 */
	async function sendGroup(group: Group, everyGroup: Group[], onProgress: (fraction: number) => void): Promise<string> {
		const { file, nasFile, duration } = group.video;
		const label = draft.labelFor(group.platforms);
		sending = {
			name: file?.name ?? nasFile?.name ?? '',
			size: file?.size ?? nasFile?.size ?? 0,
			transfer: Boolean(file),
			local: Boolean(nasFile?.local)
		};
		const { cover, facebookCover, tiktokCover } = coversFor(group.platforms);
		const job = await createJob(
			{
				title: label.title,
				description: label.description,
				file,
				source: nasFile,
				thumbnail: null,
				cover,
				facebookCover,
				tiktokCover,
				duration,
				destination: general.defaultDestination,
				brand: brands.current ?? null,
				targets: group.rows.map(targetPlan),
				record: $state.snapshot(recordFor(group, everyGroup, cover, facebookCover, tiktokCover)) as UploadRecord
			},
			onProgress
		);
		draft.queued = [...draft.queued, group.slot];
		draft.queuedJobs = [...draft.queuedJobs, job.id];
		// So the file lists stop offering it; see loadUsedSources.
		if (file || nasFile) {
			rememberUsedSources([
				file ? { name: file.name, size: file.size } : { path: nasFile!.path, name: nasFile!.name, size: nasFile!.size }
			]);
		}
		return job.id;
	}

	/** What the brand's next upload remembers of this one: its tags, and the TikTok handles it names. */
	function rememberSent() {
		// From the plan rather than the draft, so what is stored is what
		// actually went out — overrides and saved defaults included.
		rememberTags(
			brands.currentId,
			Object.fromEntries(
				plan
					.map((row) => {
						const boxes: Record<string, string[]> = {};
						for (const key of PLATFORMS[row.platform].tagBudget?.keys ?? []) {
							const list = row.options[key];
							if (Array.isArray(list) && list.length > 0) boxes[key] = list as string[];
						}
						return [row.platform, boxes] as const;
					})
					.filter(([, boxes]) => Object.keys(boxes).length > 0)
			)
		);
		// The TikTok handles it names come first in the @ list next time.
		const tiktok = plan.find((row) => row.platform === 'tiktok');
		if (tiktok) tiktokHandles.markUsed(findMentions(tiktok.description).map((m) => handleKey(m.handle)));
	}

	/** What the last save of an edit did, for the done screen. */
	let edited = $state<{ title: string; lines: string[]; newVideo: boolean } | null>(null);

	/**
	 * The pictures an edit changed on the upload it keeps: a platform of the
	 * kept video whose picture is not the one the edit opened with gets the
	 * new one, or none (the platform then picks a frame).
	 */
	function imageEdits(session: EditSession, kept: Group | undefined): { fields: Parameters<typeof updateJobImages>[1]; words: string[] } {
		const fields: Parameters<typeof updateJobImages>[1] = {};
		const words: string[] = [];
		if (!kept) return { fields, words };
		const covers = coversFor(kept.platforms);
		const map = [
			['instagram', 'cover', covers.cover],
			['facebook', 'facebook_cover', covers.facebookCover],
			['tiktok', 'tiktok_cover', covers.tiktokCover]
		] as const;
		for (const [platform, field, file] of map) {
			if (!kept.platforms.includes(platform) || draft.editLock(platform)) continue;
			const opened = session.images[platform] ?? null;
			if (draft.imageFor(platform) === opened) continue;
			fields[field] = file;
			words.push(`${PLATFORMS[platform].label}: ${file ? 'cover changed' : 'cover taken off'}`);
		}
		return { fields, words };
	}

	/**
	 * Saves an edit over the upload it was opened from (uploadedit.ts). The
	 * posts are read afresh and planned against what the edit opened with;
	 * nothing is written while anything is refused. A post given another
	 * video goes out with a new upload of that video, written first, so a
	 * failure there leaves the old post where it was.
	 */
	async function saveEdit(session: EditSession) {
		phase = 'uploading';
		progress = 0;
		failure = '';
		const refuse = (why: string) => {
			failure = why;
			sending = null;
			phase = 'error';
		};
		try {
			const { job, targets } = await loadUploadState(session.job);
			if (!job) return refuse('This upload is gone — it was deleted since the edit opened.');
			const everyGroup = groupsOf(plan);
			const keptGroup = everyGroup.find((group) => group.video.kept?.job === session.job);
			const rows = editRows(plan, session.job);
			const opened = session.posts.filter((post) => !post.locked).map((post) => post.platform);
			const { steps, refused } = planEdit({ posts: targets, baseline: session.baseline, opened, rows });
			if (refused.length > 0) return refuse(`Nothing saved. ${refused.join(' ')}`);
			const newGroups = everyGroup.filter((group) => !group.video.kept && !draft.queued.includes(group.slot));
			const images = imageEdits(session, keptGroup);
			if (steps.length === 0 && newGroups.length === 0 && images.words.length === 0) {
				return refuse('Nothing changed, so there is nothing to save.');
			}

			await takenHours.refresh();
			const taken = draft.takenHold.filter((id) => rows.some((row) => row.platform === id));
			if (taken.length > 0) return refuse(`${takenWords(taken)} Not saved — move ${taken.length === 1 ? 'it' : 'them'} on the Schedule step.`);

			// Another video first: its upload carries the posts given it.
			const total = newGroups.reduce((sum, g) => sum + (g.video.file?.size ?? 0), 0);
			let sent = 0;
			for (const group of newGroups) {
				const size = group.video.file?.size ?? 0;
				await sendGroup(group, everyGroup, (fraction) => (progress = total > 0 ? (sent + fraction * size) / total : fraction));
				sent += size;
			}
			sending = null;

			const added = plan.filter((row) => steps.some((step) => step.kind === 'add' && step.platform === row.platform));
			await applyEdit(session.job, steps, added.map(targetPlan));
			await updateJobImages(session.job, images.fields);
			rememberSent();

			const lines = [
				...steps.map(stepWords),
				...images.words,
				...newGroups.map((group) => `${group.platforms.map((id) => PLATFORMS[id].label).join(', ')}: new video ${draft.slotName(group.slot)}`)
			];
			const record = keptGroup ? recordOf(keptGroup, everyGroup) : undefined;
			logAction('upload', `Edited "${session.title}"`, lines.join('; '), { job: session.job, data: record });
			edited = { title: session.title, lines, newVideo: newGroups.length > 0 };
			phase = 'done';
			void videoTodo.refresh();
		} catch (err) {
			refuse(err instanceof Error ? err.message : String(err));
		}
	}

	/** A group's record, its covers as they go out. */
	function recordOf(group: Group, everyGroup: Group[]): UploadRecord {
		const { cover, facebookCover, tiktokCover } = coversFor(group.platforms);
		return $state.snapshot(recordFor(group, everyGroup, cover, facebookCover, tiktokCover)) as UploadRecord;
	}

	async function confirm() {
		if (!armed) {
			armed = true;
			armTimer = setTimeout(() => (armed = false), 2000);
			return;
		}
		disarm();
		if (!draft.hasVideo) return;
		if (draft.editing) return saveEdit(draft.editing);

		phase = 'uploading';
		progress = 0;
		failure = '';

		// One job per distinct video, each carrying the targets it serves. The
		// worker publishes a target from its own job's file, so it needs no idea
		// that the platforms were ever split.
		const everyGroup = groupsOf(plan);
		const groups = everyGroup.filter((group) => !draft.queued.includes(group.slot));

		// The hours read afresh: another machine may have taken one since the
		// schedule step was left.
		await takenHours.refresh();
		const taken = draft.takenHold.filter((id) => groups.some((group) => group.platforms.includes(id)));
		if (taken.length > 0) {
			failure = `${takenWords(taken)} Not sent — move ${taken.length === 1 ? 'it' : 'them'} on the Schedule step.`;
			phase = 'error';
			return;
		}

		// Progress is by bytes actually transferred; a watch-folder pick sends none.
		const total = groups.reduce((sum, g) => sum + (g.video.file?.size ?? 0), 0);
		let sent = 0;
		const jobs: string[] = [];

		try {
			for (const group of groups) {
				const size = group.video.file?.size ?? 0;
				jobs.push(
					await sendGroup(group, everyGroup, (fraction) => (progress = total > 0 ? (sent + fraction * size) / total : fraction))
				);
				sent += size;
			}
			sending = null;
			rememberSent();
			phase = 'done';
			// The YouTube placeholder in To finish, now rather than on the next poll.
			void videoTodo.refresh();
			// Off the sidebar: a project is done once all of it is queued.
			if (draft.project) void projects.markUploaded(draft.project, jobs);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const queued = draft.queued;
			failure =
				queued.length > 0
					? `${message} — ${queued.length} video${queued.length === 1 ? ' is' : 's are'} already queued; confirming again sends only the rest.`
					: message;
			sending = null;
			phase = 'error';
		}
	}

	function startOver() {
		paste.cancel();
		draft.reset();
		edited = null;
		phase = 'idle';
		disarm();
		progress = 0;
	}

	/**
	 * A pasted flock block, handed over by the layout. This page decides
	 * whether the draft may take it: never while an upload is being sent or
	 * part of one is already queued, since the rest would go out with other
	 * text; after a finished one it starts a new upload first, and after one
	 * that failed with nothing written it keeps the video and clears the
	 * error. Depends on the waiting block only — taking it re-runs this once,
	 * with nothing to do.
	 */
	$effect(() => {
		if (!paste.pending) return;
		untrack(() => {
			const block = paste.take();
			if (!block) return;
			if (phase === 'uploading') {
				paste.refuse('An upload is being sent. Paste again once it has finished.');
				return;
			}
			if (draft.queued.length > 0 && phase !== 'done') {
				paste.refuse('Part of this upload is already queued. Confirm the rest or start over, then paste again.');
				return;
			}
			if (draft.editing && phase !== 'done') {
				paste.refuse('An upload is open for editing. Save it or leave the edit, then paste again.');
				return;
			}
			if (phase === 'done') startOver();
			if (phase === 'error') {
				phase = 'idle';
				failure = '';
			}
			void paste.apply(block);
		});
	});

	/**
	 * A project picked in the sidebar, handed over like a paste: refused while
	 * an upload is being sent, after a finished one a new upload starts, and
	 * otherwise it replaces the draft (the sidebar asked first when that
	 * would lose an upload belonging to no project).
	 */
	$effect(() => {
		if (!projects.pending) return;
		untrack(() => {
			const id = projects.take();
			if (!id) return;
			if (phase === 'uploading') {
				paste.refuse('An upload is being sent. Open the project once it has finished.');
				return;
			}
			if (draft.project === id && phase !== 'done') return;
			if (phase === 'done') startOver();
			if (phase === 'error') {
				phase = 'idle';
				failure = '';
			}
			void projects.enter(id);
		});
	});

	/**
	 * A queued upload to edit, from the Calendar's right-click menu
	 * (uploadedit.svelte.ts): refused while an upload is being sent, after a
	 * finished one a new start, and otherwise over the draft — the menu asked
	 * first when that would lose an upload being composed.
	 */
	$effect(() => {
		if (!uploadEdit.pending) return;
		untrack(() => {
			const job = uploadEdit.take();
			if (!job) return;
			if (phase === 'uploading') {
				paste.refuse('An upload is being sent. Open the edit once it has finished.');
				return;
			}
			if (phase === 'done') startOver();
			if (phase === 'error') {
				phase = 'idle';
				failure = '';
			}
			void uploadEdit.enter(job);
		});
	});

	/** Leaves an edit unsaved: the upload stays as it was, and the wizard is empty again. */
	function leaveEdit() {
		startOver();
	}

	/**
	 * Every change to a project's draft goes onto its row (projects store),
	 * so it can be picked up again after a restart. The snapshot reads every
	 * field it keeps, which is what makes them all dependencies; the save is
	 * read through untrack and writes nothing here.
	 */
	$effect(() => {
		const id = draft.project;
		if (!id || phase === 'done') return;
		const snapshot = draft.projectSnapshot();
		JSON.stringify(snapshot);
		const images = { thumbnail: draft.thumbnail, cover: draft.cover };
		untrack(() => projects.queueSave(id, snapshot, images));
	});

	onDestroy(() => void projects.flush());

	let project = $derived(projects.byId(draft.project));
</script>

<div class="page">
<DeviceGate what="Uploading">
		{#if phase === 'done' && edited}
			<section class="card result">
				<div class="tick">
					<svg viewBox="0 0 24 24" width="26" height="26" fill="none">
						<path
							d="M4 12.5 9.5 18 20 6.5"
							stroke="currentColor"
							stroke-width="2.4"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
				<h2>Saved</h2>
				<p class="forbrand">{edited.title}</p>
				<ul class="editlines">
					{#each edited.lines as line (line)}
						<li>{line}</li>
					{/each}
				</ul>
				{#if edited.lines.some((line) => line.includes('the worker'))}
					<p class="caveat">
						What a platform already holds changes once the worker has told it — within seconds while it runs.
						The Calendar shows the post as busy until then.
					</p>
				{/if}
				{#if edited.newVideo}
					<p class="caveat">
						The new video went in as an upload of its own. The old one stays stored on the NAS until it is deleted
						under Dashboard → Stored on the NAS.
					</p>
				{/if}
				<div class="resultbuttons">
					<a class="btn" href="{base}/calendar">Back to the Calendar</a>
					<button class="btn btn-primary" onclick={startOver}>New upload</button>
				</div>
			</section>
		{:else if phase === 'done'}
			<section class="card result">
				<div class="tick">
					<svg viewBox="0 0 24 24" width="26" height="26" fill="none">
						<path
							d="M4 12.5 9.5 18 20 6.5"
							stroke="currentColor"
							stroke-width="2.4"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</div>
				<h2>On the NAS</h2>
				{#if brands.multiple && brands.current}
					<p class="forbrand">For {brands.current.name}</p>
				{/if}
				<p>
					{draft.queued.length === 1 ? 'The video is' : `${draft.queued.length} videos are`} stored and {plan.length}
					{plan.length === 1 ? 'release is' : 'releases are'} queued. You can close this machine down —
					publishing happens from the NAS at each scheduled time.
				</p>
				<ul class="queued">
					{#each plan as row (row.platform)}
						<li>
							<PlatformIcon platform={row.platform} size={16} />
							<span>{row.relative}</span>
						</li>
					{/each}
				</ul>
				{#if plan.some((row) => row.platform === 'tiktok')}
					<!-- TikTok's guidelines ask for this notice after every post. -->
					<p class="caveat">
						After the worker posts to TikTok, it may take a few minutes for the video to be
						processed and become visible on the profile.
					</p>
				{/if}
				{#if project}
					<!-- The worker renames the project's file, so the folder is off
					     the list for good and the text stays beside the video. -->
					<p class="caveat">
						{#if project.archived_as}
							{project.manifest_name} in {project.name} is now {project.archived_as}.
						{:else if project.archived_at}
							{project.manifest_name || 'The project file'} was no longer in {project.name} to rename.
						{:else}
							The worker renames {project.manifest_name || 'flock.json'} in {project.name} to
							{uploadedName(project.manifest_name)} — kept beside the video, off the New projects list.
						{/if}
					</p>
				{/if}
				<button class="btn btn-primary" onclick={startOver}>New upload</button>
			</section>
		{:else}
			<header class="head">
				<!-- No step title: the stepper names the step. -->
				<div class="titling">
					{#if draft.editing}
						<p class="projectline editline">
							Editing <strong>{draft.editing.title}</strong>
							<span class="saved">· saved over the queued upload when confirmed</span>
							<button class="relink" onclick={leaveEdit} disabled={phase === 'uploading'}>Leave the edit</button>
						</p>
					{/if}
					{#if project}
						<p class="projectline">
							Project <strong>{project.name}</strong>
							<span class="saved">· {projects.saveError ? `not saved: ${projects.saveError}` : 'kept as you go'}</span>
						</p>
					{/if}
					<!--
						Which brand this upload is for, on every step so it is never in
						doubt. Switching keeps the video and the text and drops the
						per-platform choices (see draft.followBrand). Hidden with one brand.
					-->
					{#if brands.multiple}
						<div class="brands" role="radiogroup" aria-labelledby="brandlabel">
							<span class="brandlabel" id="brandlabel">Brand</span>
							{#each brands.ordered as brand (brand.id)}
								<button
									class="brandchip"
									class:on={brand.id === brands.currentId}
									role="radio"
									aria-checked={brand.id === brands.currentId}
									disabled={phase === 'uploading' || (Boolean(draft.editing) && brand.id !== brands.currentId)}
									title={draft.editing && brand.id !== brands.currentId
										? "An edit stays on its upload's brand; move it to another from its overview in the Log."
										: ''}
									onclick={() => brands.select(brand.id)}
								>
									{brand.name}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!--
					Which platform the Details step writes for, and which go out at
					all: one button per platform, level with the brand row.
				-->
				{#if draft.step === 1}
					<div class="switch">
						<PlatformSwitch />
					</div>
				{/if}

				<!--
					Back and forward flank the stepper on its own row, so moving through
					the wizard is one cluster rather than a header and a separate bar.
					On the confirm step the forward button is the tick that starts the
					upload: it arms on the first press and fires on a second within two
					seconds, showing "!!!" in between so the state is unmistakable.
				-->
				<nav class="progress">
					<button
						class="btn nav"
						class:ghost={draft.step === 0}
						onclick={back}
						disabled={draft.step === 0 || phase === 'uploading'}
						aria-label="Back"
						title="Back"
					>
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none">
							<path
								d="M19 12H6m5 5-5-5 5-5"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					<div class="steps">
						<Stepper step={draft.step} onjump={(index) => goto(index as Step)} />
					</div>

					{#if draft.step < 3}
						<button
							class="btn btn-primary nav"
							onclick={next}
							disabled={!canContinue}
							aria-label="Continue"
							title="Continue"
						>
							<svg viewBox="0 0 24 24" width="17" height="17" fill="none">
								<path
									d="M5 12h13m-5-5 5 5-5 5"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					{:else}
						<button
							class="btn btn-primary nav confirm"
							class:armed
							onclick={confirm}
							disabled={phase === 'uploading' || plan.length === 0 || Boolean(confirmHold)}
							aria-label={armed
								? `Click again within two seconds to ${draft.editing ? 'save' : 'upload'}`
								: draft.editing
									? 'Save the changes'
									: 'Upload and schedule'}
							title={armed
								? `Click again within two seconds to ${draft.editing ? 'save' : 'upload'}`
								: draft.editing
									? 'Save the changes'
									: 'Upload and schedule'}
						>
							{#if phase === 'uploading'}
								<span class="pct">{Math.round(progress * 100)}%</span>
							{:else if armed}
								<span class="bang">!!!</span>
							{:else}
								<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
									<path
										d="M4 12.5 9.5 18 20 6.5"
										stroke="currentColor"
										stroke-width="2.2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							{/if}
						</button>
					{/if}
				</nav>
			</header>

			{#if phase === 'error' || (draft.step === 2 && (draft.pastPlatforms.length > 0 || draft.takenHold.length > 0)) || (draft.step === 1 && missingVideo.length > 0) || (confirmHold && phase !== 'uploading')}
				<div class="notes">
					{#if confirmHold && phase !== 'uploading'}
						<span class="blocked">{confirmHold}</span>
					{/if}
					{#if phase === 'error'}
						<span class="failure">{failure}</span>
					{/if}
					{#if draft.step === 1 && missingVideo.length > 0}
						<span class="blocked">
							{missingVideo.map((id) => PLATFORMS[id].label).join(', ')}
							{missingVideo.length === 1 ? 'has' : 'have'} no video yet —
							<button class="relink" onclick={() => goto(0)}>pick one</button>.
						</span>
					{/if}
					{#if draft.step === 2 && draft.pastPlatforms.length > 0}
						<span class="blocked">
							{draft.pastPlatforms.map((id) => PLATFORMS[id].label).join(', ')}
							{draft.pastPlatforms.length === 1 ? 'is' : 'are'} scheduled in the past.
						</span>
					{/if}
					{#if draft.step === 2 && draft.takenHold.length > 0}
						<span class="blocked">
							{takenWords(draft.takenHold)} Hover a striped hour to see which, or tick Override.
						</span>
					{/if}
				</div>
			{/if}

			{#if editPreview && editPreview.lines.length > 0 && editPreview.refused.length === 0 && phase !== 'uploading'}
				<div class="editplan">
					<span class="editplanhead">Saving this edit</span>
					<ul>
						{#each editPreview.lines as line (line)}
							<li>{line}</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if settings.error}
				<p class="banner error">Could not reach PocketBase — {settings.error}</p>
			{/if}

			{#if brands.multiple && settings.withoutAccount.length > 0 && phase !== 'uploading'}
				<!-- Said, not hidden: a platform that silently vanished would look like a bug. -->
				<p class="banner">
					{settings.withoutAccount.map((id) => PLATFORMS[id].label).join(', ')}
					{settings.withoutAccount.length === 1 ? 'is' : 'are'} not offered for {brands.current?.name}:
					no account chosen for this brand.
					<a href="{base}/settings?section=brands">Choose one in Settings → Brands</a>.
				</p>
			{/if}

			{#if settings.loading}
				<p class="banner">Loading platform settings…</p>
			{:else if draft.step === 0}
				<StepUpload />
			{:else if draft.step === 1}
				<StepDetails />
			{:else if draft.step === 2}
				<StepSchedule />
			{:else}
				<StepConfirm rows={plan} />
			{/if}


			{#if phase === 'uploading'}
				<div class="uploading card">
					<div class="bar"><span style="width: {progress * 100}%"></span></div>
					{#if sending?.transfer}
						<p>
							Sending <strong>{sending.name}</strong>
							({formatBytes(sending.size)}) to the NAS — keep this tab open until it finishes.
						</p>
					{:else if sending?.local}
						<p>
							Queueing <strong>{sending.name}</strong>
							({formatBytes(sending.size)}) — the worker copies it from the local folder to the NAS.
						</p>
					{:else if sending}
						<!-- A file picked off the NAS is already there; only the job rows are
						     being written, so there is nothing to keep the tab open for. -->
						<p>
							Queueing <strong>{sending.name}</strong>
							({formatBytes(sending.size)}) — already on the NAS, so there is nothing to
							transfer.
						</p>
					{/if}
				</div>
			{/if}
		{/if}
</DeviceGate>
</div>

<style>
	/* Full width: the details step lays three columns across whatever the
	   window gives, and the layout's own 40px keeps it off the edges. */
	.page {
		max-width: none;
		margin: 0;
	}

	/* The project and brand on the left, the stepper on the right, and on
	   the Details step the platform buttons centred in the space between,
	   bottom-aligned so they sit level with the brand row. Columns are
	   placed by hand because the middle one is absent on the other steps. */
	.head {
		display: grid;
		grid-template-columns: fit-content(45%) minmax(max-content, 1fr) auto;
		align-items: end;
		min-height: 44px;
		gap: 30px;
		margin-bottom: 22px;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--border);
	}

	.titling .projectline {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.titling > * + * {
		margin-top: 10px;
	}

	.projectline strong {
		color: var(--text);
		font-weight: 600;
	}

	.saved {
		color: var(--text-faint);
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.brandlabel {
		margin-right: 4px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.brandchip {
		padding: 5px 13px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		font-size: 12px;
		font-weight: 560;
		color: var(--text-dim);
		transition: border-color 0.14s, background 0.14s, color 0.14s;
	}

	.brandchip:hover:not(:disabled) {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.brandchip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
	}

	.titling {
		grid-column: 1;
	}

	/* With no step title above, the header is as tall as the buttons; the
	   tick and gear that rise over a platform button on hover need that
	   much room above them inside the page's top padding. The same height
	   on every step, so nothing shifts between them. */
	.switch {
		grid-column: 2;
		justify-self: center;
		padding-top: 6px;
	}

	/* The arrows sit either side of the stepper with a deliberate gap, so they
	   read as "leave this step" rather than as part of the step labels. */
	.progress {
		grid-column: 3;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 22px;
	}

	.relink {
		color: inherit;
		font-size: inherit;
		text-decoration: underline;
	}

	.steps {
		width: min(460px, 40vw);
	}

	/* Square, so an arrow-only button does not read as a truncated worded one. */
	.nav {
		flex: none;
		width: 38px;
		height: 38px;
		padding: 0;
		display: grid;
		place-items: center;
	}

	/* Kept in the row rather than removed, so the stepper does not shift when
	   the back button has nowhere to go. */
	.nav.ghost {
		visibility: hidden;
		pointer-events: none;
	}

	.confirm {
		width: auto;
		min-width: 38px;
		padding: 0 10px;
	}

	.bang {
		font-weight: 800;
		letter-spacing: 0.08em;
	}

	.pct {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.banner {
		margin: 0 0 16px;
		padding: 11px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.error {
		border-color: rgba(248, 113, 113, 0.4);
		color: var(--danger);
	}

	.banner a {
		color: var(--pink-soft);
	}

	.notes {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 12px;
		margin: -12px 0 18px;
	}

	.blocked {
		font-size: 12px;
		color: var(--warn);
		text-align: right;
	}

	.failure {
		font-size: 12px;
		color: var(--danger);
		max-width: 460px;
	}

	.confirm.armed {
		background: var(--pink-hot);
		box-shadow: 0 0 0 3px rgba(255, 46, 138, 0.25);
	}

	.uploading {
		margin-top: 16px;
		padding: 14px 16px;
	}

	.bar {
		height: 6px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--accent-grad);
		transition: width 0.2s ease;
	}

	.uploading p {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.result {
		max-width: 520px;
		margin: 40px auto;
		padding: 34px 30px;
		text-align: center;
	}

	.tick {
		width: 54px;
		height: 54px;
		margin: 0 auto 16px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent-grad);
		color: #fff;
	}

	.result h2 {
		font-size: 19px;
	}

	.result p {
		margin: 8px 0 0;
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.6;
	}

	.queued {
		list-style: none;
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 7px;
		margin: 20px 0 0;
		padding: 0;
	}

	.queued li {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 11px;
		border-radius: 999px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.result .forbrand {
		margin-top: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--pink-soft);
	}

	.caveat {
		font-size: 11.5px !important;
		color: var(--text-faint) !important;
		margin-top: 18px !important;
	}

	.result .btn {
		margin-top: 20px;
	}

	/* What an edit changed, one line a post. */
	.editlines {
		list-style: none;
		display: grid;
		gap: 5px;
		margin: 18px 0 0;
		padding: 0;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	/* On an edit's Review step: what saving it will do, post by post. */
	.editplan {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 14px;
		margin: -8px 0 16px;
		padding: 9px 13px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--accent-grad-soft);
		font-size: 12px;
		color: var(--text-dim);
	}

	.editplanhead {
		font-weight: 600;
		color: var(--text);
	}

	.editplan ul {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.resultbuttons {
		display: flex;
		justify-content: center;
		gap: 10px;
	}

	.editline strong {
		color: var(--pink-soft);
	}

	.editline .relink {
		margin-left: 6px;
	}

	@media (max-width: 1100px) {
		.head {
			grid-template-columns: 1fr;
			align-items: stretch;
			gap: 18px;
		}
		.titling,
		.switch,
		.progress {
			grid-column: 1;
		}
		/* Room for the tick and gear that appear above a button on hover. */
		.switch {
			margin-top: 32px;
		}
	}

	@media (max-width: 860px) {
		.progress {
			width: 100%;
			gap: 14px;
		}
		.steps {
			flex: 1;
			width: auto;
		}
	}
</style>
