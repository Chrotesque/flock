import { PLATFORM_IDS } from '../platforms';
import { isoDate } from '../format';
import type { OptionValues, PlatformId } from '../types';

export type Step = 0 | 1 | 2;
export const STEP_LABELS = ['Details', 'Schedule', 'Confirm'] as const;

function allSelected(value: boolean): Record<PlatformId, boolean> {
	return Object.fromEntries(PLATFORM_IDS.map((id) => [id, value])) as Record<PlatformId, boolean>;
}

function defaultDate(): string {
	// Tomorrow, so a schedule is never accidentally in the past.
	const d = new Date();
	d.setDate(d.getDate() + 1);
	return isoDate(d);
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

	get activePlatforms(): PlatformId[] {
		return PLATFORM_IDS.filter((id) => this.selected[id]);
	}

	scheduleFor(platform: PlatformId): { date: string; time: string } {
		return this.schedule[platform] ?? { date: defaultDate(), time: '09:00' };
	}

	setSchedule(platform: PlatformId, value: Partial<{ date: string; time: string }>) {
		this.schedule[platform] = { ...this.scheduleFor(platform), ...value };
	}

	/** True once every selected platform has a date and a time. */
	get scheduleComplete(): boolean {
		return this.activePlatforms.every((id) => {
			const entry = this.schedule[id];
			return Boolean(entry?.date && entry?.time);
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
	}
}

export const draft = new DraftStore();
export { defaultDate };
