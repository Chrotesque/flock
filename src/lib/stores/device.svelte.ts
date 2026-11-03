import { currentUserId, isDeviceNamed } from '../log';

/**
 * Whether this browser has been named, and whose it is, as reactive state.
 *
 * localStorage is not reactive, so a plain `isDeviceNamed()` call only
 * re-evaluates when something else happens to invalidate — which left the
 * sidebar warning up after the name was set until the next navigation. Anything
 * that reflects the named state reads this instead.
 */
class DeviceState {
	named = $state(isDeviceNamed());
	/** The user's id (users.ts), '' while the browser has none. */
	user = $state(currentUserId());

	/** Named and someone's: what every page waits for. */
	get ready(): boolean {
		return this.named && Boolean(this.user);
	}

	refresh() {
		this.named = isDeviceNamed();
		this.user = currentUserId();
	}
}

export const device = new DeviceState();
