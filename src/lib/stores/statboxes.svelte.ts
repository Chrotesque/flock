import { pb } from '../pb';
import { getSetting, setSetting } from '../repo';
import { logAction } from '../log';
import { FLOCK_BOXES, boxName, boxSummary, readStatBoxes, wholeBox, type StatBox } from '../statbox';

/**
 * The stat boxes every profile shares (statbox.ts): flock's own, then the
 * ones made under Settings → Dashboard → Stat boxes, kept in `app_settings` /
 * `dashboard_boxes` = { boxes } and arriving live. Each write merges with the
 * row as stored just before, so two profiles saving at once keep both.
 */
const KEY = 'dashboard_boxes';

async function readRow(): Promise<StatBox[]> {
	return readStatBoxes(await getSetting<unknown>(KEY, null));
}

class StatBoxes {
	/** The boxes made by profiles, in the order they were made. */
	custom = $state<StatBox[]>([]);
	loaded = $state(false);
	error = $state('');
	#loading: Promise<void> | null = null;

	/** Every box: flock's first. */
	get all(): StatBox[] {
		return [...FLOCK_BOXES, ...this.custom];
	}

	byId(id: string): StatBox | undefined {
		return this.all.find((b) => b.id === id);
	}

	/** Every box's name by id, for the log's lines. */
	get names(): Record<string, string> {
		return Object.fromEntries(this.all.map((b) => [b.id, boxName(b)]));
	}

	load(force = false): Promise<void> {
		if (this.#loading && !force) return this.#loading;
		this.#loading = (async () => {
			try {
				this.custom = await readRow();
				this.error = '';
			} catch (err) {
				this.error = err instanceof Error ? err.message : String(err);
			} finally {
				this.loaded = true;
			}
		})();
		return this.#loading;
	}

	/** Adds a box or replaces the one with its id; logged with what it counts. Throws when it cannot be written. */
	async save(box: StatBox): Promise<void> {
		const next = wholeBox($state.snapshot(box) as StatBox);
		const stored = await readRow();
		const was = stored.find((b) => b.id === next.id);
		const boxes = was ? stored.map((b) => (b.id === next.id ? next : b)) : [...stored, next];
		await setSetting(KEY, { boxes });
		this.custom = boxes;
		if (!was) logAction('settings', 'Made a stat box', `${boxName(next)}: ${boxSummary(next)}`);
		else if (JSON.stringify(was) !== JSON.stringify(next))
			logAction('settings', 'Changed a stat box', `${boxName(was)}: ${boxSummary(was)} → ${boxName(next)}: ${boxSummary(next)}`);
	}

	/** Deletes a box for everyone; logged with what it counted. */
	async remove(id: string): Promise<void> {
		const stored = await readRow();
		const gone = stored.find((b) => b.id === id);
		if (!gone) return;
		const boxes = stored.filter((b) => b.id !== id);
		await setSetting(KEY, { boxes });
		this.custom = boxes;
		logAction('settings', 'Deleted a stat box', `${boxName(gone)}: ${boxSummary(gone)}`);
	}

	/** Boxes made or changed elsewhere, live. Returns the unsubscribe. */
	subscribe(): () => void {
		const sub = pb.collection('app_settings').subscribe('*', (e) => {
			if (e.record.key !== KEY) return;
			this.custom = readStatBoxes(e.action === 'delete' ? null : e.record.value);
		});
		sub.catch(() => {});
		return () => void sub.then((unsubscribe) => unsubscribe()).catch(() => {});
	}
}

export const statBoxes = new StatBoxes();
