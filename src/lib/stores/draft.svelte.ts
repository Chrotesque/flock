import { PLATFORM_IDS } from '../platforms';
import { isoDate, nextDayMatching } from '../format';
import { settings } from './settings.svelte';
import { DEFAULT_SCHEDULING } from '../types';
import type { OptionValues, PlatformId, SchedulingProfile } from '../types';

export type Step = 0 | 1 | 2;
export const STEP_LABELS = ['Details', 'Schedule', 'Confirm'] as const;

function allSelected(value: boolean): Record<PlatformId, boolean> {
	return Object.fromEntries(PLATFORM_IDS.map((id) => [id, value])) as Record<PlatformId, boolean>;
}

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

	title = $state('');
	description = $state('');
	file = $state<File | null>(null);
	duration = $state(0);

	selected = $state<Record<PlatformId, boolean>>(allSelected(true));
	/** Per-platform overrides layered on top of that platform's saved defaults. */
	overrides = $state<Partial<Record<PlatformId, OptionValues>>>({});
	schedule = $state<Partial<Record<PlatformId, { date: string; time: string }>>>({});

	/**
	 * Platforms this upload will actually go to: ticked on this upload *and*
	 * still enabled in Settings. Disabling a platform there must drop it from an
	 * in-progress draft too, not just from the next one.
	 *
	 * Returned in the user's configured display order, which is what makes the
	 * schedule list and the confirmation list agree with the compose rail.
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

	get canLeaveDetails(): boolean {
		return Boolean(this.title.trim() && this.file && this.activePlatforms.length > 0);
	}

	reset() {
		this.step = 0;
		this.title = '';
		this.description = '';
		this.file = null;
		this.duration = 0;
		this.selected = allSelected(true);
		this.overrides = {};
		this.schedule = {};
		this.profile = {};
	}
}

export const draft = new DraftStore();
