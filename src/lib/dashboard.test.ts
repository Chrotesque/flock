import { describe, expect, it } from 'vitest';
import { ago, upcoming, type DashTarget } from './dashboard';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = new Date(2026, 9, 14, 15, 0); // Wed 14 Oct 2026, 15:00 local
const now = NOW.getTime();

const target = (over: Partial<DashTarget>): DashTarget => ({
	id: 't',
	job: 'j',
	platform: 'tiktok',
	status: 'pending',
	scheduled_at: iso(now + H),
	title: 'Clip',
	visibility: '',
	jobTitle: 'Clip',
	jobCreated: iso(now - 2 * H),
	importing: false,
	jobError: '',
	...over
});

describe('upcoming', () => {
	it('lists the next days with their posts in order, empty days kept', () => {
		const days = upcoming(
			[
				target({ id: 'b', scheduled_at: iso(new Date(2026, 9, 15, 18).getTime()) }),
				target({ id: 'a', scheduled_at: iso(new Date(2026, 9, 15, 9).getTime()) }),
				target({ id: 'past', scheduled_at: iso(now - H) }),
				target({ id: 'done', status: 'published', scheduled_at: iso(now + H) }),
				target({ id: 'far', scheduled_at: iso(new Date(2026, 9, 22, 9).getTime()) })
			],
			NOW
		);
		expect(days).toHaveLength(7);
		expect(days[0].posts).toEqual([]);
		expect(days[1].posts.map((p) => p.id)).toEqual(['a', 'b']);
		expect(days.flatMap((d) => d.posts).map((p) => p.id)).toEqual(['a', 'b']);
	});
});

describe('ago', () => {
	it('words a span', () => {
		expect(ago(12 * 60_000)).toBe('12 min');
		expect(ago(3 * H)).toBe('3 h');
		expect(ago(72 * H)).toBe('3 days');
	});
});
