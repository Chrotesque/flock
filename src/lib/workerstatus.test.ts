import { describe, expect, it } from 'vitest';
import { ago, dialogHost, workerView, STALE_MS, type WorkerBeat } from './workerstatus';

const now = Date.parse('2026-10-04T12:00:00Z');
const beat = (role: WorkerBeat['role'], msAgo: number, extra: Partial<WorkerBeat> = {}): WorkerBeat => ({
	role,
	beatAt: new Date(now - msAgo).toISOString(),
	...extra
});

describe('workerView', () => {
	it('shows one red dot when no worker was ever seen', () => {
		const view = workerView({}, now);
		expect(view.dots.map((d) => [d.role, d.state])).toEqual([['all', 'down']]);
		expect(view.lines).toEqual([{ text: 'Not running' }]);
	});

	it('shows one dot for a setup without a NAS', () => {
		const view = workerView({ all: beat('all', 5000) }, now);
		expect(view.dots.map((d) => [d.role, d.state])).toEqual([['all', 'up']]);
		expect(view.lines).toEqual([{ text: 'Idle' }]);
	});

	it('shows two dots, PC left and NAS right, once a split worker is the newest', () => {
		const view = workerView({ all: beat('all', 3_600_000), local: beat('local', 5000), nas: beat('nas', 5000) }, now);
		expect(view.dots.map((d) => [d.role, d.state])).toEqual([
			['local', 'up'],
			['nas', 'up']
		]);
	});

	it('names the build each worker runs, where its beat says', () => {
		const view = workerView(
			{
				local: beat('local', 5000, { host: 'Studio-PC', version: '0.13.4' }),
				nas: beat('nas', STALE_MS + 60_000, { host: 'nas-box', version: 'dev' })
			},
			now
		);
		expect(view.dots[0].title).toBe('PC worker on Studio-PC (v0.13.4): running');
		expect(view.dots[1].title).toMatch(/^NAS worker on nas-box \(dev\): not running/);
		expect(workerView({ all: beat('all', 5000, { host: 'Desk' }) }, now).dots[0].title).toMatch(/on Desk: running$/);
	});

	it('marks the PC dot as covering while the NAS is down', () => {
		const view = workerView(
			{ local: beat('local', 5000, { covering: true }), nas: beat('nas', STALE_MS + 60_000) },
			now
		);
		expect(view.dots.map((d) => d.state)).toEqual(['covering', 'down']);
		expect(view.lines[0].text).toBe('PC covering for the NAS');
	});

	it('lists what every running worker is doing', () => {
		const view = workerView(
			{
				local: beat('local', 5000, { doing: [{ text: 'Copying "a" to the NAS' }] }),
				nas: beat('nas', 5000, { doing: [{ text: 'Publishing to TikTok: "b"', until: '2026-10-04T21:30:00Z' }] })
			},
			now
		);
		expect(view.lines.map((l) => l.text)).toEqual(['Copying "a" to the NAS', 'Publishing to TikTok: "b"']);
		expect(view.lines[1].until).toBe('2026-10-04T21:30:00Z');
	});

	it('says when nothing is running and when it was last seen', () => {
		const view = workerView({ local: beat('local', 2 * 3_600_000), nas: beat('nas', 3 * 3_600_000) }, now);
		expect(view.dots.map((d) => d.state)).toEqual(['down', 'down']);
		expect(view.lines).toEqual([{ text: 'Not running · last seen 2 h ago' }]);
	});

	it('treats a worker that said it stopped as down at once', () => {
		const view = workerView({ all: beat('all', 1000, { stoppedAt: new Date(now - 1000).toISOString() }) }, now);
		expect(view.dots[0].state).toBe('down');
	});
});

describe('ago', () => {
	it('words an age coarsely', () => {
		expect(ago(20_000)).toBe('just now');
		expect(ago(4 * 60_000)).toBe('4 min ago');
		expect(ago(3 * 3_600_000)).toBe('3 h ago');
		expect(ago(72 * 3_600_000)).toBe('3 d ago');
	});
});

describe('dialogHost', () => {
	const now = Date.parse('2026-10-11T21:00:00Z');
	const beat = (role: WorkerBeat['role'], ageMs: number, extra: Partial<WorkerBeat> = {}): WorkerBeat => ({
		role,
		beatAt: new Date(now - ageMs).toISOString(),
		...extra
	});

	it("names the PC worker's machine", () => {
		expect(dialogHost({ local: beat('local', 5000, { host: 'Studio-PC' }), nas: beat('nas', 5000, { host: 'nas-box' }) }, now)).toBe('Studio-PC');
	});

	it('falls back to a lone all worker', () => {
		expect(dialogHost({ all: beat('all', 5000, { host: 'Desk' }) }, now)).toBe('Desk');
	});

	it('is null when no worker that opens dialogs is running', () => {
		expect(dialogHost({ local: beat('local', STALE_MS + 1000, { host: 'Studio-PC' }), nas: beat('nas', 1000) }, now)).toBeNull();
		expect(dialogHost({ local: beat('local', 1000, { host: 'Studio-PC', stoppedAt: new Date(now).toISOString() }) }, now)).toBeNull();
	});
});
