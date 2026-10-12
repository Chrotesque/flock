/**
 * The dashboard's widgets and how they are laid out: an order and a width
 * each, on a twelve-column grid that packs them densely. Kept per browser
 * (localStorage `flock.dashboard.layout`), so everyone using flock arranges
 * their own; a saved layout is read field by field, so a widget added later
 * turns up at the end and one removed is dropped.
 */

export type WidgetId = 'today' | 'week' | 'month' | 'attention' | 'coming' | 'latest' | 'system' | 'waiting';

export type WidgetSize = 'third' | 'half' | 'twothirds' | 'full';

export const SIZES: WidgetSize[] = ['third', 'half', 'twothirds', 'full'];

/** Columns out of twelve. */
export const SPAN: Record<WidgetSize, number> = { third: 4, half: 6, twothirds: 8, full: 12 };

export const SIZE_LABEL: Record<WidgetSize, string> = { third: '⅓', half: '½', twothirds: '⅔', full: 'Full' };

export interface WidgetDef {
	id: WidgetId;
	title: string;
	size: WidgetSize;
}

/** Every widget, in the default order and widths. */
export const WIDGETS: WidgetDef[] = [
	{ id: 'today', title: 'Today', size: 'third' },
	{ id: 'week', title: 'This week', size: 'third' },
	{ id: 'month', title: 'This month', size: 'third' },
	{ id: 'attention', title: 'Needs attention', size: 'half' },
	{ id: 'coming', title: 'Coming up', size: 'half' },
	{ id: 'latest', title: 'Latest releases', size: 'full' },
	{ id: 'system', title: 'System', size: 'half' },
	{ id: 'waiting', title: 'Waiting', size: 'half' }
];

export interface LayoutItem {
	id: WidgetId;
	size: WidgetSize;
}

export const DEFAULT_LAYOUT: LayoutItem[] = WIDGETS.map(({ id, size }) => ({ id, size }));

const known = new Map(WIDGETS.map((w) => [w.id, w]));

export function titleOf(id: WidgetId): string {
	return known.get(id)?.title ?? id;
}

/** A saved layout, kept to the widgets that exist; any not in it are added in their default place at the end. */
export function readLayout(raw: unknown): LayoutItem[] {
	const out: LayoutItem[] = [];
	const seen = new Set<WidgetId>();
	for (const entry of Array.isArray(raw) ? raw : []) {
		const id = (entry as { id?: unknown })?.id as WidgetId;
		const def = known.get(id);
		if (!def || seen.has(id)) continue;
		const size = (entry as { size?: unknown }).size as WidgetSize;
		out.push({ id, size: SIZES.includes(size) ? size : def.size });
		seen.add(id);
	}
	for (const def of WIDGETS) if (!seen.has(def.id)) out.push({ id: def.id, size: def.size });
	return out;
}

/** The layout with `id` moved to `index` (counted in the layout without it), clamped to the ends. */
export function moveTo(layout: LayoutItem[], id: WidgetId, index: number): LayoutItem[] {
	const item = layout.find((entry) => entry.id === id);
	if (!item) return layout;
	const rest = layout.filter((entry) => entry.id !== id);
	const at = Math.max(0, Math.min(rest.length, index));
	return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** The next width round: ⅓ → ½ → ⅔ → full → ⅓. */
export function nextSize(size: WidgetSize): WidgetSize {
	return SIZES[(SIZES.indexOf(size) + 1) % SIZES.length];
}

export function sameLayout(a: LayoutItem[], b: LayoutItem[]): boolean {
	return a.length === b.length && a.every((item, i) => item.id === b[i].id && item.size === b[i].size);
}

/**
 * Where a widget being dragged goes when the pointer is over `target`: in
 * its place, before it or after it by which half of it the pointer is in —
 * left and right on a shared row, top and bottom for a full-width one.
 */
export function dropIndex(
	layout: LayoutItem[],
	dragged: WidgetId,
	target: WidgetId,
	pointer: { x: number; y: number },
	rect: { left: number; top: number; width: number; height: number }
): number {
	const rest = layout.filter((entry) => entry.id !== dragged);
	const at = rest.findIndex((entry) => entry.id === target);
	if (at < 0) return layout.findIndex((entry) => entry.id === dragged);
	const full = rest[at].size === 'full';
	const after = full ? pointer.y > rect.top + rect.height / 2 : pointer.x > rect.left + rect.width / 2;
	return after ? at + 1 : at;
}
