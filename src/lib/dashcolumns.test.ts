import { describe, expect, it } from 'vitest';
import {
	COLUMN_ORDER,
	DEFAULT_COLUMNS,
	RATIO_COLUMNS,
	columnWords,
	ratioColumns,
	ratioOff,
	ratioTemplate,
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
		expect(gridTemplate(shown, 'wide')).toBe(
			'var(--thumbcol) minmax(0, 1fr) max-content max-content max-content max-content max-content 156px max-content'
		);
		expect(gridTemplate(shown, 'mid')).toBe('var(--thumbcol) minmax(0, 1fr) 84px 104px 132px 112px');
		expect(columnsAt(shown, 'mid')).toEqual(['thumb', 'video', 'followers', 'views', 'curve', 'usual']);
		expect(gridTemplate(shown, 'narrow')).toBe('var(--thumbcol) minmax(0, 1fr) 96px 76px');
	});

	it('draws the Ratio View set whatever the layout, the thumbnail as the layout has it', () => {
		const layout = setShown(moveBefore(DEFAULT_COLUMNS, 'usual', 'jestr'), 'likes', false);
		expect(ratioColumns(layout)).toEqual(['thumb', 'video', 'views', 'likes', 'comments', 'skip', 'usual']);
		expect(ratioColumns(setShown(DEFAULT_COLUMNS, 'thumb', false))).toEqual(['video', ...RATIO_COLUMNS]);
	});

	it('gives Ratio View a track per platform, a line after the views, likes and comments, and keeps the ratios longest', () => {
		const ids = ratioColumns(DEFAULT_COLUMNS);
		const slots = { views: 4, likes: 4, comments: 4, skip: 2, usual: 4 };
		expect(ratioTemplate(ids, slots, 'wide')).toBe(
			'var(--thumbcol) minmax(max-content, 1fr) repeat(4, max-content) 1px repeat(4, max-content) 1px repeat(4, max-content) 1px repeat(2, max-content) repeat(4, max-content)'
		);
		// No line after the last column.
		expect(ratioTemplate(ids, slots, 'mid')).toBe(
			'var(--thumbcol) minmax(max-content, 1fr) repeat(4, max-content) 1px repeat(4, max-content) 1px repeat(4, max-content)'
		);
		expect(ratioTemplate(ids, { views: 0 }, 'narrow')).toBe('var(--thumbcol) minmax(max-content, 1fr) repeat(1, max-content) 1px repeat(1, max-content)');
		expect(ratioOff('skip', 'mid')).toBe(true);
		expect(ratioOff('video', 'narrow')).toBe(false);
	});

	it('says a layout in words', () => {
		expect(columnWords(setShown(moveBefore(DEFAULT_COLUMNS, 'views', 'jestr'), 'skip', false))).toBe(
			'Thumbnail, Video, Views, Jestr, Followers, Likes, Comments, From release, vs usual (hidden: Skipped)'
		);
	});
});
