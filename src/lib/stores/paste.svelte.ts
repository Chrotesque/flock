import { brands } from './brands.svelte';
import { accounts } from './accounts.svelte';
import { draft } from './draft.svelte';
import { loadPlaylists, requestLocalImage } from '../repo';
import { closestBrand, filledSummary, matchBrand, type FlockPaste, type PasteResult } from '../flockpaste';
import { IMAGE_LIMITS, IMAGE_PLATFORMS, acceptedTypes, largestAccepted } from '../coverimage';
import { formatBytes } from '../format';
import { matchPlaylists, withPlaylists } from '../playlists';
import { resolveIn } from '../folders';
import type { PlatformId } from '../types';

export interface PasteNotice {
	/** The heading: 'Filled from paste', or the project opened. */
	title: string;
	/** A block that could not be used at all; nothing was filled. */
	error: string;
	/** The brand the draft was filled for, with more than one brand. */
	brand: string;
	platforms: { id: PlatformId; summary: string }[];
	notes: string[];
	thumbnail: { path: string; state: 'fetching' | 'waiting' | 'done' | 'failed'; message: string } | null;
	/**
	 * The block names a brand there is none of, with several to choose from:
	 * nothing is filled until one is picked (`chooseBrand`). `suggested` is the
	 * brand a typo was most likely meant to be, or ''.
	 */
	brandChoice: { wanted: string; suggested: string; options: { id: string; name: string }[] } | null;
}

interface ApplyOptions {
	folder?: string;
	title?: string;
	brandId?: string;
}

const emptyNotice = (): PasteNotice => ({
	title: '',
	error: '',
	brand: '',
	platforms: [],
	notes: [],
	thumbnail: null,
	brandChoice: null
});

/**
 * A pasted flock block on its way into the draft (flockpaste.ts), and the
 * notice saying what it filled.
 *
 * The layout's paste listener `offer`s a block and goes to the upload page;
 * that page `take`s it, because only it knows whether the draft may change —
 * not while an upload is being sent, and only after a finished one is
 * cleared — and then `apply`s it. The thumbnail is fetched from the worker
 * afterwards, so the text is there at once and the image follows.
 */
class PasteStore {
	pending = $state<FlockPaste | null>(null);
	notice = $state<PasteNotice | null>(null);
	/** Which paste is current: a slower thumbnail for an older one is dropped. */
	#seq = 0;
	/** A block held until the person says which brand it is for. */
	#awaiting: { seq: number; paste: FlockPaste; opts: ApplyOptions } | null = null;

	offer(result: PasteResult) {
		this.#seq++;
		if (!result.ok) {
			this.pending = null;
			this.notice = { ...emptyNotice(), error: result.error };
			return;
		}
		this.pending = result.paste;
	}

	take(): FlockPaste | null {
		const paste = this.pending;
		this.pending = null;
		return paste;
	}

	refuse(reason: string) {
		this.notice = { ...emptyNotice(), error: reason };
	}

	/** Shows a notice of the caller's own — a project resumed, say. */
	show(notice: Partial<PasteNotice>) {
		this.notice = { ...emptyNotice(), ...notice };
	}

	/** A thumbnail still on its way belongs to a draft that is gone: drop it. */
	cancel() {
		this.#seq++;
	}

	dismiss() {
		this.notice = null;
		this.#awaiting = null;
	}

	/** Fills the block that was waiting for its brand, for the one picked. */
	async chooseBrand(id: string) {
		const waiting = this.#awaiting;
		if (!waiting || waiting.seq !== this.#seq || !brands.byId(id)) return;
		this.#awaiting = null;
		await this.apply(waiting.paste, { ...waiting.opts, brandId: id });
	}

	/**
	 * Fills the draft from a block. `folder` is the project folder the block
	 * came from, which a relative thumbnail path is read against; `title`
	 * heads the notice; `brandId` is the brand picked for a block whose own
	 * brand matched none. The text is in when this resolves; the thumbnail
	 * follows from the worker.
	 */
	async apply(paste: FlockPaste, opts: ApplyOptions = {}) {
		const seq = ++this.#seq;
		this.#awaiting = null;
		const notes = [...paste.notes];

		// The brand first: switching drops the draft's per-platform choices, so
		// it has to happen before the block's tags and playlist go in. The draft
		// is told here rather than by the upload page's effect, which would run
		// after this and see a brand it had not been told of yet.
		await brands.load();
		if (seq !== this.#seq) return;
		if (opts.brandId && brands.byId(opts.brandId)) {
			brands.select(opts.brandId);
		} else if (paste.brand) {
			const match = matchBrand(brands.list, paste.brand);
			if (match) brands.select(match.id);
			else if (brands.multiple) {
				// Filling it for whichever brand is in view is how a video went
				// out on the wrong brand's accounts (a typo in a project file): ask.
				this.#awaiting = { seq, paste, opts };
				this.notice = {
					...emptyNotice(),
					title: opts.title ?? 'Which brand is this for?',
					brandChoice: {
						wanted: paste.brand,
						suggested: closestBrand(brands.list, paste.brand)?.id ?? '',
						options: brands.ordered.map((b) => ({ id: b.id, name: b.name }))
					}
				};
				return;
			} else notes.push(`No brand is called "${paste.brand}"; filled for ${brands.current?.name ?? 'the brand in view'}.`);
		}
		draft.followBrand(brands.currentId);
		draft.applyPaste(paste.platforms);

		const youtube = paste.platforms.youtube;
		if (youtube?.playlists?.length) {
			const note = await this.#matchPlaylists(youtube.playlists);
			if (note) notes.push(note);
		}

		const thumbnail = opts.folder ? resolveIn(opts.folder, paste.thumbnail) : paste.thumbnail;
		if (seq !== this.#seq) return;
		this.notice = {
			...emptyNotice(),
			title: opts.title ?? 'Filled from paste',
			brand: brands.multiple ? (brands.current?.name ?? '') : '',
			platforms: (Object.entries(paste.platforms) as [PlatformId, NonNullable<FlockPaste['platforms'][PlatformId]>][]).map(
				([id, entry]) => ({ id, summary: filledSummary(id, entry) })
			),
			notes,
			thumbnail: thumbnail ? { path: thumbnail, state: 'fetching', message: '' } : null
		};
		if (thumbnail) void this.#fetchThumbnail(seq, thumbnail);
	}

	/**
	 * The channel's own spelling of each playlist, when the block's differs
	 * only in case; a note for any the channel does not have, since the
	 * worker leaves the video out of a playlist it cannot find.
	 */
	async #matchPlaylists(names: string[]): Promise<string> {
		try {
			await accounts.load();
			const index = await loadPlaylists(accounts.for('youtube')?.account_id ?? '');
			if (!index) return '';
			const { titles, missing } = matchPlaylists(
				names,
				index.items.map((p) => p.title)
			);
			draft.overrides.youtube = withPlaylists(draft.overrides.youtube ?? {}, titles);
			if (missing.length === 0) return '';
			const quoted = missing.map((t) => `"${t}"`).join(', ');
			return `The channel has no playlist called ${quoted}; change it in the Playlists box.`;
		} catch {
			return '';
		}
	}

	async #fetchThumbnail(seq: number, path: string) {
		// A failure reopens a notice already closed: the image is missing from
		// the upload, and nothing else would say so.
		const set = (state: 'fetching' | 'waiting' | 'done' | 'failed', message: string) => {
			if (seq !== this.#seq) return;
			const thumbnail = { path, state, message };
			if (this.notice) this.notice.thumbnail = thumbnail;
			else if (state === 'failed') this.notice = { ...emptyNotice(), thumbnail };
		};
		try {
			const file = await requestLocalImage(path, {
				onWaiting: () => set('waiting', 'The worker has not answered yet — is it running?')
			});
			if (seq !== this.#seq) return;
			// What the picker would refuse outright; one platform's limits alone
			// are said by the Thumbnail / Cover box itself.
			if (!acceptedTypes(IMAGE_PLATFORMS).includes(file.type)) {
				throw new Error(`${file.name} is not a ${IMAGE_PLATFORMS.map((p) => IMAGE_LIMITS[p].formats).join(' / ')} image.`);
			}
			if (file.size > largestAccepted(IMAGE_PLATFORMS)) {
				throw new Error(`${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(largestAccepted(IMAGE_PLATFORMS))} limit.`);
			}
			draft.thumbnail = file;
			set('done', `${file.name}, ${formatBytes(file.size)}`);
		} catch (err) {
			set('failed', err instanceof Error ? err.message : String(err));
		}
	}
}

export const paste = new PasteStore();
