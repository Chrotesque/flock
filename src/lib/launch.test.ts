import { describe, expect, it } from 'vitest';
import { covered, launchRate } from './launch';
import type { StatsSample } from './types';

const T = Date.parse('2026-09-05T10:00:00.000Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(T + minutes * MIN).toISOString();
const sample = (minutes: number, views: number): StatsSample => [at(minutes), views, 0, 0];

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
	const watching = [{ from: at(-60), to: at(240) }];

	it('settles on the first hour without a view', () => {
		const result = launchRate(
			{ published_at: at(0), views: 9, history: [sample(10, 5), sample(30, 9)] },
			watching,
			T + 120 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.views).toBe(9);
		expect(result.hours).toBeCloseTo(0.5);
		expect(result.rate).toBeCloseTo(18);
		expect(result.quietAt).toBe(at(30));
	});

	it('keeps running while views keep coming', () => {
		const result = launchRate(
			{ published_at: at(0), views: 9, history: [sample(10, 5), sample(30, 9)] },
			watching,
			T + 50 * MIN
		);
		expect(result.mode).toBe('running');
		if (result.mode !== 'running') return;
		expect(result.rate).toBeCloseTo(9 / (50 / 60));
	});

	it('does not settle while a later view is still possible', () => {
		// Views at +10 and +100: the gap between them is over an hour, so that
		// quiet hour is final even though the video moved again afterwards.
		const result = launchRate(
			{ published_at: at(0), views: 12, history: [sample(10, 5), sample(100, 12)] },
			watching,
			T + 130 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.quietAt).toBe(at(10));
		expect(result.views).toBe(5);
	});

	it('is zero for a video nobody watched in its first hour', () => {
		const result = launchRate({ published_at: at(0), views: 3, history: [sample(90, 3)] }, watching, T + 120 * MIN);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.rate).toBe(0);
		expect(result.quietAt).toBe(at(0));
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

	it('does not trust a quiet hour the worker slept through', () => {
		const patchy = [
			{ from: at(-60), to: at(20) },
			{ from: at(40), to: at(240) }
		];
		const result = launchRate(
			{ published_at: at(0), views: 5, history: [sample(10, 5)] },
			patchy,
			T + 240 * MIN
		);
		expect(result.mode).toBe('lifetime');
	});

	it('ignores samples from before release', () => {
		const result = launchRate(
			{ published_at: at(0), views: 4, history: [sample(-600, 0), sample(-300, 0), sample(5, 4)] },
			watching,
			T + 120 * MIN
		);
		expect(result.mode).toBe('settled');
		if (result.mode !== 'settled') return;
		expect(result.quietAt).toBe(at(5));
		expect(result.views).toBe(4);
	});

	it('has nothing to say before release', () => {
		expect(launchRate({ published_at: at(60), views: 0, history: [] }, watching, T).mode).toBe('none');
		expect(launchRate({ published_at: '', views: 0, history: [] }, watching, T).mode).toBe('none');
	});
});
