import { describe, expect, it } from 'vitest';
import { canRead, doneWords, readReturn, signinRedirect } from './tiktoksignin';

describe('signinRedirect', () => {
	it("is this copy's own return page", () => {
		expect(signinRedirect('https://flock.example.com', '/app')).toBe('https://flock.example.com/app/connect/tiktok');
		expect(signinRedirect('https://flock.example.com', '')).toBe('https://flock.example.com/connect/tiktok');
	});
});

describe('readReturn', () => {
	it('takes the code and the state', () => {
		expect(readReturn(new URLSearchParams('code=abc&state=xyz&scopes=user.info.basic'))).toEqual({
			kind: 'code',
			code: 'abc',
			state: 'xyz'
		});
	});

	it("takes TikTok's refusal, with its words", () => {
		expect(readReturn(new URLSearchParams('error=access_denied&error_description=User%20cancelled'))).toEqual({
			kind: 'error',
			error: 'access_denied: User cancelled'
		});
		expect(readReturn(new URLSearchParams('error=access_denied'))).toEqual({ kind: 'error', error: 'access_denied' });
	});

	it('is nothing without both a code and a state', () => {
		expect(readReturn(new URLSearchParams('code=abc'))).toEqual({ kind: 'none' });
		expect(readReturn(new URLSearchParams(''))).toEqual({ kind: 'none' });
	});
});

describe('canRead', () => {
	it('needs a read with no reading scope missing', () => {
		expect(canRead(undefined)).toBe(false);
		expect(canRead({ missing: [] })).toBe(true);
		expect(canRead({})).toBe(true);
		expect(canRead({ missing: ['video.list'] })).toBe(false);
	});
});

describe('doneWords', () => {
	it('says who was connected, and what TikTok held back', () => {
		expect(doneWords({ username: 'paper_moon', missing: [] })).toBe(
			'@paper_moon is connected. Its videos and followers are being read.'
		);
		expect(doneWords({ username: '', missing: ['video.list', 'user.info.stats'] })).toBe(
			'The account is connected, but TikTok did not allow video.list and user.info.stats, so its numbers cannot be read.'
		);
		expect(doneWords({ username: 'paper_moon', missing: ['video.upload'] })).toBe(
			'@paper_moon is connected. Its videos and followers are being read. It cannot be sent drafts (TikTok did not allow video.upload).'
		);
	});
});
