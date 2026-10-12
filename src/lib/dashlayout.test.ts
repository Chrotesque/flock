import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, dropIndex, moveTo, nextSize, readLayout, sameLayout, type LayoutItem } from './dashlayout';

const ids = (layout: LayoutItem[]) => layout.map((item) => item.id);

describe('readLayout', () => {
	it('is the default with nothing saved', () => {
		expect(readLayout(null)).toEqual(DEFAULT_LAYOUT);
		expect(readLayout('junk')).toEqual(DEFAULT_LAYOUT);
	});

	it('keeps a saved order and widths, drops unknown and repeated widgets, adds missing ones at the end', () => {
		const read = readLayout([
			{ id: 'latest', size: 'half' },
			{ id: 'gone', size: 'full' },
			{ id: 'today', size: 'enormous' },
			{ id: 'latest', size: 'third' }
		]);
		expect(read.slice(0, 2)).toEqual([
			{ id: 'latest', size: 'half' },
			{ id: 'today', size: 'third' }
		]);
		expect(ids(read)).toEqual(['latest', 'today', 'week', 'month', 'attention', 'coming', 'system', 'waiting']);
	});
});

describe('moveTo', () => {
	it('moves a widget to a place among the others, clamped to the ends', () => {
		expect(ids(moveTo(DEFAULT_LAYOUT, 'latest', 0)).slice(0, 2)).toEqual(['latest', 'today']);
		expect(ids(moveTo(DEFAULT_LAYOUT, 'today', 99)).at(-1)).toBe('today');
		expect(moveTo(DEFAULT_LAYOUT, 'nope' as never, 0)).toBe(DEFAULT_LAYOUT);
	});
});

describe('nextSize', () => {
	it('goes round the widths', () => {
		expect(nextSize('third')).toBe('half');
		expect(nextSize('full')).toBe('third');
	});
});

describe('sameLayout', () => {
	it('compares order and widths', () => {
		expect(sameLayout(DEFAULT_LAYOUT, readLayout(null))).toBe(true);
		expect(sameLayout(DEFAULT_LAYOUT, moveTo(DEFAULT_LAYOUT, 'week', 0))).toBe(false);
	});
});

describe('dropIndex', () => {
	const rect = { left: 100, top: 100, width: 200, height: 100 };
	it('goes before or after a widget on a row by which half the pointer is in', () => {
		// Dragging "today" over "month" (index 1 once "today" is out).
		expect(dropIndex(DEFAULT_LAYOUT, 'today', 'month', { x: 150, y: 150 }, rect)).toBe(1);
		expect(dropIndex(DEFAULT_LAYOUT, 'today', 'month', { x: 250, y: 150 }, rect)).toBe(2);
	});

	it('goes above or below a full-width widget by height', () => {
		const at = ids(DEFAULT_LAYOUT.filter((i) => i.id !== 'today')).indexOf('latest');
		expect(dropIndex(DEFAULT_LAYOUT, 'today', 'latest', { x: 290, y: 120 }, rect)).toBe(at);
		expect(dropIndex(DEFAULT_LAYOUT, 'today', 'latest', { x: 110, y: 180 }, rect)).toBe(at + 1);
	});
});
