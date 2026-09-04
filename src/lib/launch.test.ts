import { describe, expect, it } from 'vitest';
import { covered, launchRate } from './launch';
import type { StatsSample } from './types';

const T = Date.parse('2026-09-05T10:00:00.000Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(T + minutes * MIN).toISOString();
const sample = (minutes: number, views: number): StatsSample => [at(minutes), views, 0, 0];

/** A history that gained `gains[h]` views in hour h, each landing mid-hour. */
function history(gains: number[]): StatsSample[] {
	let views = 0;
	const out: StatsSample[] = [];
	gains.forEach((gain, h) => {
		if (gain <= 0) return;
		views += gain;
		out.push(sample(h * 60 + 30, views));
	});
	return out;
}

const watching = [{ from: at(-60), to: at(60 * 80) }];
const burst = history([400, 500, 260, 5, 3, 2, 1, 2]);

describe('covered', () => {
	it('needs one run to span the whole range', () => {
		const runs = [
			{ from: at(-60), to: at(20) },
			{ from: at(40), to: at(200) }
		];
		expect(covered(runs, T, T + 10 * MIN)).toBe(true);
		expect(covered(runs, T, T + 100 * MIN)).toBe(false);
	});

	it('allows the poll interval at either end', () => {
		const runs = [{ from: at(1), to: at(59) }];
		expect(covered(runs, T, T + 60 * MIN)).toBe(false);
		expect(covered(runs, T, T + 60 * MIN, 2 * MIN)).toBe(true);
	});
});

describe('launchRate', () => {
	it('counts the first N hours and nothing else', () => {
		const result = launchRate(
			{ published_at: at(0), views: 1173, history: burst },
			watching,
			T + 8 * 60 * MIN,
			3
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.views).toBe(1160);
		expect(result.hours).toBe(3);
		expect(result.rate).toBeCloseTo(1160 / 3);
		expect(result.until).toBe(at(180));
	});

	it('reads differently for a different window', () => {
		const six = launchRate({ published_at: at(0), views: 1173, history: burst }, watching, T + 8 * 60 * MIN, 6);
		expect(six.mode).toBe('settled');
		if (six.mode !== 'settled') return;
		expect(six.views).toBe(1170);
		expect(six.rate).toBeCloseTo(1170 / 6);
	});

	it('keeps running until the window closes', () => {
		const result = launchRate(
			{ published_at: at(0), views: 900, history: history([400, 500]) },
			watching,
			T + 150 * MIN,
			3
		);
		expect(result.mode).toBe('running');
		if (result.mode !== 'running') return;
		expect(result.rate).toBeCloseTo(900 / 2.5);
		expect(result.hours).toBeCloseTo(2.5);
	});

	it('settles the moment the window closes', () => {
		const open = launchRate({ published_at: at(0), views: 1160, history: burst }, watching, T + 179 * MIN, 3);
		const closed = launchRate({ published_at: at(0), views: 1165, history: burst }, watching, T + 180 * MIN, 3);
		expect(open.mode).toBe('running');
		expect(closed.mode).toBe('settled');
	});

	it('falls back to a lifetime average when release was not watched', () => {
		const late = [{ from: at(300), to: at(400) }];
		const result = launchRate(
			{ published_at: at(0), views: 100, history: [sample(300, 100)] },
			late,
			T + 400 * MIN,
			3
		);
		expect(result.mode).toBe('lifetime');
		if (result.mode !== 'lifetime') return;
		expect(result.rate).toBeCloseTo(100 / (400 / 60));
	});

	it('does not trust a window the worker slept through', () => {
		const patchy = [
			{ from: at(-60), to: at(80) },
			{ from: at(100), to: at(600) }
		];
		const result = launchRate({ published_at: at(0), views: 1165, history: burst }, patchy, T + 6 * 60 * MIN, 3);
		expect(result.mode).toBe('lifetime');
	});

	it('ignores samples from before release', () => {
		const result = launchRate(
			{
				published_at: at(0),
				views: 905,
				history: [sample(-600, 0), sample(-300, 0), ...history([400, 500, 5])]
			},
			watching,
			T + 4 * 60 * MIN,
			3
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.views).toBe(905);
	});

	it('has nothing to say before release or without a window', () => {
		expect(launchRate({ published_at: at(60), views: 0, history: [] }, watching, T, 3).mode).toBe('none');
		expect(launchRate({ published_at: '', views: 0, history: [] }, watching, T, 3).mode).toBe('none');
		expect(launchRate({ published_at: at(0), views: 5, history: [] }, watching, T + 60 * MIN, 0).mode).toBe('none');
	});
});
