import { describe, expect, it } from 'vitest';
import { onTikTokAccount, tiktokReportOf, tiktokStateOf } from './tiktokaccount';
import type { FollowerState } from './followers';

const chosen = { account_id: 'open-prod', handle: 'owlsnest' };

const state = (account: string, name: string, at: string, count = 10): FollowerState => ({
	platform: 'tiktok',
	account,
	name,
	count,
	at,
	since: at,
	history: [[at, count]],
	credits: {},
	analytics: null,
	analyticsThrough: ''
});

describe('onTikTokAccount', () => {
	it('takes a video under the open id, or under the handle when the id is another app key’s', () => {
		expect(onTikTokAccount({ account: 'open-prod' }, chosen)).toBe(true);
		expect(onTikTokAccount({ account: 'open-sandbox', handle: 'OwlsNest' }, chosen)).toBe(true);
		expect(onTikTokAccount({ account: 'open-sandbox', handle: 'papermoon' }, chosen)).toBe(false);
	});

	it('matches nothing by an empty handle', () => {
		expect(onTikTokAccount({ account: 'x', handle: '' }, { account_id: 'y', handle: '' })).toBe(false);
	});
});

describe('tiktokStateOf', () => {
	it('prefers the record under the open id', () => {
		const states = [state('open-sandbox', '@owlsnest', '2026-10-20T12:00:00Z', 5), state('open-prod', '@owlsnest', '2026-10-19T12:00:00Z', 7)];
		expect(tiktokStateOf(states, chosen)?.account).toBe('open-prod');
	});

	it('falls back to the newest record under the handle, never another platform’s', () => {
		const states = [
			state('open-old', '@owlsnest', '2026-10-18T12:00:00Z'),
			state('open-sandbox', '@OwlsNest', '2026-10-20T12:00:00Z'),
			{ ...state('ig', '@owlsnest', '2026-10-21T12:00:00Z'), platform: 'instagram' as const }
		];
		expect(tiktokStateOf(states, chosen)?.account).toBe('open-sandbox');
		expect(tiktokStateOf(states, { account_id: 'z', handle: '' })).toBeUndefined();
	});
});

describe('tiktokReportOf', () => {
	it('finds the pass’s line by open id, else by handle', () => {
		const reports = {
			'open-sandbox': { username: 'owlsnest', polledAt: '2026-10-20T12:00:00Z', posts: 3 },
			'open-moon': { username: 'papermoon', polledAt: '2026-10-20T12:00:00Z', posts: 1 }
		};
		expect(tiktokReportOf(reports, chosen)?.posts).toBe(3);
		expect(tiktokReportOf(undefined, chosen)).toBeUndefined();
	});

	it('prefers a line that read something over the posting sign-in’s, which lacks the scopes', () => {
		const none = ['video.list', 'user.info.stats'];
		const reports = {
			'open-prod': { username: 'owlsnest', polledAt: '2026-10-20T14:28:00Z', posts: 0, missing: none },
			'open-sandbox': { username: 'owlsnest', polledAt: '2026-10-20T14:20:00Z', posts: 4, missing: [] }
		};
		expect(tiktokReportOf(reports, chosen)?.posts).toBe(4);
		// Both read: the newest. Neither: the open id's.
		expect(tiktokReportOf({ ...reports, 'open-prod': { ...reports['open-prod'], posts: 9, missing: [] } }, chosen)?.posts).toBe(9);
		expect(
			tiktokReportOf({ ...reports, 'open-sandbox': { ...reports['open-sandbox'], polledAt: '2026-10-20T15:00:00Z', missing: none } }, chosen)
				?.polledAt
		).toBe('2026-10-20T14:28:00Z');
	});
});
