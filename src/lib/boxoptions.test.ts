import { describe, expect, it } from 'vitest';
import { keptOnReset } from './boxoptions';
import { CAMPAIGN_OPTION } from './jestrcampaign';

describe('keptOnReset', () => {
	it('keeps the Details boxes’ choices through a reset of the options', () => {
		expect(keptOnReset({ shareToFeed: false, [CAMPAIGN_OPTION]: true })).toEqual({ [CAMPAIGN_OPTION]: true });
		expect(keptOnReset({ shareToFeed: false })).toEqual({});
		// TikTok's cover placement is the Cover box's too.
		expect(keptOnReset({ coverFrame: 2, coverImageAt: 'start' })).toEqual({ coverImageAt: 'start' });
		expect(keptOnReset(undefined)).toEqual({});
	});

	it('no longer keeps the retired Paid partnership tick', () => {
		expect(keptOnReset({ paidPartnership: true })).toEqual({});
	});
});
