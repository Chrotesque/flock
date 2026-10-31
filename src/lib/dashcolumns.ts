/**
 * The columns of the Dashboard's list of videos: which are shown and in what
 * order, set under Settings → Dashboard and kept in `general.dashboardColumns`
 * (shared by every browser). The thumbnail and the video's title always lead
 * — the title cannot be hidden, the thumbnail can; everything after them
 * moves and hides freely. The Jestr column exists only with the Jestr
 * integration on. Ratio View (ratioview.ts) draws a set of its own, every
 * platform side by side in each column, which Settings does not arrange.
 */

export type ColumnId =
	| 'thumb'
	| 'video'
	| 'jestr'
	| 'followers'
	| 'views'
	| 'likes'
	| 'comments'
	| 'skip'
	| 'engaged'
	| 'curve'
	| 'usual';

export interface DashColumn {
	id: ColumnId;
	on: boolean;
}

export interface ColumnDef {
	label: string;
	/** What it shows, for Settings. */
	about: string;
	/**
	 * Its width in the list, in px ('fr' for the title, which takes what is left;
	 * 'content' for as wide as its widest cell), wide and from 1200 / 760 px
	 * down; null hides it there.
	 */
	width: number | 'fr' | 'content';
	mid: number | 'fr' | null;
	narrow: number | 'fr' | null;
	/** Always where it is: the thumbnail and the title lead the row. */
	fixed?: boolean;
	/** Cannot be hidden. */
	required?: boolean;
}

export const COLUMNS: Record<ColumnId, ColumnDef> = {
	thumb: { label: 'Thumbnail', about: "YouTube's thumbnail, or the platform's mark for a reel", width: 0, mid: 0, narrow: 0, fixed: true },
	video: {
		label: 'Video',
		about: 'Title, release, kind, length and where it went out',
		width: 'fr',
		mid: 'fr',
		narrow: 'fr',
		fixed: true,
		required: true
	},
	jestr: { label: 'Jestr', about: 'A tick on Jestr campaign videos (with the Jestr integration on)', width: 48, mid: 44, narrow: 40 },
	// The counters hold each platform's number under the sum, as wide as the widest row needs.
	followers: { label: 'Followers', about: 'Followers and subscribers each video brought, every platform added up', width: 'content', mid: 84, narrow: null },
	views: { label: 'Views', about: 'Views, every platform added up, each one below', width: 'content', mid: 104, narrow: 96 },
	likes: { label: 'Likes', about: 'Likes, every platform added up', width: 'content', mid: null, narrow: null },
	comments: { label: 'Comments', about: 'Comments, every platform added up', width: 'content', mid: null, narrow: null },
	skip: {
		label: 'Skipped',
		about: "The share of views dropped at the start: Instagram's skips within 3 seconds, YouTube's plays that never became an engaged view",
		width: 'content',
		mid: null,
		narrow: null
	},
	engaged: {
		label: 'Engaged',
		about: 'Engagement rate by views: likes and comments over views × 100, every platform together, each one below',
		width: 'content',
		mid: null,
		narrow: null
	},
	curve: { label: 'From release', about: 'Views from release, the usual for its kind dashed', width: 156, mid: 132, narrow: null },
	usual: {
		label: 'vs usual',
		about: 'Ahead of, about or behind the usual: every platform together, each one below',
		width: 'content',
		mid: 112,
		narrow: 76
	}
};

export const COLUMN_ORDER: ColumnId[] = ['thumb', 'video', 'jestr', 'followers', 'views', 'likes', 'comments', 'skip', 'engaged', 'curve', 'usual'];

export const DEFAULT_COLUMNS: DashColumn[] = COLUMN_ORDER.map((id) => ({ id, on: true }));


const isColumn = (id: unknown): id is ColumnId => typeof id === 'string' && (COLUMN_ORDER as string[]).includes(id);
const FIXED = COLUMN_ORDER.filter((id) => COLUMNS[id].fixed);

/**
 * A stored layout rebuilt: known columns in their stored order, each once; a
 * column added to flock since is put after the one it follows by default;
 * the fixed ones lead, and the title is on.
 */
export function readColumns(raw: unknown): DashColumn[] {
	const out: DashColumn[] = [];
	for (const entry of Array.isArray(raw) ? raw : []) {
		const id = (entry as { id?: unknown })?.id;
		if (!isColumn(id) || out.some((c) => c.id === id)) continue;
		out.push({ id, on: (entry as { on?: unknown }).on !== false || Boolean(COLUMNS[id].required) });
	}
	if (out.length === 0) return DEFAULT_COLUMNS.map((c) => ({ ...c }));
	for (const [i, id] of COLUMN_ORDER.entries()) {
		if (out.some((c) => c.id === id)) continue;
		const after = COLUMN_ORDER.slice(0, i).reverse().find((prev) => out.some((c) => c.id === prev));
		out.splice(after ? out.findIndex((c) => c.id === after) + 1 : 0, 0, { id, on: true });
	}
	const fixed = FIXED.map((id) => out.find((c) => c.id === id)!);
	return [...fixed, ...out.filter((c) => !COLUMNS[c.id].fixed)];
}

/** Moves a column to just before another (to the end with `before` null); fixed columns stay. */
export function moveBefore(columns: DashColumn[], id: ColumnId, before: ColumnId | null): DashColumn[] {
	if (COLUMNS[id].fixed || id === before) return columns;
	const moving = columns.find((c) => c.id === id);
	if (!moving) return columns;
	const rest = columns.filter((c) => c.id !== id);
	let at = before === null ? rest.length : rest.findIndex((c) => c.id === before);
	if (at < 0) return columns;
	at = Math.max(at, rest.filter((c) => COLUMNS[c.id].fixed).length);
	return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** Moves a column one place left (-1) or right (+1), never past the fixed ones. */
export function moveBy(columns: DashColumn[], id: ColumnId, step: -1 | 1): DashColumn[] {
	const i = columns.findIndex((c) => c.id === id);
	const j = i + step;
	if (i < 0 || COLUMNS[id].fixed || j < 0 || j >= columns.length || COLUMNS[columns[j].id].fixed) return columns;
	const out = [...columns];
	[out[i], out[j]] = [out[j], out[i]];
	return out;
}

/** Shows or hides a column; the title stays. */
export function setShown(columns: DashColumn[], id: ColumnId, on: boolean): DashColumn[] {
	if (COLUMNS[id].required) return columns;
	return columns.map((c) => (c.id === id ? { ...c, on } : c));
}

/** Whether a column can be shown here at all: Jestr's only with the integration. */
export function available(id: ColumnId, { jestr }: { jestr: boolean }): boolean {
	return id !== 'jestr' || jestr;
}

/** The columns the list draws, in order. */
export function shownColumns(columns: DashColumn[], options: { jestr: boolean }): ColumnId[] {
	return columns.filter((c) => c.on && available(c.id, options)).map((c) => c.id);
}

export type ListSize = 'wide' | 'mid' | 'narrow';

/** The columns drawn at a size: the narrower layouts leave some out. */
export function columnsAt(ids: ColumnId[], size: ListSize): ColumnId[] {
	return ids.filter((id) => widthOf(id, size) !== null);
}

function widthOf(id: ColumnId, size: ListSize): number | 'fr' | 'content' | null {
	const def = COLUMNS[id];
	return size === 'wide' ? def.width : size === 'mid' ? def.mid : def.narrow;
}

/**
 * The list's grid at a size; the thumbnail's width is the list's `--thumbcol`.
 * Every row shares it (a subgrid), so a 'content' column is as wide as its
 * widest cell in any row.
 */
export function gridTemplate(ids: ColumnId[], size: ListSize): string {
	return columnsAt(ids, size)
		.map((id) => {
			const w = widthOf(id, size);
			return id === 'thumb' ? 'var(--thumbcol)' : w === 'fr' ? 'minmax(0, 1fr)' : w === 'content' ? 'max-content' : `${w}px`;
		})
		.join(' ');
}

/** A layout in words, for the log: the order shown, then what is hidden. */
export function columnWords(columns: DashColumn[]): string {
	const shown = columns.filter((c) => c.on).map((c) => COLUMNS[c.id].label);
	const hidden = columns.filter((c) => !c.on).map((c) => COLUMNS[c.id].label);
	return `${shown.join(', ')}${hidden.length ? ` (hidden: ${hidden.join(', ')})` : ''}`;
}

/* ---- on a phone (stores/phone.svelte.ts) ---- */

/**
 * What a phone's list leaves out, whatever the layout: the thumbnail goes up
 * onto the title's own line above the numbers, and Jestr, the curve and vs
 * usual do not fit beside them.
 */
const PHONE_OFF: ColumnId[] = ['thumb', 'jestr', 'curve', 'usual'];

export function phoneOff(id: ColumnId): boolean {
	return PHONE_OFF.includes(id);
}

/**
 * A phone's grid: the release date where the title stands elsewhere (the
 * title has the line above), then each count as wide as its widest number.
 */
export function phoneTemplate(ids: ColumnId[]): string {
	return ids
		.filter((id) => !phoneOff(id))
		.map((id) => (id === 'video' ? 'minmax(0, 1fr)' : 'max-content'))
		.join(' ');
}

/* ---- Ratio View (ratioview.ts) ---- */

/**
 * What Ratio View shows after the title, whatever the layout, each a cell per
 * platform coloured against that platform's usual (ratioview.ts): the reach
 * (`usual`: views against the usual at the same age), likes and comments per
 * view, and the skip rate. No Jestr, followers, curve or engagement rate; a
 * line after the reach, the likes and the comments.
 */
export const RATIO_COLUMNS: ColumnId[] = ['usual', 'likes', 'comments', 'skip'];

/** The columns with a line after them, wherever another column follows. */
export const RATIO_LINES: ColumnId[] = ['usual', 'likes', 'comments'];

/** Which of them the narrower lists keep: the reach and the ratios first. */
const RATIO_AT: Record<ListSize, ColumnId[]> = {
	wide: RATIO_COLUMNS,
	mid: ['usual', 'likes', 'comments'],
	narrow: ['usual', 'likes']
};

/** The columns Ratio View draws: the thumbnail as the layout has it, the title, then its own set. */
export function ratioColumns(columns: DashColumn[]): ColumnId[] {
	const thumb = columns.find((c) => c.id === 'thumb')?.on !== false;
	return [...(thumb ? (['thumb'] as ColumnId[]) : []), 'video', ...RATIO_COLUMNS];
}

/** Whether Ratio View leaves a column out at a size; the thumbnail and the title stay. */
export function ratioOff(id: ColumnId, size: ListSize): boolean {
	return id !== 'thumb' && id !== 'video' && !RATIO_AT[size].includes(id);
}

/**
 * The least Ratio View's title column gets: about two lines for a long
 * title. Past that, a narrow window scrolls the list sideways.
 */
export const RATIO_TITLE_MIN = '300px';

/**
 * Ratio View's grid at a size: a track per platform in each column
 * (`slots`, each as wide as its widest number in any row, so every
 * platform's numbers line up down the list), the title taking what is
 * left — at least RATIO_TITLE_MIN, wrapping when it is longer than its
 * room — and a 1px track for each line (RATIO_LINES) that has a column
 * after it at this size.
 */
export function ratioTemplate(ids: ColumnId[], slots: Partial<Record<ColumnId, number>>, size: ListSize): string {
	const shown = ids.filter((id) => !ratioOff(id, size));
	return shown
		.flatMap((id, i) => {
			if (id === 'thumb') return ['var(--thumbcol)'];
			if (id === 'video') return [`minmax(${RATIO_TITLE_MIN}, 1fr)`];
			const tracks = `repeat(${Math.max(1, slots[id] ?? 1)}, max-content)`;
			return RATIO_LINES.includes(id) && i < shown.length - 1 ? [tracks, '1px'] : [tracks];
		})
		.join(' ');
}
