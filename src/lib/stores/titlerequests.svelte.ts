import { listTitleRequests, requestRenames, subscribeTitleRequests, type RenameAsk } from '../repo';
import { REFUSED_SHOWN_MS, type TitleRequest } from '../retitle';

/**
 * The renames asked for on the Dashboard (retitle.ts) over the last day or
 * so, arriving live as the worker answers them: the dialog follows its own
 * asks through here, and each row says what is still waiting or was refused.
 */
class TitleRequests {
	rows = $state<TitleRequest[]>([]);

	async load() {
		this.rows = await listTitleRequests(new Date(Date.now() - REFUSED_SHOWN_MS - 60 * 60_000));
	}

	/** Throws when nothing could be asked; the rows asked are in at once. */
	async ask(asks: RenameAsk[]): Promise<TitleRequest[]> {
		const made = await requestRenames(asks);
		for (const row of made) this.#put(row, 'create');
		return made;
	}

	subscribe(): () => void {
		return subscribeTitleRequests((row, action) => this.#put(row, action));
	}

	#put(row: TitleRequest, action: string) {
		const rest = this.rows.filter((r) => r.id !== row.id);
		this.rows = action === 'delete' ? rest : [...rest, row].sort((a, b) => a.created.localeCompare(b.created));
	}
}

export const titleRequests = new TitleRequests();
