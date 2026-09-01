import { isDeviceNamed } from '../log';

/**
 * Whether this browser has been named, as reactive state.
 *
 * localStorage is not reactive, so a plain `isDeviceNamed()` call only
 * re-evaluates when something else happens to invalidate — which left the
 * sidebar warning up after the name was set until the next navigation. Anything
 * that reflects the named state reads this instead.
 */
class DeviceState {
	named = $state(isDeviceNamed());

	refresh() {
		this.named = isDeviceNamed();
	}
}

export const device = new DeviceState();
