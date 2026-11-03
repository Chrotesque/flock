import { currentUserId } from '../log';

/**
 * This browser's profile (users.ts), as reactive state.
 *
 * localStorage is not reactive, so a plain `currentUserId()` call only
 * re-evaluates when something else happens to invalidate — which once left the
 * sidebar warning up after the gate was passed until the next navigation.
 * Anything that reflects it reads this instead.
 */
class DeviceState {
	/** The profile's id, '' while the browser has none. */
	user = $state(currentUserId());

	/** Has a profile: what every page waits for. */
	get ready(): boolean {
		return Boolean(this.user);
	}

	refresh() {
		this.user = currentUserId();
	}
}

export const device = new DeviceState();
