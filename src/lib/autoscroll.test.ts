import { describe, expect, it } from 'vitest';
import { edgeVelocity, EDGE_PX, MAX_STEP_PX } from './autoscroll';

describe('edgeVelocity', () => {
	const top = 100;
	const bottom = 500;

	it('is still in the middle', () => {
		expect(edgeVelocity(300, top, bottom)).toBe(0);
		expect(edgeVelocity(top + EDGE_PX, top, bottom)).toBe(0);
		expect(edgeVelocity(bottom - EDGE_PX, top, bottom)).toBe(0);
	});

	it('creeps just inside the zone and runs at the edge', () => {
		expect(edgeVelocity(bottom - EDGE_PX + 1, top, bottom)).toBeCloseTo(MAX_STEP_PX / EDGE_PX);
		expect(edgeVelocity(bottom, top, bottom)).toBe(MAX_STEP_PX);
		expect(edgeVelocity(top, top, bottom)).toBe(-MAX_STEP_PX);
	});

	it('scrolls up near the top and down near the bottom', () => {
		expect(edgeVelocity(top + 10, top, bottom)).toBeLessThan(0);
		expect(edgeVelocity(bottom - 10, top, bottom)).toBeGreaterThan(0);
	});

	it('does not exceed full speed past the edge', () => {
		expect(edgeVelocity(bottom + 40, top, bottom)).toBe(MAX_STEP_PX);
		expect(edgeVelocity(top - 40, top, bottom)).toBe(-MAX_STEP_PX);
	});

	it('has nothing to say for a degenerate box', () => {
		expect(edgeVelocity(10, 50, 50)).toBe(0);
		expect(edgeVelocity(10, 0, 100, 0)).toBe(0);
	});
});
