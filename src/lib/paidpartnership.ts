import { CAMPAIGN_OPTION } from './jestrcampaign';
import { COVER_AT_OPTION } from './coverimage';
import type { PlatformId } from './types';

/**
 * Instagram's "Paid partnership" label, put on a reel as it is published:
 * `is_paid_partnership` on the media container, in Meta's Content Publishing
 * API since April 2026 (worker/instagram.mjs). A tick on the Details step
 * while composing Instagram, written as `paidPartnership` on the post's
 * options. Instagram's alone: Facebook's reels API takes no such field, and
 * branded content on a Page always names the sponsor's Page.
 */
export const PAID_PARTNERSHIP_OPTION = 'paidPartnership';
export const PAID_PARTNERSHIP_PLATFORMS: PlatformId[] = ['instagram'];

/** Keys the Details step's own boxes write on a post's options — not option fields, so a reset of the options keeps them. */
export const BOX_OPTIONS = [CAMPAIGN_OPTION, PAID_PARTNERSHIP_OPTION, COVER_AT_OPTION];

type Overrides<T> = Partial<Record<PlatformId, T>>;

/** Whether the upload's Instagram post carries the label. */
export function paidPartnershipIn(overrides: Overrides<Record<string, unknown>>): boolean {
	return PAID_PARTNERSHIP_PLATFORMS.some((p) => overrides[p]?.[PAID_PARTNERSHIP_OPTION] === true);
}

/** The upload's options with the label set on, or taken off. */
export function withPaidPartnership<T extends Record<string, unknown>>(overrides: Overrides<T>, on: boolean): Overrides<T> {
	const out: Overrides<T> = { ...overrides };
	for (const p of PAID_PARTNERSHIP_PLATFORMS) {
		const { [PAID_PARTNERSHIP_OPTION]: _dropped, ...rest } = (out[p] ?? {}) as T;
		const next = (on ? { ...rest, [PAID_PARTNERSHIP_OPTION]: true } : rest) as T;
		if (Object.keys(next).length > 0) out[p] = next;
		else delete out[p];
	}
	return out;
}

/** What survives a reset of a post's options: the Details boxes' choices. */
export function keptOnReset(options: Record<string, unknown> | undefined): Record<string, boolean | string> {
	const out: Record<string, boolean | string> = {};
	for (const key of BOX_OPTIONS) {
		const value = options?.[key];
		if (value === true || (typeof value === 'string' && value !== '')) out[key] = value;
	}
	return out;
}
