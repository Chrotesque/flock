import { describe, expect, it } from 'vitest';
import { accountFor, accountLabel, implicitChoices, offerFor } from './accounts';
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

describe('accountLabel', () => {
	it('prefixes a bare handle and keeps one that has its @', () => {
		expect(accountLabel(igA)).toBe('@alpha');
		expect(accountLabel(yt)).toBe('@channel');
	});

	it('falls back to the name', () => {
		expect(accountLabel(account('tiktok', 't1'))).toBe('Name t1');
	});
});
