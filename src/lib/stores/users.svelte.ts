import { createUser, currentUserId, deviceName, logAction, rememberUser } from '../log';
import { copyUserSettings, deleteUser, listUsers, subscribeUsers } from '../repo';
import { userLines, type User } from '../users';
import { device } from './device.svelte';
import { general } from './general.svelte';
import { hiddenVideos } from './hiddenvideos.svelte';

/**
 * The profiles (users.ts), live, and which one this browser is on. A browser
 * whose profile was deleted elsewhere is put back behind the gate on the next
 * load; a profile renamed elsewhere signs the Log with its new name.
 */
class UsersStore {
	list = $state<User[]>([]);
	loaded = $state(false);
	error = $state('');

	#started = 0;
	#stop: (() => void) | null = null;
	#reading: Promise<void> | null = null;
	#again = false;

	/** This browser's profile, while it has one. */
	get current(): User | null {
		return this.list.find((u) => u.id === device.user) ?? null;
	}

	get lines() {
		return userLines(this.list, device.user);
	}

	/** Reads the list; a read asked for mid-read runs once more after. */
	async load(): Promise<void> {
		if (this.#reading) {
			this.#again = true;
			return this.#reading;
		}
		this.#reading = (async () => {
			do {
				this.#again = false;
				try {
					this.list = await listUsers();
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

	/** Loads and follows the list while anything needs it. Returns the stop. */
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

	/** Keeps this browser's copy of its profile in step with the list: gone, or renamed. */
	#follow() {
		const id = currentUserId();
		if (!id) return;
		const mine = this.list.find((u) => u.id === id);
		if (!mine) {
			rememberUser(null);
			this.#changed();
		} else if (mine.name !== deviceName()) rememberUser(mine);
	}

	/** This browser's profile changed: what is its own is read again. */
	#changed() {
		device.refresh();
		void general.load(true);
		void hiddenVideos.load(true);
	}

	/** This browser uses `user` from now on — at the gate, or switched in Settings. */
	async use(user: User): Promise<void> {
		const was = this.current?.name ?? '';
		rememberUser(user);
		this.#changed();
		if (was !== user.name) logAction('settings', was ? `Switched from ${was} to ${user.name}` : `Chose the profile ${user.name}`);
	}

	/** Makes a profile and uses it; a name taken already throws with a sentence. */
	async createAndUse(name: string): Promise<User> {
		const user = await createUser(name);
		// Written down before anything else is awaited: a page left now keeps it.
		rememberUser(user);
		this.#changed();
		logAction('settings', `Added the profile ${user.name}`);
		await this.load();
		return user;
	}

	/** Gives this browser's profile another's own settings in place of its own. */
	async copyFrom(user: User): Promise<void> {
		await copyUserSettings(user, device.user);
		this.#changed();
	}

	async remove(user: User): Promise<void> {
		await deleteUser(user);
		await this.load();
	}
}

export const users = new UsersStore();
