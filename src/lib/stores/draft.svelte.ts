import { PLATFORMS, PLATFORM_IDS } from '../platforms';
import { isoDate, nextDayMatching } from '../format';
import { tiktokProblems } from '../tiktok';
import { PASTE_TAG_BOX, type FlockPaste, type PastedPlatform } from '../flockpaste';
import { withPlaylists } from '../playlists';
import { SAVED_VERSION, withoutHandPicked, type SavedDraft } from '../projects';
import { imageSlot, type ImagePlatform } from '../coverimage';
import { settings } from './settings.svelte';
import { accounts } from './accounts.svelte';
import { DEFAULT_SCHEDULING } from '../types';
import type {
	OptionValues,
	PlatformId,
	PlatformText,
	SchedulingProfile,
	WatchFile
} from '../types';

export type Step = 0 | 1 | 2 | 3;
export const STEP_LABELS = ['Upload', 'Details', 'Schedule', 'Review'] as const;

/**
 * Which video a platform gets: the shared one, or one of its own. A platform
 * split off keeps its slot until it is merged back, and the split itself is
 * remembered per browser from one upload to the next.
 */
export type VideoSlot = 'all' | PlatformId;

export interface SlotVideo {
	file: File | null;
	/**
	 * A video picked out of the watch folder rather than uploaded through the
	 * browser. Mutually exclusive with `file`: choosing either clears the other,
	 * so there is never a question of which one the job gets built from.
	 */
	nasFile: WatchFile | null;
	duration: number;
}

const SPLIT_KEY = 'flock.upload.split';

function loadSplit(): PlatformId[] {
	try {
		const raw = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? '[]');
		return Array.isArray(raw) ? raw.filter((id) => PLATFORM_IDS.includes(id)) : [];
	} catch {
		return [];
	}
}

function saveSplit(list: PlatformId[]) {
	try {
		localStorage.setItem(SPLIT_KEY, JSON.stringify(list));
	} catch {
		// Private windows and blocked site data throw; the split just is not kept.
	}
}

function emptyVideos(): Record<VideoSlot, SlotVideo> {
	return Object.fromEntries(
		(['all', ...PLATFORM_IDS] as VideoSlot[]).map((slot) => [
			slot,
			{ file: null, nasFile: null, duration: 0 }
		])
	) as Record<VideoSlot, SlotVideo>;
}

const EMPTY_TEXT: PlatformText = { title: '', description: '' };

/** Tomorrow, so a schedule is never accidentally in the past. */
function tomorrow(): Date {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	return d;
}

/**
 * The compose wizard's working state. In memory only — nothing reaches
 * PocketBase until the final confirmation, so an abandoned draft leaves no
 * half-finished job rows behind.
 */
class DraftStore {
	step = $state<Step>(0);

	/**
	 * The `projects` row this upload belongs to, when it was opened from the
	 * sidebar; everything below is then kept on that row as it changes (see
	 * stores/projects.svelte.ts). `projectBase` is the project file's
	 * `manifest_modified` when its text went in, so a newer file can be
	 * offered again.
	 */
	project = $state<string | null>(null);
	projectBase = $state('');

	/**
	 * Slots already written by a confirm that failed part-way. Confirming
	 * again sends only the rest, so a failure on the second video never
	 * queues the first one twice. Kept on a project row too, so a resume
	 * after a restart does not either.
	 */
	queued = $state<VideoSlot[]>([]);

	/**
	 * Text composed per platform. There is no shared title/description pair:
	 * every platform is written for on its own, and the adaptation rules run
	 * over whatever was typed for it.
	 */
	texts = $state<Partial<Record<PlatformId, PlatformText>>>({});

	/** Which platform the details step is currently composing. */
	composing = $state<PlatformId | null>(null);

	/**
	 * One entry per possible slot, all present from the start so the pickers
	 * can bind straight into them. Only the slots `slots` lists are used.
	 */
	videos = $state<Record<VideoSlot, SlotVideo>>(emptyVideos());

	/**
	 * Platforms that get a video of their own rather than the shared one —
	 * remembered per browser when changed by hand (`setSplit`). A project
	 * sets it for its own upload only (`useOwnSplit`), and a reset brings the
	 * remembered one back.
	 */
	split = $state<PlatformId[]>(loadSplit());

	/**
	 * The custom image: the reel cover for Instagram and Facebook (see
	 * coverimage.ts), still named `thumbnail` because the paste format and
	 * saved drafts call it so. Optional; without one each uses a frame.
	 * TikTok has no picture of its own: it takes Instagram's or Facebook's
	 * (`imageSlot`). YouTube's thumbnail was dropped in v0.11.7.
	 *
	 * Linked (the default), all of them get `thumbnail`. Unlinked, Instagram
	 * gets `cover` and Facebook keeps `thumbnail`.
	 */
	thumbnail = $state<File | null>(null);
	cover = $state<File | null>(null);
	imagesLinked = $state(true);

	/** The image a platform gets, linked or not. */
	imageFor(platform: ImagePlatform): File | null {
		return this[imageSlot(platform, this.imagesLinked, this.activePlatforms)];
	}

	/**
	 * Unlinking starts the cover as the same picture, so nothing chosen is
	 * lost; relinking keeps the picture of the platform in view, or whichever
	 * one exists.
	 */
	linkImages(linked: boolean) {
		if (linked === this.imagesLinked) return;
		if (linked) {
			const keep =
				this.composing === 'instagram' ? (this.cover ?? this.thumbnail) : (this.thumbnail ?? this.cover);
			this.thumbnail = keep;
			this.cover = null;
		} else {
			this.cover = this.thumbnail;
		}
		this.imagesLinked = linked;
	}

	slotFor(platform: PlatformId): VideoSlot {
		return this.split.includes(platform) ? platform : 'all';
	}

	videoFor(platform: PlatformId): SlotVideo {
		return this.videos[this.slotFor(platform)];
	}

	/** This upload's split, leaving the browser's remembered one alone. */
	useOwnSplit(list: PlatformId[]) {
		this.split = [...list];
	}

	setSplit(platform: PlatformId, own: boolean) {
		const next = own
			? [...new Set([...this.split, platform])]
			: this.split.filter((id) => id !== platform);
		this.split = next;
		saveSplit(next);
	}

	/**
	 * The videos this upload needs, each with the active platforms it serves,
	 * in the display order from Settings: a slot sits where its first platform
	 * does, so the shared one moves down when the platform above it is split
	 * off. The shared slot is omitted once every platform has its own.
	 */
	get slots(): { slot: VideoSlot; platforms: PlatformId[] }[] {
		const active = this.activePlatforms;
		const shared = active.filter((id) => !this.split.includes(id));
		const out: { slot: VideoSlot; platforms: PlatformId[] }[] = [];
		for (const id of active) {
			if (this.split.includes(id)) out.push({ slot: id, platforms: [id] });
			else if (id === shared[0]) out.push({ slot: 'all', platforms: shared });
		}
		return out;
	}

	/** Either route counts — the wizard does not care which one was used. */
	slotHasVideo(slot: VideoSlot): boolean {
		const video = this.videos[slot];
		return Boolean(video.file || video.nasFile);
	}

	/** The name to show for whichever video a slot holds. */
	slotName(slot: VideoSlot): string {
		const video = this.videos[slot];
		return video.file?.name ?? video.nasFile?.name ?? '';
	}

	/** Every slot in use has a video. */
	get hasVideo(): boolean {
		const slots = this.slots;
		return slots.length > 0 && slots.every((entry) => this.slotHasVideo(entry.slot));
	}

	/**
	 * Slots whose video the Review stage has shown. TikTok's guidelines want
	 * the post previewed before it is sent, so confirm waits for TikTok's;
	 * picking another video for a slot asks for a new look.
	 */
	previewed = $state<Partial<Record<VideoSlot, boolean>>>({});

	/** The stage showed a slot's video; its length, when unknown till now, comes with it. */
	markPreviewed(slot: VideoSlot, seconds: number) {
		this.previewed[slot] = true;
		const video = this.videos[slot];
		if (!video.duration && Number.isFinite(seconds) && seconds > 0) video.duration = seconds;
	}

	chooseFile(slot: VideoSlot, file: File | null) {
		const video = this.videos[slot];
		video.file = file;
		if (file) video.nasFile = null;
		this.previewed[slot] = false;
	}

	chooseNasFile(slot: VideoSlot, entry: WatchFile | null) {
		const video = this.videos[slot];
		video.nasFile = entry;
		this.previewed[slot] = false;
		if (entry) {
			video.file = null;
			// A referenced file has no bytes here to read a duration out of.
			video.duration = 0;
		}
	}

	/**
	 * Ticks made on this upload. A platform not ticked or unticked here starts
	 * as Settings has it (`enabled`), so `isSelected` is what to read.
	 */
	selected = $state<Partial<Record<PlatformId, boolean>>>({});

	isSelected(platform: PlatformId): boolean {
		return this.selected[platform] ?? settings.get(platform)?.enabled ?? false;
	}

	select(platform: PlatformId, on: boolean) {
		this.selected[platform] = on;
	}

	/** Per-platform overrides layered on top of that platform's saved defaults. */
	overrides = $state<Partial<Record<PlatformId, OptionValues>>>({});
	schedule = $state<Partial<Record<PlatformId, { date: string; time: string }>>>({});

	/**
	 * Platforms to publish the moment the worker sees them, rather than at a
	 * slot. Nothing in the worker had to change for this: it only hands a
	 * release time to the platform when that time is in the *future*, so a slot
	 * of "now" already falls through to an immediate upload at the requested
	 * visibility.
	 */
	immediate = $state<Partial<Record<PlatformId, boolean>>>({});

	isImmediate(platform: PlatformId): boolean {
		return this.immediate[platform] === true;
	}

	setImmediate(platform: PlatformId, on: boolean) {
		this.immediate[platform] = on;
	}

	textFor(platform: PlatformId): PlatformText {
		return this.texts[platform] ?? EMPTY_TEXT;
	}

	setText(platform: PlatformId, field: keyof PlatformText, value: string) {
		this.texts[platform] = { ...this.textFor(platform), [field]: value };
	}

	/**
	 * A platform is composed once it has a description — plus a title, but only
	 * if it is a platform that takes one. Requiring a title from Instagram or
	 * TikTok would make Continue unreachable, since neither renders the field.
	 * TikTok additionally has to pass its posting rules (see `tiktokProblems`):
	 * an audience chosen by hand, a disclosure that says what kind, nothing
	 * TikTok itself would refuse.
	 */
	isComplete(platform: PlatformId): boolean {
		const text = this.textFor(platform);
		if (!text.description.trim()) return false;
		if (platform === 'tiktok' && this.tiktokProblems.length > 0) return false;
		return PLATFORMS[platform].hasTitle ? Boolean(text.title.trim()) : true;
	}

	/**
	 * What still stops a TikTok post, in the words the compose box shows. The
	 * audience list comes from the worker's creator row, which is why this
	 * reads the accounts store — the draft reads from stores, never back.
	 */
	get tiktokProblems(): string[] {
		return tiktokProblems(this.overrides.tiktok ?? {}, accounts.tiktok, this.videoFor('tiktok').duration);
	}

	/**
	 * Stand-in text for the job row itself, which has one title/description pair
	 * and no platform, over the platforms that job serves (one job per distinct
	 * video). The description comes from the first of them; the title from the
	 * first that actually has one, so a job going only to the caption-only
	 * platforms still gets a readable label instead of "(untitled)".
	 *
	 * This is a label, not published text — the real per-platform content is
	 * written to upload_targets.
	 */
	labelFor(platforms: PlatformId[]): PlatformText {
		const first = platforms[0];
		if (!first) return EMPTY_TEXT;
		const titled = platforms.find((id) => this.textFor(id).title.trim());
		return {
			title: titled ? this.textFor(titled).title : '',
			description: this.textFor(first).description
		};
	}

	/**
	 * Platforms this upload will actually go to: ticked (or, untouched, enabled
	 * in Settings) *and* offered to the brand. A platform that loses its
	 * account drops out of an in-progress draft too, not just the next one.
	 *
	 * Returned in the user's configured display order, which is what makes the
	 * compose pills, the schedule list and the confirmation list agree.
	 */
	get activePlatforms(): PlatformId[] {
		return settings.available
			.filter((entry) => this.isSelected(entry.platform))
			.map((entry) => entry.platform);
	}

	/** The profile chosen for a platform on this upload, in profiles mode. */
	profile = $state<Partial<Record<PlatformId, string>>>({});

	profileFor(platform: PlatformId): SchedulingProfile | null {
		const config = settings.schedulingFor(platform);
		if (config.mode !== 'profiles' || config.profiles.length === 0) return null;
		const chosen = config.profiles.find((p) => p.id === this.profile[platform]);
		return chosen ?? config.profiles[0];
	}

	/**
	 * What a platform's schedule starts at before the user touches it: its own
	 * default time, or the time and next matching day from the profile picked
	 * for this upload.
	 */
	suggestedScheduleFor(platform: PlatformId): { date: string; time: string } {
		const config = settings.schedulingFor(platform);
		const profile = this.profileFor(platform);

		const time =
			profile && profile.useTime ? profile.time : config.defaultTime || DEFAULT_SCHEDULING.defaultTime;

		const from = tomorrow();
		const date =
			profile && profile.useDays && profile.days.length > 0
				? isoDate(nextDayMatching(from, profile.days))
				: isoDate(from);

		return { date, time };
	}

	scheduleFor(platform: PlatformId): { date: string; time: string } {
		return this.schedule[platform] ?? this.suggestedScheduleFor(platform);
	}

	/** Switches profile and re-applies its day/time over whatever was there. */
	applyProfile(platform: PlatformId, profileId: string) {
		this.profile[platform] = profileId;
		this.schedule[platform] = this.suggestedScheduleFor(platform);
	}

	setSchedule(platform: PlatformId, value: Partial<{ date: string; time: string }>) {
		this.schedule[platform] = { ...this.scheduleFor(platform), ...value };
	}

	/**
	 * Platforms whose slot is already in the past. Compared against the actual
	 * instant, not the date, so earlier today counts.
	 */
	get pastPlatforms(): PlatformId[] {
		const now = Date.now();
		return this.activePlatforms.filter((id) => {
			if (this.isImmediate(id)) return false;
			const entry = this.scheduleFor(id);
			const at = new Date(`${entry.date}T${entry.time || '00:00'}`).getTime();
			return Number.isFinite(at) && at < now;
		});
	}

	/**
	 * True once every selected platform resolves to a date and a time.
	 *
	 * Reads through `scheduleFor`, not the `schedule` map: an untouched platform
	 * has no entry there and falls back to its suggestion, which is what the
	 * confirmation screen and `createJob` already publish. Reading the raw map
	 * meant nothing counted as scheduled until the user nudged a control, which
	 * left Continue permanently disabled.
	 */
	get scheduleComplete(): boolean {
		return this.activePlatforms.every((id) => {
			if (this.isImmediate(id)) return true;
			const entry = this.scheduleFor(id);
			return Boolean(entry.date && entry.time);
		});
	}

	/** A video for every slot the active platforms need. */
	get canLeaveUpload(): boolean {
		return this.activePlatforms.length > 0 && this.hasVideo;
	}

	/** Every active platform composed. */
	get canLeaveDetails(): boolean {
		const active = this.activePlatforms;
		return active.length > 0 && active.every((id) => this.isComplete(id));
	}

	/** Active platforms still missing text, for the "why is Continue off" hint. */
	get incompletePlatforms(): PlatformId[] {
		return this.activePlatforms.filter((id) => !this.isComplete(id));
	}

	/**
	 * Fills the draft from a pasted flock block (flockpaste.ts). Each platform
	 * it names is ticked and takes what it carries — text, its release slot
	 * (or "now"), and for YouTube the tags into one box and the playlists —
	 * over whatever was there. A slot is set like a hand-picked one, so the
	 * Schedule step shows it and a profile does not move it. What the
	 * block leaves out stays as it was, other platforms included: unticking
	 * one silently could drop a platform from the upload, where one left
	 * ticked shows its yellow ! until it is written for.
	 */
	applyPaste(platforms: FlockPaste['platforms']) {
		const named = Object.entries(platforms) as [PlatformId, PastedPlatform][];
		for (const [id, entry] of named) {
			this.selected[id] = true;
			const text = this.textFor(id);
			this.texts[id] = {
				title: entry.title ?? text.title,
				description: entry.description ?? text.description
			};
			const options: OptionValues = {};
			if (entry.tags) options[PASTE_TAG_BOX] = entry.tags;
			if (Object.keys(options).length > 0 || entry.playlists !== undefined) {
				const merged = { ...(this.overrides[id] ?? {}), ...options };
				this.overrides[id] = entry.playlists !== undefined ? withPlaylists(merged, entry.playlists) : merged;
			}
			if (entry.schedule === 'now') {
				this.immediate[id] = true;
			} else if (entry.schedule) {
				this.immediate[id] = false;
				this.schedule[id] = { ...entry.schedule };
			}
		}
		if (named.length > 0) this.composing = named[0][0];
	}

	/**
	 * The brand the per-platform choices above were made for. State, so a
	 * project's saved draft follows a brand switch that changed nothing else.
	 */
	#brand = $state('');

	/** Anything typed or picked that starting over would lose. */
	get hasContent(): boolean {
		return (
			Object.values(this.texts).some((t) => Boolean(t && (t.title.trim() || t.description.trim()))) ||
			Object.values(this.videos).some((v) => Boolean(v.file || v.nasFile)) ||
			Boolean(this.thumbnail || this.cover)
		);
	}

	/**
	 * The draft as a project row keeps it (projects.ts). Reads every field
	 * it saves, so an effect that serialises this re-runs on any change.
	 * Videos chosen in the browser have no path to keep, and TikTok's
	 * hand-picked choices are left out on purpose (HAND_PICKED).
	 */
	projectSnapshot(): SavedDraft {
		const { overrides, dropped } = withoutHandPicked(this.overrides);
		// Only the slots in use: a pick left in a slot merged back is not kept.
		const videos: SavedDraft['videos'] = {};
		for (const { slot } of this.slots) {
			const file = this.videos[slot].nasFile;
			if (file) videos[slot] = file;
		}
		return {
			v: SAVED_VERSION,
			base: this.projectBase,
			brand: this.#brand,
			step: this.step,
			composing: this.composing,
			texts: this.texts,
			selected: this.selected,
			overrides,
			schedule: this.schedule,
			immediate: this.immediate,
			profile: this.profile,
			split: this.split,
			videos,
			imagesLinked: this.imagesLinked,
			thumbnailName: this.thumbnail?.name ?? '',
			coverName: this.cover?.name ?? '',
			queued: this.queued,
			repick: dropped
		};
	}

	/**
	 * Puts a saved draft back, on a draft just reset. The brand is the
	 * caller's to select and `followBrand` first, as for a paste; the images
	 * come from the row's files. The step is the one it was left on, or the
	 * furthest one before it that can still be reached — a choice left out of
	 * the save (TikTok's) sends it back to Details.
	 */
	restoreSaved(saved: SavedDraft) {
		this.texts = saved.texts;
		this.selected = saved.selected;
		this.overrides = saved.overrides;
		this.schedule = saved.schedule;
		this.immediate = saved.immediate;
		this.profile = saved.profile;
		this.useOwnSplit(saved.split);
		const videos = emptyVideos();
		for (const [slot, file] of Object.entries(saved.videos) as [VideoSlot, WatchFile][]) {
			videos[slot].nasFile = file;
		}
		this.videos = videos;
		this.previewed = {};
		this.imagesLinked = saved.imagesLinked;
		this.queued = saved.queued;
		this.composing = saved.composing;
		this.projectBase = saved.base;
		this.step = this.reachable(saved.step);
	}

	/** The furthest step up to `wanted` whose way in is open. */
	reachable(wanted: Step): Step {
		if (wanted >= 1 && !this.canLeaveUpload) return 0;
		if (wanted >= 2 && !(this.canLeaveDetails && this.hasVideo)) return 1;
		if (wanted >= 3 && !(this.scheduleComplete && this.pastPlatforms.length === 0)) return 2;
		return wanted;
	}

	/**
	 * Called with the brand in view whenever it may have changed. Switching
	 * brand keeps the video and the text but drops every per-platform choice:
	 * options, schedule and profile all start from the old brand's settings,
	 * and TikTok's choices belong to the old brand's account. The draft is
	 * told rather than reading the brands store, so it still only reads from
	 * the stores it builds on.
	 */
	followBrand(brandId: string) {
		if (this.#brand && brandId && this.#brand !== brandId) {
			this.overrides = {};
			this.schedule = {};
			this.immediate = {};
			this.profile = {};
		}
		if (brandId) this.#brand = brandId;
	}

	reset() {
		this.step = 0;
		this.project = null;
		this.projectBase = '';
		this.queued = [];
		this.texts = {};
		this.composing = null;
		// The split is the arrangement, not this video: the remembered one
		// comes back, whatever a project used.
		this.split = loadSplit();
		this.videos = emptyVideos();
		this.previewed = {};
		this.thumbnail = null;
		this.cover = null;
		this.imagesLinked = true;
		this.selected = {};
		this.overrides = {};
		this.schedule = {};
		this.immediate = {};
		this.profile = {};
	}
}

export const draft = new DraftStore();
