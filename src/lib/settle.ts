/**
 * Runs `fn` once a burst of changes has stopped.
 *
 * Persistence is debounced tightly so edits are not lost, but logging wants the
 * opposite: typing a name over a few seconds is one action, and logging each
 * settled keystroke buries the entry that matters under near-identical ones.
 * So writes stay fast and the log waits for the dust to clear.
 */
export function settle(delay: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return {
		schedule(fn: () => void) {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				fn();
			}, delay);
		},
		cancel() {
			if (timer) clearTimeout(timer);
			timer = null;
		}
	};
}

/** Long enough that typing a name or a path reads as one action. */
export const LOG_SETTLE_MS = 2500;
