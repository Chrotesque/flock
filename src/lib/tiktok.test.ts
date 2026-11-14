import { describe, expect, it } from 'vitest';
import {
	audienceChoices,
	consentLinks,
	disclosureLabel,
	readDisclosure,
	tiktokProblems,
	isDraft,
	forPostMode,
	postModeOf,
	BRANDED_BLOCKS_PRIVATE,
	DISCLOSURE_INCOMPLETE
} from './tiktok';
import type { TikTokCreator } from './types';

const creator: TikTokCreator = {
	fetchedAt: '2026-09-08T10:00:00.000Z',
	username: 'creator',
	nickname: 'Creator',
	avatar: '',
	privacyOptions: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
	commentDisabled: false,
	duetDisabled: true,
	stitchDisabled: false,
	maxDurationSeconds: 3600
};

describe('audienceChoices', () => {
	it("maps TikTok's levels to the registry's words, in TikTok's order", () => {
		expect(audienceChoices(creator)).toEqual(['Followers', 'Friends', 'Private']);
	});

	it('offers nothing without a creator row — the list must come from the account', () => {
		expect(audienceChoices(null)).toEqual([]);
	});
});

describe('disclosureLabel', () => {
	it('is silent until the box is ticked', () => {
		expect(disclosureLabel(readDisclosure({ brandOrganic: true }))).toBeNull();
	});

	it("uses TikTok's wording for each kind, paid partnership winning when both are ticked", () => {
		expect(disclosureLabel(readDisclosure({ discloseContent: true, brandOrganic: true }))).toBe(
			"Your photo/video will be labeled as 'Promotional content'"
		);
		expect(disclosureLabel(readDisclosure({ discloseContent: true, brandContent: true }))).toBe(
			"Your photo/video will be labeled as 'Paid partnership'"
		);
		expect(
			disclosureLabel(readDisclosure({ discloseContent: true, brandOrganic: true, brandContent: true }))
		).toBe("Your photo/video will be labeled as 'Paid partnership'");
	});
});

describe('consentLinks', () => {
	it('names the Music Usage Confirmation alone for an undisclosed or own-brand post', () => {
		expect(consentLinks(readDisclosure({})).map((l) => l.label)).toEqual(['Music Usage Confirmation']);
		expect(
			consentLinks(readDisclosure({ discloseContent: true, brandOrganic: true })).map((l) => l.label)
		).toEqual(['Music Usage Confirmation']);
	});

	it('puts the Branded Content Policy first when branded content is ticked', () => {
		expect(
			consentLinks(readDisclosure({ discloseContent: true, brandContent: true })).map((l) => l.label)
		).toEqual(['Branded Content Policy', 'Music Usage Confirmation']);
	});
});

describe('tiktokProblems', () => {
	it('insists on an audience being chosen by hand', () => {
		expect(tiktokProblems({}, creator, 30)).toEqual(['Choose who can view the video.']);
	});

	it('refuses an audience the account does not offer, naming the ones it does', () => {
		expect(tiktokProblems({ privacy: 'Public' }, creator, 30)).toEqual([
			'TikTok does not offer "Public" on @creator; it offers Followers, Friends, Private.'
		]);
	});

	it('passes a plain post at an offered audience', () => {
		expect(tiktokProblems({ privacy: 'Friends' }, creator, 30)).toEqual([]);
	});

	it('blocks a disclosure with no kind, and branded content on a private post', () => {
		expect(tiktokProblems({ privacy: 'Friends', discloseContent: true }, creator, 30)).toEqual([
			DISCLOSURE_INCOMPLETE
		]);
		expect(
			tiktokProblems({ privacy: 'Private', discloseContent: true, brandContent: true }, creator, 30)
		).toEqual([BRANDED_BLOCKS_PRIVATE]);
		expect(
			tiktokProblems({ privacy: 'Private', discloseContent: true, brandOrganic: true }, creator, 30)
		).toEqual([]);
	});

	it("checks the duration against the account's limit when both are known", () => {
		expect(tiktokProblems({ privacy: 'Friends' }, creator, 4000)).toEqual([
			'The video runs 4000s; @creator may post up to 3600s.'
		]);
		expect(tiktokProblems({ privacy: 'Friends' }, creator, 0)).toEqual([]);
	});

	it('does not judge the audience against an account it has not read', () => {
		expect(tiktokProblems({ privacy: 'Public' }, null, 30)).toEqual([]);
	});
});

describe('tiktokProblems: an account that cannot post', () => {
	it('stops the post while TikTok says the account cannot post', () => {
		const creator = {
			fetchedAt: '',
			username: 'owls_nest',
			nickname: 'Owl',
			avatar: '',
			privacyOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
			commentDisabled: false,
			duetDisabled: false,
			stitchDisabled: false,
			maxDurationSeconds: 600,
			error: 'TikTok spam_risk_too_many_posts: The creator has reached the daily post cap\nmore detail'
		};
		const problems = tiktokProblems({ privacy: 'Public' }, creator, 30);
		expect(problems).toEqual([
			'TikTok says @owls_nest cannot post right now — try again later. (TikTok spam_risk_too_many_posts: The creator has reached the daily post cap)'
		]);
		expect(tiktokProblems({ privacy: 'Public' }, { ...creator, error: '' }, 30)).toEqual([]);
	});
});

describe('drafts', () => {
	it('reads the post mode, direct unless a draft was chosen', () => {
		expect(postModeOf({})).toBe('direct');
		expect(postModeOf(undefined)).toBe('direct');
		expect(postModeOf({ postMode: 'draft' })).toBe('draft');
		expect(isDraft({ postMode: 'direct' })).toBe(false);
	});

	it('asks nothing of a draft that TikTok sets itself', () => {
		// No audience, an unfinished disclosure: none of it goes with a draft.
		const options = { postMode: 'draft', discloseContent: true };
		expect(tiktokProblems(options, { ...creator, canDraft: true }, 30)).toEqual([]);
	});

	it('holds a draft from a sign-in that cannot send one, or one TikTok will not hold', () => {
		const options = { postMode: 'draft' };
		expect(tiktokProblems(options, { ...creator, canDraft: false }, 30)[0]).toMatch(/Sign it in again/);
		// A worker from before drafts says nothing: not known, so not offered.
		expect(tiktokProblems(options, creator, 30)[0]).toMatch(/Sign it in again/);
		expect(tiktokProblems(options, { ...creator, canDraft: true }, 601)[0]).toMatch(/up to 10 minutes/);
	});

	it('still stops a draft for an account TikTok says cannot post now', () => {
		const problems = tiktokProblems({ postMode: 'draft' }, { ...creator, canDraft: true, error: 'spam_risk' }, 30);
		expect(problems[0]).toMatch(/cannot post right now/);
	});

	it("drops a direct post's choices from a draft, and keeps a post's", () => {
		const options = { postMode: 'draft', privacy: 'Public', allowComments: true, coverImageAt: 'end', jestrCampaign: true };
		expect(forPostMode(options)).toEqual({ postMode: 'draft', coverImageAt: 'end', jestrCampaign: true });
		const post = { privacy: 'Public', allowComments: true };
		expect(forPostMode(post)).toBe(post);
	});
});
