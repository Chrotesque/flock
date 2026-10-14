import { describe, expect, it } from 'vitest';
import { isMoving, landReason, lockReason, moveRefusal, type MovablePost } from './reschedule';

const now = Date.parse('2026-10-14T20:00:00Z');
const minutes = (n: number) => new Date(now + n * 60_000).toISOString();
const post = (over: Partial<MovablePost> = {}): MovablePost => ({
	platform: 'instagram',
	status: 'pending',
	scheduled_at: minutes(120),
	...over
});

describe('lockReason', () => {
	it('lets an upcoming post flock still holds move', () => {
		expect(lockReason(post(), now)).toBe('');
		expect(lockReason(post({ platform: 'youtube' }), now)).toBe('');
		expect(lockReason(post({ platform: 'facebook', scheduled_at: minutes(60 * 24 * 40) }), now)).toBe('');
	});

	it('locks an Instagram or TikTok post the worker is about to take up, or has', () => {
		expect(lockReason(post({ scheduled_at: minutes(9) }), now)).toMatch(/any moment/);
		expect(lockReason(post({ scheduled_at: minutes(12) }), now)).toBe('');
		expect(lockReason(post({ platform: 'tiktok', scheduled_at: minutes(0.5) }), now)).toMatch(/any moment/);
		expect(lockReason(post({ status: 'publishing' }), now)).toMatch(/takes it as it is/);
	});

	it('lets a YouTube video or Facebook reel the platform holds move, until its last 15 minutes', () => {
		expect(lockReason(post({ platform: 'youtube', status: 'scheduled' }), now)).toBe('');
		expect(lockReason(post({ platform: 'facebook', status: 'scheduled', scheduled_at: minutes(14) }), now)).toMatch(
			/within 15 minutes/
		);
		expect(lockReason(post({ platform: 'youtube', status: 'scheduled', handle: { released: true } }), now)).toMatch(
			/out already/
		);
		expect(lockReason(post({ platform: 'youtube', status: 'publishing' }), now)).toMatch(/being uploaded/);
	});

	it('locks history, and lets a failed post move for its retry', () => {
		expect(lockReason(post({ status: 'published' }), now)).toMatch(/out on Instagram/);
		expect(lockReason(post({ status: 'cancelled' }), now)).toMatch(/cancelled/);
		expect(lockReason(post({ scheduled_at: minutes(-5) }), now)).toMatch(/passed/);
		expect(lockReason(post({ status: 'failed', scheduled_at: minutes(-60) }), now)).toBe('');
	});
});

describe('landReason', () => {
	it('wants at least 15 minutes ahead', () => {
		expect(landReason(post(), new Date(now + 14 * 60_000), now)).toMatch(/15 minutes/);
		expect(landReason(post(), new Date(now - 3_600_000), now)).toMatch(/15 minutes/);
		expect(landReason(post(), new Date(now + 15 * 60_000), now)).toBe('');
	});

	it('keeps a reel Facebook holds within its reach', () => {
		const far = new Date(now + 29 * 24 * 3_600_000);
		expect(landReason(post({ platform: 'facebook', status: 'scheduled' }), far, now)).toMatch(/28 days/);
		// Not yet uploaded, the worker hands it over once it is within reach.
		expect(landReason(post({ platform: 'facebook' }), far, now)).toBe('');
		expect(landReason(post({ platform: 'youtube', status: 'scheduled' }), far, now)).toBe('');
	});
});

describe('isMoving and moveRefusal', () => {
	const at = minutes(300);
	it('is moving while the time differs from the one the platform holds', () => {
		expect(isMoving(post({ platform: 'youtube', status: 'scheduled', scheduled_at: at, handle: { release: minutes(200) } }))).toBe(true);
		expect(
			isMoving(post({ platform: 'youtube', status: 'scheduled', scheduled_at: at.replace('T', ' '), handle: { release: at } }))
		).toBe(false);
		// Nothing kept yet (an upload from before), or a post flock holds: never moving.
		expect(isMoving(post({ platform: 'facebook', status: 'scheduled', scheduled_at: at, handle: {} }))).toBe(false);
		expect(isMoving(post({ scheduled_at: at, handle: { release: minutes(1) } }))).toBe(false);
	});

	it('shows a refusal for a day', () => {
		const refused = post({ handle: { moveError: 'YouTube said no', moveErrorAt: minutes(-60) } });
		expect(moveRefusal(refused, now)).toBe('YouTube said no');
		expect(moveRefusal(refused, now + 2 * 86_400_000)).toBe('');
		expect(moveRefusal(post(), now)).toBe('');
	});
});
