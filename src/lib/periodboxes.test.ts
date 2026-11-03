import { describe, expect, it } from 'vitest';
import { addBox, boxLabel, boxWords, canAddBox, chooseBox, DEFAULT_BOXES, readBoxes, sameBox, type BoxChoice } from './periodboxes';

const week: BoxChoice = { kind: 'plain', period: 'week' };
const avgDay: BoxChoice = { kind: 'average', period: 'today' };

describe('readBoxes', () => {
	it('gives the default strip for nothing stored or nothing readable', () => {
		expect(readBoxes(undefined)).toEqual(DEFAULT_BOXES);
		expect(readBoxes([{ kind: 'sum', period: 'week' }, 'x'])).toEqual(DEFAULT_BOXES);
		expect(boxWords(DEFAULT_BOXES)).toBe('This week, This month, This quarter, This year, Lifetime');
	});

	it('keeps 3 to 5 boxes, None among them', () => {
		expect(readBoxes([week, null, avgDay])).toEqual([week, null, avgDay]);
		expect(readBoxes([week])).toEqual([week, null, null]);
		expect(readBoxes([week, week, week, week, week, avgDay])).toHaveLength(5);
		expect(readBoxes([week, { kind: 'average', period: 'decade' }, avgDay])).toEqual([week, avgDay, null]);
	});
});

describe('chooseBox and addBox', () => {
	it('None removes a box while more than 3 are left, and empties one at 3', () => {
		const four = [week, avgDay, week, avgDay];
		expect(chooseBox(four, 1, null)).toEqual([week, week, avgDay]);
		expect(chooseBox([week, avgDay, week], 0, null)).toEqual([null, avgDay, week]);
		expect(chooseBox([week, null, week], 1, avgDay)).toEqual([week, avgDay, week]);
	});

	it('adds an empty box up to 5', () => {
		const three = [week, week, week];
		expect(addBox(three)).toEqual([week, week, week, null]);
		const five = [week, week, week, week, week];
		expect(canAddBox(five)).toBe(false);
		expect(addBox(five)).toBe(five);
	});

	it('names the boxes', () => {
		expect(boxLabel(null)).toBe('None');
		expect(boxLabel(avgDay)).toBe('Average day');
		expect(boxLabel({ kind: 'average', period: 'lifetime' })).toBe('Average video');
		expect(sameBox(week, { kind: 'plain', period: 'week' })).toBe(true);
		expect(sameBox(week, avgDay)).toBe(false);
		expect(sameBox(null, null)).toBe(true);
	});
});
