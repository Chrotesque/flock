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

/**
 * A submission doing far better than usual (celebrate.ts): Tabler's medal
 * (MIT), drawn in its own 24 units and placed in the middle of the box by
 * `CELEBRATE_PLACE`, cut out of the gold box. Only the sidebar draws it: the
 * legend under Settings → Other leaves it out (the user's call, 21 Oct 2026).
 */
export const CELEBRATE_MARK = [
	'M12 4v3m-4 -3v6m8 -6v6',
	'M12 18.5l-3 1.5l.5 -3.5l-2 -2l3 -.5l1.5 -3l1.5 3l3 .5l-2 2l.5 3.5z'
] as const;
export const CELEBRATE_PLACE = 'translate(6 6) scale(1.5)';
