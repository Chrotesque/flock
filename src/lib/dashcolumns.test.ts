import { describe, expect, it } from 'vitest';
import {
	COLUMN_ORDER,
	DEFAULT_COLUMNS,
	columnWords,
	columnsAt,
	gridTemplate,
	moveBefore,
	moveBy,
	readColumns,
	setShown,
	shownColumns,
	type DashColumn
} from './dashcolumns';

const ids = (columns: DashColumn[]) => columns.map((c) => c.id);

describe('readColumns', () => {
	it('starts from the default with nothing stored', () => {
		expect(readColumns(undefined)).toEqual(DEFAULT_COLUMNS);
		expect(readColumns('junk')).toEqual(DEFAULT_COLUMNS);
	});

	it('keeps a stored order and what was hidden, dropping unknown and doubled columns', () => {
		const read = readColumns([
			{ id: 'thumb', on: false },
			{ id: 'video', on: true },
			{ id: 'views', on: true },
			{ id: 'followers', on: false },
			{ id: 'views', on: false },
			{ id: 'nonsense', on: true },
			{ id: 'usual' },
			{ id: 'curve', on: true },
			{ id: 'skip', on: true },
			{ id: 'comments', on: true },
			{ id: 'likes', on: true },
			{ id: 'jestr', on: true }
		]);
		expect(ids(read)).toEqual(['thumb', 'video', 'views', 'followers', 'usual', 'curve', 'skip', 'comments', 'likes', 'jestr']);
		expect(read.find((c) => c.id === 'thumb')?.on).toBe(false);
		expect(read.find((c) => c.id === 'followers')?.on).toBe(false);
		expect(read.find((c) => c.id === 'usual')?.on).toBe(true);
	});

	it('puts a column flock added since after the one it follows by default', () => {
		const before = COLUMN_ORDER.filter((id) => id !== 'followers').map((id) => ({ id, on: true }));
		expect(ids(readColumns(before))).toEqual(COLUMN_ORDER);
	});

	it('keeps the thumbnail and the title in front, the title shown', () => {
		const read = readColumns([
			{ id: 'views', on: true },
			{ id: 'video', on: false },
			{ id: 'thumb', on: true }
		]);
		expect(ids(read).slice(0, 3)).toEqual(['thumb', 'video', 'views']);
		expect(read[1].on).toBe(true);
	});
});

describe('moving and hiding', () => {
	it('moves a column before another, or to the end', () => {
		expect(ids(moveBefore(DEFAULT_COLUMNS, 'usual', 'followers')).slice(2, 5)).toEqual(['jestr', 'usual', 'followers']);
		expect(ids(moveBefore(DEFAULT_COLUMNS, 'jestr', null)).at(-1)).toBe('jestr');
	});

	it('never moves the leading pair, nor anything in front of them', () => {
		expect(moveBefore(DEFAULT_COLUMNS, 'video', null)).toBe(DEFAULT_COLUMNS);
		expect(ids(moveBefore(DEFAULT_COLUMNS, 'views', 'thumb')).slice(0, 3)).toEqual(['thumb', 'video', 'views']);
		expect(moveBy(DEFAULT_COLUMNS, 'jestr', -1)).toBe(DEFAULT_COLUMNS);
		expect(moveBy(DEFAULT_COLUMNS, 'usual', 1)).toBe(DEFAULT_COLUMNS);
		expect(ids(moveBy(DEFAULT_COLUMNS, 'followers', 1)).slice(3, 5)).toEqual(['views', 'followers']);
	});

	it('hides any column but the title', () => {
		expect(setShown(DEFAULT_COLUMNS, 'likes', false).find((c) => c.id === 'likes')?.on).toBe(false);
		expect(setShown(DEFAULT_COLUMNS, 'video', false)).toBe(DEFAULT_COLUMNS);
	});
});

describe('the grid', () => {
	it('draws the shown columns, Jestr only with the integration', () => {
		const layout = setShown(DEFAULT_COLUMNS, 'likes', false);
		expect(shownColumns(layout, { jestr: false })).toEqual(['thumb', 'video', 'followers', 'views', 'comments', 'skip', 'curve', 'usual']);
		expect(shownColumns(layout, { jestr: true })).toContain('jestr');
	});

	it('gives each size its widths, leaving out what a narrow list drops', () => {
		const shown = shownColumns(DEFAULT_COLUMNS, { jestr: false });
		expect(gridTemplate(shown, 'wide')).toBe('var(--thumbcol) minmax(0, 1fr) 96px 130px 106px 106px 84px 156px 164px');
		expect(columnsAt(shown, 'mid')).toEqual(['thumb', 'video', 'followers', 'views', 'curve', 'usual']);
		expect(gridTemplate(shown, 'narrow')).toBe('var(--thumbcol) minmax(0, 1fr) 96px 76px');
	});

	it('says a layout in words', () => {
		expect(columnWords(setShown(moveBefore(DEFAULT_COLUMNS, 'views', 'jestr'), 'skip', false))).toBe(
			'Thumbnail, Video, Views, Jestr, Followers, Likes, Comments, From release, vs usual (hidden: Skipped)'
		);
	});
});
