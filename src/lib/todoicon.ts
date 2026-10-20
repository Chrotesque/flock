/**
 * The To finish box's marks, in its 48×48 box: drawn big in the sidebar
 * (+layout.svelte) and small where it is explained (TodoIcon.svelte), so
 * the two cannot drift apart.
 */
export type TodoState = 'idle' | 'due' | 'failed' | 'open';

export const TODO_MARKS = {
	/** Nothing to do: cut out of the green box. */
	check: 'M14 24.8l7 7L34.5 17.5',
	/** Something to do, or a post that did not go out. */
	bang: 'M24 13.5v12.5M24 33.6v0.01',
	/** Open: the way back, cut out of the purple box. */
	back: 'M27.5 14.5L18 24l9.5 9.5'
} as const;
