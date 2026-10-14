import { general } from './general.svelte';
import { BUILT_IN_ZONES, isValidZone, type TimeZoneChoice } from '../timezones';

/**
 * The second clock in the week grid's time column, chosen per browser.
 *
 * A store rather than the grid's own state because the schedule step shows
 * fewer days while one is chosen — its clock widens the time column — and so
 * has to know about it before the grid is drawn.
 */
const KEY = 'flock.calendar.zone';

function read(): string {
	try {
		return localStorage.getItem(KEY) ?? '';
	} catch {
		return '';
	}
}

class CalendarZone {
	id = $state(read());

	/** Built-ins first, then whatever Settings adds that the runtime knows. */
	choices: TimeZoneChoice[] = $derived([
		...BUILT_IN_ZONES,
		...general.value.timeZones.filter((z) => z.label.trim() && isValidZone(z.zone))
	]);

	/** The zone shown, or null for none — also when the stored one was removed. */
	zone: TimeZoneChoice | null = $derived(this.choices.find((z) => z.id === this.id) ?? null);

	set(id: string) {
		this.id = id;
		try {
			localStorage.setItem(KEY, id);
		} catch {
			// The choice just will not survive a reload.
		}
	}
}

export const calendarZone = new CalendarZone();
