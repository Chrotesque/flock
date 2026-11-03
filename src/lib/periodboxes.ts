/**
 * The Dashboard's strip of period boxes, as each profile chooses it
 * (`general.dashboardPeriods`): 3 to 5 boxes, each showing a period's plain
 * numbers (releases.ts `statsOfPeriod`), an average period's
 * (`periodAverage`), or nothing. Picking None for a box removes it while
 * more than 3 are left, and empties it at 3; the + adds an empty one.
 */
import { DEFAULT_PERIODS, PERIOD_KEYS, PERIOD_LABELS, type PeriodKey } from './releases';

export type BoxKind = 'plain' | 'average';

export interface PeriodBox {
	kind: BoxKind;
	period: PeriodKey;
}

/** A box's choice; null is None. */
export type BoxChoice = PeriodBox | null;

export const MIN_BOXES = 3;
export const MAX_BOXES = 5;

export const DEFAULT_BOXES: BoxChoice[] = DEFAULT_PERIODS.map((period) => ({ kind: 'plain', period }));

/** An average box's heading, and its entry under Averages in the menu. */
export const AVERAGE_LABELS: Record<PeriodKey, string> = {
	today: 'Average day',
	week: 'Average week',
	month: 'Average month',
	quarter: 'Average quarter',
	year: 'Average year',
	lifetime: 'Average video'
};

/** What an average is per, after a number: "videos a week". */
export const AVERAGE_PER: Record<PeriodKey, string> = {
	today: 'a day',
	week: 'a week',
	month: 'a month',
	quarter: 'a quarter',
	year: 'a year',
	lifetime: 'a video'
};

export function boxLabel(choice: BoxChoice): string {
	if (!choice) return 'None';
	return choice.kind === 'average' ? AVERAGE_LABELS[choice.period] : PERIOD_LABELS[choice.period];
}

function readBox(value: unknown): BoxChoice | undefined {
	if (value === null) return null;
	if (typeof value !== 'object') return undefined;
	const { kind, period } = value as Record<string, unknown>;
	if ((kind !== 'plain' && kind !== 'average') || !PERIOD_KEYS.includes(period as PeriodKey)) return undefined;
	return { kind, period: period as PeriodKey };
}

/**
 * A stored strip, rebuilt: what is not a box is dropped, past 5 cut, short of
 * 3 filled with empty boxes. Nothing stored, or nothing readable, is the
 * default strip.
 */
export function readBoxes(value: unknown): BoxChoice[] {
	if (!Array.isArray(value)) return DEFAULT_BOXES.map((b) => b && { ...b });
	const boxes = value.map(readBox).filter((b): b is BoxChoice => b !== undefined).slice(0, MAX_BOXES);
	if (boxes.length === 0) return DEFAULT_BOXES.map((b) => b && { ...b });
	while (boxes.length < MIN_BOXES) boxes.push(null);
	return boxes;
}

/** The strip with box `index` showing `choice`; None removes it while more than 3 are left. */
export function chooseBox(boxes: BoxChoice[], index: number, choice: BoxChoice): BoxChoice[] {
	if (index < 0 || index >= boxes.length) return boxes;
	if (choice === null && boxes.length > MIN_BOXES) return boxes.filter((_, i) => i !== index);
	return boxes.map((b, i) => (i === index ? choice && { ...choice } : b));
}

export function canAddBox(boxes: BoxChoice[]): boolean {
	return boxes.length < MAX_BOXES;
}

/** The strip with an empty box added at its end, to be chosen. */
export function addBox(boxes: BoxChoice[]): BoxChoice[] {
	return canAddBox(boxes) ? [...boxes, null] : boxes;
}

export function sameBox(a: BoxChoice, b: BoxChoice): boolean {
	return a === b || (a !== null && b !== null && a.kind === b.kind && a.period === b.period);
}

/** The strip in words, for the log. */
export function boxWords(boxes: BoxChoice[]): string {
	return boxes.map(boxLabel).join(', ');
}
