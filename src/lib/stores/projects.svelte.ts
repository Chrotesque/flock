import { brands } from './brands.svelte';
import { settings } from './settings.svelte';
import { accounts } from './accounts.svelte';
import { general } from './general.svelte';
import { draft } from './draft.svelte';
import { paste } from './paste.svelte';
import {
	getProject,
	loadProjectImage,
	loadProjects,
	markProject,
	saveProjectDraft,
	subscribeProjects
} from '../repo';
import { readFlockPaste } from '../flockpaste';
import { devtestApplyPaste, devtestPasteKeys } from '../devtest';
import { logAction } from '../log';
import { listedProjects, readSavedDraft, readVideos, type SavedDraft } from '../projects';
import type { ProjectRow } from '../types';

interface SavedState {
	json: string;
	thumbnail: File | null;
	cover: File | null;
}

/**
 * The project folders the workers found (projects.ts), and the upload one of
 * them has open.
 *
 * The sidebar lists `listed` and `offer`s the one clicked; the upload page
 * `take`s it, because only it knows whether the draft may change now, and
 * then `enter`s it: a project opened before comes back as it was left, a new
 * one is filled from its flock JSON like a paste. From then on the upload
 * page hands every change of the draft to `queueSave`, which keeps it on the
 * project row — so it survives a restart and can be finished on any machine.
 */
class ProjectsStore {
	rows = $state<ProjectRow[]>([]);
	listed: ProjectRow[] = $derived(listedProjects(this.rows, general.value.projectFolders));
	pending = $state<string | null>(null);
	/** The last save that failed, for the project box to say so. */
	saveError = $state('');

	#started = false;
	/** Which `enter` is current: an older one still loading stops. */
	#entering = 0;
	#saved = new Map<string, SavedState>();
	#queued: (SavedState & { id: string }) | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	/** Saves go out one after another, so an older one cannot land last. */
	#chain: Promise<void> = Promise.resolve();

	start(): () => void {
		if (this.#started) return () => {};
		this.#started = true;
		void this.refresh();
		const stop = subscribeProjects((action, row) => {
			if (action === 'delete') this.rows = this.rows.filter((r) => r.id !== row.id);
			else this.#merge(row);
		});
		// Realtime drops quietly when a laptop sleeps; coming back re-reads.
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			stop();
			window.removeEventListener('focus', onFocus);
		};
	}

	async refresh() {
		this.rows = await loadProjects();
	}

	#merge(row: ProjectRow) {
		const at = this.rows.findIndex((r) => r.id === row.id);
		this.rows = at < 0 ? [...this.rows, row] : this.rows.map((r) => (r.id === row.id ? row : r));
	}

	byId(id: string | null): ProjectRow | undefined {
		return id ? this.rows.find((r) => r.id === id) : undefined;
	}

	offer(id: string) {
		this.pending = id;
	}

	take(): string | null {
		const id = this.pending;
		this.pending = null;
		return id;
	}

	/**
	 * Opens a project in the draft, over whatever was there — the upload
	 * page has already decided that may happen, and the sidebar asked before
	 * replacing an upload that belongs to no project.
	 */
	async enter(id: string) {
		const seq = ++this.#entering;
		await this.flush();
		paste.cancel();
		draft.reset();

		let row: ProjectRow;
		try {
			row = await getProject(id);
		} catch (err) {
			paste.show({ title: 'Project not opened', error: err instanceof Error ? err.message : String(err) });
			return;
		}
		this.#merge(row);
		await Promise.all([brands.load(), settings.load(), accounts.load()]);
		if (seq !== this.#entering) return;

		const saved = readSavedDraft(row.draft);
		if (saved) await this.#resume(seq, row, saved);
		else await this.#seed(row);
	}

	/** A project opened before, back as it was left. */
	async #resume(seq: number, row: ProjectRow, saved: SavedDraft) {
		if (saved.brand && brands.byId(saved.brand)) brands.select(saved.brand);
		draft.followBrand(brands.currentId);
		draft.restoreSaved(saved);
		// A local module reading more of the project file than flock keeps
		// gets its keys again (devtest.ts).
		const file = row.manifest ? readFlockPaste(row.manifest, Date.now(), devtestPasteKeys) : null;
		const localNotes = file?.ok && file.paste.claimed ? devtestApplyPaste(file.paste.claimed, { resumed: true }) : [];

		const [thumbnail, cover] = await Promise.all([
			loadProjectImage(row, 'thumbnail', saved.thumbnailName).catch(() => null),
			saved.imagesLinked ? Promise.resolve(null) : loadProjectImage(row, 'cover', saved.coverName).catch(() => null)
		]);
		if (seq !== this.#entering) return;
		draft.thumbnail = thumbnail;
		draft.cover = cover;

		const notes: string[] = [...localNotes];
		if (saved.repick) {
			notes.push(
				"TikTok's audience, comments, Duet and Stitch, and paid promotion, are chosen again: they are picked by hand on every post, so they are not kept."
			);
		}
		if (row.manifest_modified && saved.base && row.manifest_modified !== saved.base) {
			notes.push(`${row.manifest_name || 'The project file'} has changed since — the project box offers to fill from it again.`);
		}
		// Set last, so nothing saved the draft while it was being put back.
		draft.project = row.id;
		this.#baseline(row.id);
		paste.show({ title: `Resumed ${row.name}`, brand: brands.multiple ? (brands.current?.name ?? '') : '', notes });
	}

	/**
	 * A project opened for the first time: filled from its file, like a
	 * paste. One video for every platform, whatever split this browser
	 * remembers — a project's folder is one video's (the user's rule): its
	 * only video is picked, and with several none is, nor is any platform
	 * given its own; both are left to her.
	 */
	async #seed(row: ProjectRow) {
		draft.project = row.id;
		draft.projectBase = row.manifest_modified;
		draft.useOwnSplit([]);
		void markProject(row.id, { status: 'started' }).catch(() => {});

		const title = `Opened ${row.name}`;
		const result = readFlockPaste(row.manifest, Date.now(), devtestPasteKeys);
		if (!result) {
			paste.show({ title, error: `${row.manifest_name || 'The project file'} has no "flock" key at its top, so nothing was filled.` });
		} else if (!result.ok) {
			paste.show({ title, error: result.error });
		} else {
			await paste.apply(result.paste, { folder: row.path, title });
		}

		const videos = readVideos(row.videos);
		if (videos.length === 1 && draft.project === row.id) {
			draft.chooseNasFile('all', row.local ? { ...videos[0], local: true } : videos[0]);
		}
	}

	/** Fills the open project's draft from its file again, over what it carries. */
	async refill() {
		const id = draft.project;
		if (!id) return;
		const row = await getProject(id).catch(() => this.byId(id));
		if (!row || draft.project !== id) return;
		const result = readFlockPaste(row.manifest, Date.now(), devtestPasteKeys);
		if (!result?.ok) {
			paste.show({ title: `${row.manifest_name || 'The project file'} not read`, error: result?.ok === false ? result.error : 'It has no "flock" key at its top.' });
			return;
		}
		draft.projectBase = row.manifest_modified;
		await paste.apply(result.paste, { folder: row.path, title: `Filled again from ${row.manifest_name || 'the project file'}` });
	}

	/** What is saved now, so the first look after a resume writes nothing. */
	#baseline(id: string) {
		this.#saved.set(id, {
			json: JSON.stringify(draft.projectSnapshot()),
			thumbnail: draft.thumbnail,
			cover: draft.cover
		});
	}

	/**
	 * Called by the upload page with the draft whenever it changes. Writes
	 * 800 ms after the last change, and only what differs from the last
	 * write: the images go up only when they are new.
	 */
	queueSave(id: string, snapshot: SavedDraft, images: { thumbnail: File | null; cover: File | null }) {
		const json = JSON.stringify(snapshot);
		const saved = this.#saved.get(id);
		if (this.#queued && this.#queued.id !== id) void this.flush();
		if (saved && saved.json === json && saved.thumbnail === images.thumbnail && saved.cover === images.cover) {
			if (this.#queued?.id === id) this.#cancelQueued();
			return;
		}
		this.#queued = { id, json, ...images };
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.flush(), 800);
	}

	#cancelQueued() {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.#queued = null;
	}

	/** Writes a queued save now — before leaving the page, or another project. */
	flush(): Promise<void> {
		const next = this.#queued;
		this.#cancelQueued();
		if (next) {
			this.#chain = this.#chain.then(async () => {
				const saved = this.#saved.get(next.id);
				const images: { thumbnail?: File | null; cover?: File | null } = {};
				if (next.thumbnail !== (saved?.thumbnail ?? null)) images.thumbnail = next.thumbnail;
				if (next.cover !== (saved?.cover ?? null)) images.cover = next.cover;
				try {
					await saveProjectDraft(next.id, JSON.parse(next.json), images);
					this.#saved.set(next.id, { json: next.json, thumbnail: next.thumbnail, cover: next.cover });
					this.saveError = '';
				} catch (err) {
					// The next change tries again, from the last state that did land.
					this.saveError = err instanceof Error ? err.message : String(err);
				}
			});
		}
		return this.#chain;
	}

	/** Sent: off the sidebar, with the jobs it became. */
	async markUploaded(id: string, jobs: string[]) {
		await this.flush();
		this.#saved.delete(id);
		await markProject(id, { status: 'uploaded', done_at: new Date().toISOString(), jobs }).catch((err) => {
			this.saveError = err instanceof Error ? err.message : String(err);
		});
	}

	/** Not going to be sent: off the sidebar for good. */
	async dismiss(id: string) {
		if (this.#queued?.id === id) this.#cancelQueued();
		this.#saved.delete(id);
		await markProject(id, { status: 'dismissed', done_at: new Date().toISOString() });
		const row = this.byId(id);
		logAction('upload', `Took project ${row?.name ?? id} off the list`, row?.path ?? '');
	}
}

export const projects = new ProjectsStore();
