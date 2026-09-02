import { PLATFORMS, PLATFORM_IDS } from '../platforms';
import { isoDate, nextDayMatching } from '../format';
import { settings } from './settings.svelte';
import { DEFAULT_SCHEDULING } from '../types';
import type { OptionValues, PlatformId, PlatformText, SchedulingProfile } from '../types';

export type Step = 0 | 1 | 2;
export const STEP_LABELS = ['Details', 'Schedule', 'Confirm'] as const;

function allSelected(value: boolean): Record<PlatformId, boolean> {
	return Object.fromEntries(PLATFORM_IDS.map((id) => [id, value])) as Record<PlatformId, boolean>;
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
	 * Text composed per platform. There is no shared title/description pair:
	 * every platform is written for on its own, and the adaptation rules run
	 * over whatever was typed for it.
	 */
	texts = $state<Partial<Record<PlatformId, PlatformText>>>({});

	/** Which platform the details step is currently composing. */
	composing = $state<PlatformId | null>(null);

	file = $state<File | null>(null);
	duration = $state(0);

	selected = $state<Record<PlatformId, boolean>>(allSelected(true));
	/** Per-platform overrides layered on top of that platform's saved defaults. */
	overrides = $state<Partial<Record<PlatformId, OptionValues>>>({});
	schedule = $state<Partial<Record<PlatformId, { date: string; time: string }>>>({});

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
	 */
	isComplete(platform: PlatformId): boolean {
		const text = this.textFor(platform);
		if (!text.description.trim()) return false;
		return PLATFORMS[platform].hasTitle ? Boolean(text.title.trim()) : true;
	}

	/**
	 * Stand-in text for the job row itself, which has one title/description pair
	 * and no platform. The description comes from the first active platform; the
	 * title from the first that actually has one, so a job going only to the
	 * caption-only platforms still gets a readable label instead of "(untitled)".
	 *
	 * This is a label, not published text — the real per-platform content is
	 * written to upload_targets.
	 */
	get primaryText(): PlatformText {
		const active = this.activePlatforms;
		const first = active[0];
		if (!first) return EMPTY_TEXT;
		const titled = active.find((id) => this.textFor(id).title.trim());
		return {
			title: titled ? this.textFor(titled).title : '',
			description: this.textFor(first).description
		};
	}

	/**
	 * Platforms this upload will actually go to: ticked on this upload *and*
	 * still enabled in Settings. Disabling a platform there must drop it from an
	 * in-progress draft too, not just from the next one.
	 *
	 * Returned in the user's configured display order, which is what makes the
	 * compose pills, the schedule list and the confirmation list agree.
	 */
	get activePlatforms(): PlatformId[] {
		return settings.available
			.filter((entry) => this.selected[entry.platform])
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
			const entry = this.scheduleFor(id);
			return Boolean(entry.date && entry.time);
		});
	}

	/** Every active platform composed, and a file chosen. */
	get canLeaveDetails(): boolean {
		const active = this.activePlatforms;
		return Boolean(this.file) && active.length > 0 && active.every((id) => this.isComplete(id));
	}

	/** Active platforms still missing text, for the "why is Continue off" hint. */
	get incompletePlatforms(): PlatformId[] {
		return this.activePlatforms.filter((id) => !this.isComplete(id));
	}

	reset() {
		this.step = 0;
		this.texts = {};
		this.composing = null;
		this.file = null;
		this.duration = 0;
		this.selected = allSelected(true);
		this.overrides = {};
		this.schedule = {};
		this.profile = {};
	}
}

export const draft = new DraftStore();
