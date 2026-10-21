import { describe, expect, it } from 'vitest';
import { clashing, hourKey, takenHours, takenWhy, type SlotPost } from './takenhours';

// Local times throughout, so the tests hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const now = new Date(2026, 9, 22, 10, 20).getTime();

const post = (over: Partial<SlotPost> = {}): SlotPost => ({
	id: 't1',
	job: 'j1',
	platform: 'youtube',
	status: 'pending',
	scheduled_at: at(23, 18, 30),
	title: 'LANTERN FIELD',
	description: '',
	brand: 'b1',
	...over
});

describe('takenHours', () => {
	it("holds the hour of each of the brand's posts, in local time", () => {
		const taken = takenHours([post(), post({ id: 't2', platform: 'instagram', scheduled_at: at(23, 18, 45) })], 'b1', {
			now
		});
		expect([...taken.keys()]).toEqual([hourKey('2026-10-23', 18)]);
		expect(taken.get('2026-10-23#18')).toHaveLength(2);
	});

	it("leaves out another brand's posts, cancelled ones and the upload's own jobs", () => {
		const posts = [
			post({ brand: 'b2' }),
			post({ id: 't2', status: 'cancelled' }),
			post({ id: 't3', job: 'mine' })
		];
		expect(takenHours(posts, 'b1', { now, exclude: ['mine'] }).size).toBe(0);
		expect(takenHours([post()], '', { now }).size).toBe(0);
	});

	it('keeps a failed post, since Retry sends it at its slot', () => {
		expect(takenHours([post({ status: 'failed' })], 'b1', { now }).size).toBe(1);
	});

	it('drops an hour that is over, but keeps the one we are in', () => {
		const posts = [
			post({ id: 'over', scheduled_at: at(22, 9, 59), status: 'published' }),
			post({ id: 'this', job: 'j2', scheduled_at: at(22, 10, 5), status: 'published' })
		];
		expect([...takenHours(posts, 'b1', { now }).keys()]).toEqual(['2026-10-22#10']);
	});
});

describe('takenWhy', () => {
	it('names the video and when it goes out', () => {
		expect(takenWhy([post(), post({ id: 't2', platform: 'instagram', scheduled_at: at(23, 18, 45) })])).toBe(
			'This hour is taken: “LANTERN FIELD” goes out at 18:30.'
		);
	});

	it('lists several videos by time, a caption standing in for a missing title', () => {
		const posts = [
			post({ job: 'j2', scheduled_at: at(23, 18, 50), title: '', description: 'Sponsored – a long first line of a caption here\nmore' }),
			post()
		];
		expect(takenWhy(posts)).toBe(
			'This hour is taken: “LANTERN FIELD” goes out at 18:30, “Sponsored – a long first line of a capt…” at 18:50.'
		);
		expect(takenWhy([post({ title: '', description: '' })])).toBe('This hour is taken: a video goes out at 18:30.');
	});
});

describe('clashing', () => {
	it('names the platforms whose slot falls in a taken hour', () => {
		const taken = takenHours([post()], 'b1', { now });
		const slots = [
			{ platform: 'youtube' as const, date: '2026-10-23', time: '18:00' },
			{ platform: 'tiktok' as const, date: '2026-10-23', time: '19:00' },
			{ platform: 'instagram' as const, date: '2026-10-24', time: '18:15' }
		];
		expect(clashing(slots, taken)).toEqual(['youtube']);
	});
});
