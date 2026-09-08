import { describe, expect, it } from 'vitest';
import {
	audienceChoices,
	consentLinks,
	disclosureLabel,
	readDisclosure,
	tiktokProblems,
	BRANDED_BLOCKS_PRIVATE,
	DISCLOSURE_INCOMPLETE
} from './tiktok';
import type { TikTokCreator } from './types';

const creator: TikTokCreator = {
	fetchedAt: '2026-09-08T10:00:00.000Z',
	username: 'chrotesque',
	nickname: 'Chrotesque',
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
			"Your video will be labeled as 'Promotional content'"
		);
		expect(disclosureLabel(readDisclosure({ discloseContent: true, brandContent: true }))).toBe(
			"Your video will be labeled as 'Paid partnership'"
		);
		expect(
			disclosureLabel(readDisclosure({ discloseContent: true, brandOrganic: true, brandContent: true }))
		).toBe("Your video will be labeled as 'Paid partnership'");
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
			'TikTok does not offer "Public" on @chrotesque; it offers Followers, Friends, Private.'
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
			'The video runs 4000s; @chrotesque may post up to 3600s.'
		]);
		expect(tiktokProblems({ privacy: 'Friends' }, creator, 0)).toEqual([]);
	});

	it('does not judge the audience against an account it has not read', () => {
		expect(tiktokProblems({ privacy: 'Public' }, null, 30)).toEqual([]);
	});
});
