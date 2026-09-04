import { describe, expect, it } from 'vitest';
import { covered, launchEnd, launchRate, LAUNCH_CAP_HOURS } from './launch';
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

describe('launchEnd', () => {
	it('is the first hour under a tenth of the best', () => {
		expect(launchEnd([400, 500, 260, 5])).toBe(3);
		expect(launchEnd([400, 500, 260, 51, 49])).toBe(4);
		expect(launchEnd([400, 500, 260, 50, 49])).toBe(3);
	});

	it('is not reached while the hours keep climbing', () => {
		expect(launchEnd([400, 500])).toBe(-1);
		expect(launchEnd([100, 200, 300])).toBe(-1);
	});

	it('waits for a real burst rather than settling on a quiet start', () => {
		expect(launchEnd([0, 0, 300, 20])).toBe(3);
		expect(launchEnd([3, 0, 0])).toBe(-1);
	});
});

describe('launchRate', () => {
	it('settles on the burst and ignores the trickle after it', () => {
		const result = launchRate(
			{ published_at: at(0), views: 1173, history: history([400, 500, 260, 5, 3, 2, 1, 2]) },
			watching,
			T + 8 * 60 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.views).toBe(1160);
		expect(result.hours).toBe(3);
		expect(result.rate).toBeCloseTo(1160 / 3);
		expect(result.until).toBe(at(180));
	});

	it('keeps running while the burst is still going', () => {
		const result = launchRate(
			{ published_at: at(0), views: 900, history: history([400, 500]) },
			watching,
			T + 150 * MIN
		);
		expect(result.mode).toBe('running');
		if (result.mode !== 'running') return;
		expect(result.rate).toBeCloseTo(900 / 2.5);
	});

	it('settles even when the views never quite stop', () => {
		const result = launchRate(
			{ published_at: at(0), views: 1215, history: history([400, 500, 260, 30, 25]) },
			watching,
			T + 5 * 60 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.hours).toBe(3);
		expect(result.views).toBe(1160);
	});

	it('does not settle on a slow start before the burst arrives', () => {
		const result = launchRate(
			{ published_at: at(0), views: 320, history: history([0, 0, 300, 20]) },
			watching,
			T + 4 * 60 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.hours).toBe(3);
		expect(result.views).toBe(300);
	});

	it('gives up waiting for a burst after two days', () => {
		const gains = Array.from({ length: 50 }, () => 10);
		const result = launchRate(
			{ published_at: at(0), views: 500, history: history(gains) },
			watching,
			T + 50 * 60 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.hours).toBe(LAUNCH_CAP_HOURS);
		expect(result.views).toBe(480);
		expect(result.rate).toBeCloseTo(10);
	});

	it('falls back to a lifetime average when release was not watched', () => {
		const late = [{ from: at(300), to: at(400) }];
		const result = launchRate(
			{ published_at: at(0), views: 100, history: [sample(300, 100)] },
			late,
			T + 400 * MIN
		);
		expect(result.mode).toBe('lifetime');
		if (result.mode !== 'lifetime') return;
		expect(result.rate).toBeCloseTo(100 / (400 / 60));
	});

	it('does not trust a fade the worker slept through', () => {
		const patchy = [
			{ from: at(-60), to: at(80) },
			{ from: at(100), to: at(600) }
		];
		const result = launchRate(
			{ published_at: at(0), views: 1165, history: history([400, 500, 260, 5]) },
			patchy,
			T + 6 * 60 * MIN
		);
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
			T + 4 * 60 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.hours).toBe(2);
		expect(result.views).toBe(900);
	});

	it('has nothing to say before release', () => {
		expect(launchRate({ published_at: at(60), views: 0, history: [] }, watching, T).mode).toBe('none');
		expect(launchRate({ published_at: '', views: 0, history: [] }, watching, T).mode).toBe('none');
	});
});
