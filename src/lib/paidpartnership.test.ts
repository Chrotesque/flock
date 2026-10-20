import { describe, expect, it } from 'vitest';
import { PAID_PARTNERSHIP_OPTION, keptOnReset, paidPartnershipIn, withPaidPartnership } from './paidpartnership';
import { CAMPAIGN_OPTION } from './jestrcampaign';

describe('the Paid partnership label', () => {
	it('is set on the Instagram post only', () => {
		const on = withPaidPartnership({ youtube: { visibility: 'public' } }, true);
		expect(on.instagram).toEqual({ [PAID_PARTNERSHIP_OPTION]: true });
		expect(on.youtube).toEqual({ visibility: 'public' });
		expect(on.facebook).toBeUndefined();
		expect(paidPartnershipIn(on)).toBe(true);
	});

	it('keeps the post’s other options when set or taken off, and drops an emptied entry', () => {
		const on = withPaidPartnership({ instagram: { shareToFeed: false } }, true);
		expect(on.instagram).toEqual({ shareToFeed: false, [PAID_PARTNERSHIP_OPTION]: true });
		expect(withPaidPartnership(on, false).instagram).toEqual({ shareToFeed: false });
		expect(withPaidPartnership(withPaidPartnership({}, true), false)).toEqual({});
		expect(paidPartnershipIn({})).toBe(false);
	});

	it('survives a reset of the options, as the Jestr tick does', () => {
		expect(keptOnReset({ shareToFeed: false, [PAID_PARTNERSHIP_OPTION]: true, [CAMPAIGN_OPTION]: true })).toEqual({
			[PAID_PARTNERSHIP_OPTION]: true,
			[CAMPAIGN_OPTION]: true
		});
		expect(keptOnReset({ shareToFeed: false })).toEqual({});
		// TikTok's cover placement is the Cover box's too.
		expect(keptOnReset({ coverFrame: 2, coverImageAt: 'start' })).toEqual({ coverImageAt: 'start' });
		expect(keptOnReset(undefined)).toEqual({});
	});
});
