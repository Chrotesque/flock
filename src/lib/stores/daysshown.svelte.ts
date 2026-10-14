import { calendarZone } from './calendarzone.svelte';

/**
 * How many days a week grid shows, chosen per browser and per screen (the
 * schedule step and the Calendar each keep their own): 7 to 14, 14 to begin
 * with. With a second time zone shown at most 12, since its clock widens the
 * time column; the choice is kept and comes back once the zone is gone.
 */
export const DAY_CHOICES = Array.from({ length: 8 }, (_, i) => i + 7);
const MAX_DAYS = 14;
const MAX_DAYS_ZONED = 12;

function read(key: string): number {
	try {
		const n = Number(localStorage.getItem(key));
		return DAY_CHOICES.includes(n) ? n : MAX_DAYS;
	} catch {
		return MAX_DAYS;
	}
}

export class DaysShown {
	readonly #key: string;
	chosen = $state(MAX_DAYS);

	constructor(key: string) {
		this.#key = key;
		this.chosen = read(key);
	}

	max = $derived(calendarZone.zone ? MAX_DAYS_ZONED : MAX_DAYS);
	shown = $derived(Math.min(this.chosen, this.max));
	choices = $derived(DAY_CHOICES.filter((n) => n <= this.max));

	set(n: number) {
		this.chosen = n;
		try {
			localStorage.setItem(this.#key, String(n));
		} catch {
			// Private windows and blocked site data throw; it is just not kept.
		}
	}
}
