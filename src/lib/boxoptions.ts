import { CAMPAIGN_OPTION } from './jestrcampaign';
import { COVER_AT_OPTION } from './coverimage';

/**
 * Keys the Details step's own boxes write on a post's options — the Jestr
 * campaign tick and TikTok's cover placement — not option fields, so a reset
 * of the options keeps them. Instagram's Paid partnership tick was one until
 * v0.16.62, when it went: Meta's API took the label and never showed it, so
 * To finish reminds of it instead (videotodo.ts).
 */
export const BOX_OPTIONS = [CAMPAIGN_OPTION, COVER_AT_OPTION];

/** What survives a reset of a post's options: the Details boxes' choices. */
export function keptOnReset(options: Record<string, unknown> | undefined): Record<string, boolean | string> {
	const out: Record<string, boolean | string> = {};
	for (const key of BOX_OPTIONS) {
		const value = options?.[key];
		if (value === true || (typeof value === 'string' && value !== '')) out[key] = value;
	}
	return out;
}
