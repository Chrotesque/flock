import { describe, expect, it } from 'vitest';
import { actionPlan, groupRefusal, readRequest, type ActionPost } from './postactions';

const now = Date.parse('2026-10-15T08:00:00Z');
const minutes = (n: number) => new Date(now + n * 60_000).toISOString();
const post = (over: Partial<ActionPost> = {}): ActionPost => ({
	platform: 'instagram',
	status: 'pending',
	scheduled_at: minutes(120),
	...over
});

describe('actionPlan', () => {
	it('lets the page release or delete a post flock still holds', () => {
		expect(actionPlan('release', post(), now)).toEqual({ by: 'page' });
		expect(actionPlan('delete', post(), now)).toEqual({ by: 'page' });
		// Within Instagram's lead too: until the worker has claimed it, it is flock's.
		expect(actionPlan('release', post({ scheduled_at: minutes(5) }), now)).toEqual({ by: 'page' });
		expect(actionPlan('release', post({ status: 'failed', scheduled_at: minutes(-60) }), now)).toEqual({ by: 'page' });
		expect(actionPlan('delete', post({ status: 'cancelled' }), now)).toEqual({ by: 'page' });
	});

	it('asks the worker for a post YouTube or Facebook holds, until its last minutes', () => {
		expect(actionPlan('release', post({ platform: 'youtube', status: 'scheduled' }), now)).toEqual({ by: 'worker' });
		expect(actionPlan('delete', post({ platform: 'facebook', status: 'scheduled' }), now)).toEqual({ by: 'worker' });
		expect(actionPlan('delete', post({ platform: 'facebook', status: 'scheduled', scheduled_at: minutes(1) }), now)).toEqual({
			refused: 'Facebook puts it out within minutes; too late to change it here.'
		});
	});

	it('refuses what is out, in hand, or already asked for', () => {
		expect(actionPlan('delete', post({ status: 'published' }), now)).toEqual({ refused: 'It is out on Instagram already; delete it there.' });
		expect(actionPlan('release', post({ status: 'publishing' }), now)).toMatchObject({ refused: expect.stringMatching(/takes it as it is/) });
		expect(actionPlan('release', post({ scheduled_at: minutes(-1) }), now)).toMatchObject({ refused: expect.stringMatching(/passed/) });
		expect(actionPlan('release', post({ status: 'cancelled' }), now)).toEqual({ refused: 'It was cancelled.' });
		expect(actionPlan('delete', post({ request: { kind: 'delete' } }), now)).toEqual({ refused: 'The worker is on it already.' });
		expect(actionPlan('release', post({ platform: 'youtube', status: 'scheduled', handle: { released: true } }), now)).toMatchObject({
			refused: expect.stringMatching(/out on YouTube/)
		});
	});
});

describe('groupRefusal and readRequest', () => {
	it('names the post that holds a group back', () => {
		const group = [post({ platform: 'youtube', status: 'scheduled' }), post({ status: 'published' })];
		expect(groupRefusal('release', group, now)).toBe('Instagram: It is out on Instagram already.');
		expect(groupRefusal('release', [post()], now)).toBe('');
	});

	it('reads a request field by field', () => {
		expect(readRequest({ kind: 'release', requestedAt: 'x', by: 'PC' })).toEqual({ kind: 'release', requestedAt: 'x', by: 'PC' });
		expect(readRequest({ kind: 'nope' })).toBeNull();
		expect(readRequest(null)).toBeNull();
	});
});
