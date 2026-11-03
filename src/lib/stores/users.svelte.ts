import { assignDeviceUser, createUser, currentUserId, deviceName, logAction, rememberUser } from '../log';
import { copyUserSettings, deleteUser, listDevices, listUsers, subscribeUsers } from '../repo';
import { userLines, userOfDevice, type DeviceRow, type User } from '../users';
import { device } from './device.svelte';
import { general } from './general.svelte';
import { hiddenVideos } from './hiddenvideos.svelte';

/**
 * The users (users.ts) and their browsers, live, and whose this browser is.
 * The device row's `user` decides that; each load writes it into the
 * browser's own copy (`flock.user`), so a user deleted from another browser
 * puts this one back behind the gate.
 */
class UsersStore {
	list = $state<User[]>([]);
	devices = $state<DeviceRow[]>([]);
	loaded = $state(false);
	error = $state('');

	#started = 0;
	#stop: (() => void) | null = null;
	#reading: Promise<void> | null = null;
	#again = false;

	/** This browser's user, while it has one. */
	get current(): User | null {
		return this.list.find((u) => u.id === device.user) ?? null;
	}

	get lines() {
		return userLines(this.list, this.devices, device.user);
	}

	/** Reads both lists; a read asked for mid-read runs once more after. */
	async load(): Promise<void> {
		if (this.#reading) {
			this.#again = true;
			return this.#reading;
		}
		this.#reading = (async () => {
			do {
				this.#again = false;
				try {
					const [users, devices] = await Promise.all([listUsers(), listDevices()]);
					this.list = users;
					this.devices = devices;
					this.loaded = true;
					this.error = '';
					this.#follow();
				} catch (err) {
					this.error = err instanceof Error ? err.message : String(err);
				}
			} while (this.#again);
		})();
		try {
			await this.#reading;
		} finally {
			this.#reading = null;
		}
	}

	/** Loads and follows the lists while anything needs them. Returns the stop. */
	start(): () => void {
		this.#started += 1;
		if (this.#started === 1) {
			void this.load();
			this.#stop = subscribeUsers(() => void this.load());
		}
		return () => {
			this.#started -= 1;
			if (this.#started === 0) {
				this.#stop?.();
				this.#stop = null;
			}
		};
	}

	/** Writes down whose this browser is as its device row says, and re-reads what is the user's own when that changed. */
	#follow() {
		if (!device.named) return;
		const id = userOfDevice(deviceName(), this.devices, this.list);
		if (id === currentUserId()) return;
		rememberUser(id);
		this.#changed();
	}

	/** This browser's user changed: what is theirs is read again. */
	#changed() {
		device.refresh();
		void general.load(true);
		void hiddenVideos.load(true);
	}

	/**
	 * Makes a user, for the gate; a name taken already throws with a sentence.
	 * Logged by the gate once the browser has its name, which the row carries.
	 */
	async create(name: string): Promise<User> {
		const user = await createUser(name);
		await this.load();
		return user;
	}

	/** This named browser is this user's from now on; `isNew` when the gate just made them. */
	async join(user: User, isNew = false): Promise<void> {
		await assignDeviceUser(user.id);
		this.#changed();
		if (isNew) logAction('settings', `Added user ${user.name}`);
		logAction('settings', `Gave this browser to ${user.name}`, deviceName());
		await this.load();
	}

	/** A browser just named with its user (`claimDeviceName`): the rest of what `join` does. */
	async named(user: User, isNew: boolean): Promise<void> {
		this.#changed();
		if (isNew) logAction('settings', `Added user ${user.name}`);
		await this.load();
	}

	/** Gives this browser's user another's own settings in place of theirs. */
	async copyFrom(user: User): Promise<void> {
		await copyUserSettings(user, device.user);
		this.#changed();
	}

	async remove(user: User): Promise<void> {
		const line = this.lines.find((l) => l.user.id === user.id);
		await deleteUser(user, line?.devices ?? []);
		await this.load();
	}
}

export const users = new UsersStore();
