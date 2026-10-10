import { describe, expect, it } from 'vitest';
import {
	accountFor,
	accountLabel,
	allowanceLabel,
	allowanceWarning,
	implicitChoices,
	offerFor,
	postAllowance
} from './accounts';
import type { Account, Brand, PlatformId } from './types';

const account = (platform: PlatformId, id: string, handle = ''): Account => ({
	id: `row-${id}`,
	platform,
	account_id: id,
	handle,
	name: `Name ${id}`,
	details: null,
	error: '',
	fetched_at: ''
});
const brand = (accounts: Brand['accounts'] = {}): Brand => ({ id: 'b', name: 'B', sort_order: 0, accounts });

const igA = account('instagram', 'ig-a', 'alpha');
const igB = account('instagram', 'ig-b', 'beta');
const yt = account('youtube', 'yt-1', '@channel');

describe('accountFor', () => {
	it('gives a brand the account it chose', () => {
		expect(accountFor(brand({ instagram: 'ig-b' }), 'instagram', [igA, igB], 2)).toBe(igB);
	});

	it('gives nothing for a chosen account that is gone', () => {
		expect(accountFor(brand({ instagram: 'ig-z' }), 'instagram', [igA, igB], 1)).toBeNull();
	});

	it('gives a lone brand the only account without asking', () => {
		expect(accountFor(brand(), 'youtube', [yt], 1)).toBe(yt);
	});

	it('never guesses with several brands, even when there is one account', () => {
		expect(accountFor(brand(), 'youtube', [yt], 2)).toBeNull();
	});

	it('never guesses between several accounts', () => {
		expect(accountFor(brand(), 'instagram', [igA, igB], 1)).toBeNull();
	});
});

describe('offerFor', () => {
	it('offers a chosen account', () => {
		expect(offerFor(brand({ instagram: 'ig-a' }), 'instagram', [igA, igB], 2)).toEqual({
			offered: true,
			account: igA
		});
	});

	it('keeps offering an unreported platform to a lone brand, with no account', () => {
		expect(offerFor(brand(), 'facebook', [yt], 1)).toEqual({ offered: true, account: null });
	});

	it('does not offer an unreported platform once there are several brands', () => {
		expect(offerFor(brand(), 'facebook', [yt], 2)).toEqual({ offered: false, reason: 'none' });
	});

	it('does not offer a platform whose accounts nobody chose', () => {
		expect(offerFor(brand(), 'youtube', [yt], 2)).toEqual({ offered: false, reason: 'unchosen' });
	});

	it('says so when the chosen account is gone', () => {
		expect(offerFor(brand({ youtube: 'yt-9' }), 'youtube', [yt], 2)).toEqual({
			offered: false,
			reason: 'gone'
		});
	});
});

describe('implicitChoices', () => {
	it('writes down the only account per platform and keeps what was chosen', () => {
		const choices = implicitChoices(brand({ instagram: 'ig-b' }), [igA, igB, yt], [
			'youtube',
			'instagram',
			'tiktok'
		]);
		expect(choices).toEqual({ instagram: 'ig-b', youtube: 'yt-1' });
	});

	it('leaves a platform with several accounts unchosen', () => {
		expect(implicitChoices(brand(), [igA, igB], ['instagram'])).toEqual({});
	});
});

describe('postAllowance', () => {
	const withQuota = (details: Account['details']): Account => ({ ...igA, details });

	it('reads what the worker stored', () => {
		const allowance = postAllowance(
			withQuota({ quotaUsed: 3, quotaTotal: 100, fetchedAt: '2026-10-10T20:00:00Z' })
		);
		expect(allowance).toEqual({ used: 3, total: 100, left: 97, fetchedAt: '2026-10-10T20:00:00Z' });
		expect(allowanceLabel(allowance!)).toBe('3 of 100 posts in 24 h');
	});

	it('has none when the worker could not read it, or for a platform that reports none', () => {
		expect(postAllowance(withQuota({ quotaUsed: null, quotaTotal: null }))).toBeNull();
		expect(postAllowance(withQuota({ quotaUsed: 0, quotaTotal: 0 }))).toBeNull();
		expect(postAllowance(yt)).toBeNull();
		expect(postAllowance(null)).toBeNull();
	});

	it('never counts below nothing left', () => {
		expect(postAllowance(withQuota({ quotaUsed: 104, quotaTotal: 100 }))?.left).toBe(0);
	});
});

describe('allowanceWarning', () => {
	const now = Date.parse('2026-10-10T20:00:00Z');
	const full = { used: 100, total: 100, left: 0, fetchedAt: '' };

	it('warns for a post within a day once the allowance is used up', () => {
		expect(allowanceWarning(full, now + 60 * 60_000, now)).toMatch(/All 100 posts/);
		expect(allowanceWarning(full, now - 60_000, now)).toMatch(/All 100 posts/);
	});

	it('stays quiet with posts left, or for a post a day or more away', () => {
		expect(allowanceWarning({ ...full, used: 99, left: 1 }, now, now)).toBe('');
		expect(allowanceWarning(full, now + 24 * 60 * 60_000, now)).toBe('');
		expect(allowanceWarning(null, now, now)).toBe('');
	});
});

describe('accountLabel', () => {
	it('prefixes a bare handle and keeps one that has its @', () => {
		expect(accountLabel(igA)).toBe('@alpha');
		expect(accountLabel(yt)).toBe('@channel');
	});

	it('falls back to the name', () => {
		expect(accountLabel(account('tiktok', 't1'))).toBe('Name t1');
	});
});
