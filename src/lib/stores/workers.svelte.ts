import { loadWorkerBeats, subscribeWorkerBeats } from '../repo';
import { workerView, type WorkerBeats, type WorkerView } from '../workerstatus';

/**
 * The workers' heartbeats, live, for the sidebar.
 *
 * Realtime brings each beat in as it is written; the clock ticks on its own
 * so a worker that stops beating turns red without any write to say so.
 */
class WorkersStore {
	beats = $state<WorkerBeats>({});
	now = $state(Date.now());
	view: WorkerView = $derived(workerView(this.beats, this.now));

	#started = false;

	start(): void {
		if (this.#started) return;
		this.#started = true;
		loadWorkerBeats()
			.then((beats) => (this.beats = { ...beats, ...this.beats }))
			.catch(() => {});
		subscribeWorkerBeats((role, beat) => {
			this.beats = { ...this.beats, [role]: beat };
			this.now = Date.now();
		});
		setInterval(() => (this.now = Date.now()), 5000);
	}
}

export const workers = new WorkersStore();
