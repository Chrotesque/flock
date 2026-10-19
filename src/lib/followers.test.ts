import { describe, expect, it } from 'vitest';
import {
	countAt,
	creditedFollowers,
	facebookFollows,
	gainedBetween,
	readFollowerState,
	stateOf,
	sumGains,
	type FollowerState
} from './followers';

const T = Date.parse('2026-10-20T12:00:00.000Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const state: FollowerState = {
	platform: 'youtube',
	account: 'UC1',
	name: 'Owls Nest',
	count: 712,
	at: iso(T),
	since: iso(T - 48 * H),
	history: [
		[iso(T - 48 * H), 700],
		[iso(T - 20 * H), 705],
		[iso(T - 2 * H), 712]
	],
	credits: { a: 7, b: 3 }
};

describe('readFollowerState', () => {
	it('rebuilds a row field by field', () => {
		const read = readFollowerState({
			...state,
			history: [[iso(T - 2 * H), 712], 'junk', [iso(T - 48 * H), 700]],
			credits: { a: 7, b: 0, c: 'x' }
		});
		expect(read?.history).toEqual([
			[iso(T - 48 * H), 700],
			[iso(T - 2 * H), 712]
		]);
		expect(read?.credits).toEqual({ a: 7 });
	});

	it('refuses what is no follower record', () => {
		expect(readFollowerState(null)).toBeNull();
		expect(readFollowerState({ ...state, platform: 'tiktok' })).toBeNull();
		expect(readFollowerState({ ...state, count: '712' })).toBeNull();
	});

	it('finds an account by platform and id', () => {
		expect(stateOf([state], 'youtube', 'UC1')).toBe(state);
		expect(stateOf([state], 'instagram', 'UC1')).toBeUndefined();
		expect(stateOf([state], 'youtube', '')).toBeUndefined();
	});
});

describe('creditedFollowers', () => {
	it('is what was credited, 0 for a post out since the record began', () => {
		expect(creditedFollowers(state, 'a', T - H)).toBe(7);
		expect(creditedFollowers(state, 'new', T - H)).toBe(0);
	});

	it('is unknown for an older post credited nothing, or with no record', () => {
		expect(creditedFollowers(state, 'old', T - 72 * H)).toBeNull();
		expect(creditedFollowers({ ...state, credits: { old: 2 } }, 'old', T - 72 * H)).toBe(2);
		expect(creditedFollowers(undefined, 'a', T)).toBeNull();
	});

	it("reads a Facebook reel's own count from its insights", () => {
		expect(facebookFollows({ post_video_followers: 2 })).toBe(2);
		expect(facebookFollows({ fb_reels_total_plays: 10 })).toBeNull();
		expect(facebookFollows(undefined)).toBeNull();
	});
});

describe('follower gains', () => {
	it('holds the count from each sample on', () => {
		expect(countAt(state, T - 30 * H)).toBe(700);
		expect(countAt(state, T)).toBe(712);
		expect(countAt(state, T - 50 * H)).toBeNull();
	});

	it('is the move between two moments, from the first read when the record starts inside', () => {
		expect(gainedBetween(state, T - 24 * H, T)).toEqual({ gained: 12, partly: false });
		expect(gainedBetween(state, T - 10 * H, T)).toEqual({ gained: 7, partly: false });
		expect(gainedBetween(state, T - 100 * H, T)).toEqual({ gained: 12, partly: true });
		expect(gainedBetween(state, T - 100 * H, T - 60 * H)).toBeNull();
	});

	it('can be a loss', () => {
		const lost = { ...state, history: [...state.history, [iso(T - H), 709]] as [string, number][] };
		expect(gainedBetween(lost, T - 1.5 * H, T)).toEqual({ gained: -3, partly: false });
	});

	it('adds up, partly once any part is', () => {
		expect(sumGains([{ gained: 3, partly: false }, null, { gained: -1, partly: true }])).toEqual({ gained: 2, partly: true });
		expect(sumGains([null, null])).toBeNull();
	});
});
