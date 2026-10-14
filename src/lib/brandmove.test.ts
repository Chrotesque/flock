import { describe, expect, it } from 'vitest';
import { accountName, canMove, planMove, readMove } from './brandmove';
import type { Account, Brand, PlatformId, TargetStatus, UploadTarget } from './types';

const account = (platform: PlatformId, account_id: string, handle: string, name: string): Account => ({
	id: account_id,
	platform,
	account_id,
	handle,
	name,
	details: null,
	error: '',
	fetched_at: ''
});

const accounts: Account[] = [
	account('youtube', 'UC-owl', '@owlsnest', 'Owls Nest'),
	account('youtube', 'UC-moon', '@papermoon', 'Paper Moon'),
	account('instagram', 'ig-owl', 'owlsnest', 'Owls Nest'),
	account('instagram', 'ig-moon', 'papermoon', 'Paper Moon'),
	account('facebook', 'fb-owl', 'OwlsNest', 'Owls Nest'),
	account('facebook', 'fb-moon', 'PaperMoon', 'Paper Moon'),
	account('tiktok', 'tt-owl', 'owls_nest', 'Owls Nest'),
	account('tiktok', 'tt-moon', 'paper_moon', 'Paper Moon')
];

const moon: Brand = {
	id: 'moon',
	name: 'Paper Moon',
	sort_order: 1,
	accounts: { youtube: 'UC-moon', instagram: 'ig-moon', facebook: 'fb-moon', tiktok: 'tt-moon' }
};

const now = new Date('2026-10-14T20:00:00Z');
const later = '2026-10-16 16:00:00.000Z';
const earlier = '2026-10-13 16:00:00.000Z';

function target(platform: PlatformId, status: TargetStatus, extra: Partial<UploadTarget> = {}): UploadTarget {
	return {
		id: `${platform}-row`,
		job: 'job',
		platform,
		account: `${{ youtube: 'UC', instagram: 'ig', facebook: 'fb', tiktok: 'tt' }[platform]}-owl`,
		title: '',
		description: '',
		options: {},
		scheduled_at: later,
		status,
		created: '',
		updated: '',
		...extra
	};
}

const plan = (t: UploadTarget, brand = moon) => planMove([t], brand, accounts, 2, now)[0];

describe('planMove', () => {
	it('switches a post nothing was sent for', () => {
		const step = plan(target('instagram', 'pending'));
		expect(step.kind).toBe('switch');
		expect(step.from).toBe('ig-owl');
		expect(step.to).toBe('ig-moon');
		expect(step.toName).toBe('@papermoon');
		expect(step.words).toContain('at its slot');
	});

	it('says a switched post whose slot passed goes out at once', () => {
		expect(plan(target('instagram', 'pending', { scheduled_at: earlier })).words).toContain('at once');
	});

	it('switches a failed post with nothing on the platform', () => {
		expect(plan(target('facebook', 'failed')).kind).toBe('switch');
	});

	it('replaces a YouTube video or Facebook reel already on the platform', () => {
		const yt = plan(target('youtube', 'scheduled', { remote_url: 'https://www.youtube.com/watch?v=abcdefghijk' }));
		expect(yt.kind).toBe('replace');
		expect(yt.live).toBe(false);
		expect(yt.fromName).toBe('Owls Nest');
		expect(yt.toName).toBe('Paper Moon');
		expect(yt.words).toContain('Nobody has seen it yet');
		expect(plan(target('facebook', 'scheduled', { remote_url: 'https://www.facebook.com/reel/1/' })).kind).toBe('replace');
	});

	it('warns that a public video loses its numbers', () => {
		const live = plan(target('youtube', 'published', { remote_url: 'https://www.youtube.com/watch?v=abcdefghijk' }));
		expect(live.live).toBe(true);
		expect(live.words).toContain('views');
		// Scheduled but past its slot: YouTube has made it public by now.
		expect(plan(target('youtube', 'scheduled', { scheduled_at: earlier, remote_url: 'x' })).live).toBe(true);
	});

	it('reposts a live Instagram reel and says it stays until deleted by hand', () => {
		const step = plan(target('instagram', 'published', { remote_url: 'https://www.instagram.com/reel/x/' }));
		expect(step.kind).toBe('repost');
		expect(step.words).toContain('delete it in Instagram');
	});

	it('stops an Instagram reel held for its slot, and waits for an upload in flight', () => {
		expect(plan(target('instagram', 'publishing')).kind).toBe('stop');
		expect(plan(target('youtube', 'publishing')).kind).toBe('wait');
		expect(plan(target('facebook', 'publishing')).kind).toBe('wait');
	});

	it('leaves TikTok alone', () => {
		expect(plan(target('tiktok', 'pending')).kind).toBe('keep');
	});

	it('does nothing for a post already on the brand’s account', () => {
		expect(plan(target('youtube', 'scheduled', { account: 'UC-moon', remote_url: 'x' })).kind).toBe('none');
	});

	it('blocks a platform the brand has no account for', () => {
		const bare: Brand = { id: 'bare', name: 'Bare', sort_order: 2, accounts: {} };
		const step = plan(target('instagram', 'pending'), bare);
		expect(step.kind).toBe('blocked');
		expect(step.words).toContain('Bare has no Instagram account');
	});
});

describe('canMove', () => {
	it('is true only when some post would change', () => {
		expect(canMove(planMove([target('instagram', 'pending')], moon, accounts, 2, now))).toBe(true);
		expect(canMove(planMove([target('tiktok', 'pending')], moon, accounts, 2, now))).toBe(false);
		expect(canMove([])).toBe(false);
	});
});

describe('accountName', () => {
	it('names a channel or Page by name and the rest by handle', () => {
		expect(accountName(accounts, 'youtube', 'UC-moon')).toBe('Paper Moon');
		expect(accountName(accounts, 'instagram', 'ig-moon')).toBe('@papermoon');
		expect(accountName(accounts, 'instagram', 'gone')).toBe('Instagram account gone');
	});

	it('takes an empty id as the platform’s only account', () => {
		expect(accountName([accounts[2]], 'instagram', '')).toBe('@owlsnest');
		expect(accountName(accounts, 'instagram', '')).toBe('the Instagram account');
	});
});

describe('readMove', () => {
	it('reads a request back and drops one naming no account', () => {
		expect(readMove({ to: 'ig-moon', brandName: 'Paper Moon', extra: 1 })).toEqual({
			to: 'ig-moon',
			toName: '',
			from: '',
			brand: '',
			brandName: 'Paper Moon',
			requestedAt: '',
			by: ''
		});
		expect(readMove({ to: '' })).toBeNull();
		expect(readMove(null)).toBeNull();
	});
});
