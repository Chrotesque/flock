import { TIKTOK_PRIVACY_LABELS } from './platforms';
import type { OptionValues, TikTokCreator } from './types';

/**
 * TikTok's posting rules, as their Content Sharing Guidelines state them.
 *
 * Their Direct Post review grades the screens against that page word for
 * word: the audience is chosen by hand from what the account offers with
 * nothing preselected, comments, Duet and Stitch are off until ticked and
 * greyed out where the account has them switched off, a disclosed video
 * names how it will be labelled, branded content and a private audience lock
 * each other out, and every post carries the declaration line. The wording
 * below is theirs; keep it as it is.
 */

export const MUSIC_USAGE_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** The audiences the account offers, in the registry's words and TikTok's order. */
export function audienceChoices(creator: TikTokCreator | null): string[] {
	if (!creator) return [];
	return creator.privacyOptions.map((level) => TIKTOK_PRIVACY_LABELS[level] ?? level);
}

export interface TikTokDisclosure {
	/** The paid-promotion box on the compose screen, shared with YouTube. */
	disclosed: boolean;
	/** Promotes the author's own business: "Your brand". */
	yourBrand: boolean;
	/** A paid partnership with a third party: "Branded content". */
	brandedContent: boolean;
}

export function readDisclosure(options: OptionValues): TikTokDisclosure {
	return {
		disclosed: options.discloseContent === true,
		yourBrand: options.brandOrganic === true,
		brandedContent: options.brandContent === true
	};
}

/** How TikTok will label the post, in their words; null when nothing is disclosed yet. */
export function disclosureLabel(d: TikTokDisclosure): string | null {
	if (!d.disclosed) return null;
	if (d.brandedContent) return "Your video will be labeled as 'Paid partnership'";
	if (d.yourBrand) return "Your video will be labeled as 'Promotional content'";
	return null;
}

export interface ConsentLink {
	label: string;
	url: string;
}

/**
 * The declaration TikTok requires beside every post. Rendered as
 * "By posting, you agree to TikTok's " followed by the links, joined by
 * "and": the Music Usage Confirmation always, the Branded Content Policy
 * first whenever branded content is ticked.
 */
export function consentLinks(d: TikTokDisclosure): ConsentLink[] {
	const music = { label: 'Music Usage Confirmation', url: MUSIC_USAGE_URL };
	if (d.disclosed && d.brandedContent) {
		return [{ label: 'Branded Content Policy', url: BRANDED_CONTENT_POLICY_URL }, music];
	}
	return [music];
}

export const CONSENT_PREFIX = "By posting, you agree to TikTok's ";

/** Wording TikTok specifies for the two lockouts between audience and disclosure. */
export const PRIVATE_BLOCKS_BRANDED = "Visibility for branded content can't be private.";
export const BRANDED_BLOCKS_PRIVATE = 'Branded content visibility cannot be set to private.';
export const DISCLOSURE_INCOMPLETE =
	'You need to indicate if your content promotes yourself, a third party, or both.';

/**
 * Everything that stops a TikTok post from being confirmed, in the words to
 * show. Empty when the post may go. A missing creator row leaves the audience
 * list empty, which is reported as the audience still being unchosen: the
 * options must come from the account, not from a built-in list.
 */
export function tiktokProblems(
	options: OptionValues,
	creator: TikTokCreator | null,
	durationSeconds: number
): string[] {
	const problems: string[] = [];
	const audience = String(options.privacy ?? '');
	const offered = audienceChoices(creator);

	if (!audience) problems.push('Choose who can view the video.');
	else if (creator && offered.length > 0 && !offered.includes(audience)) {
		problems.push(`TikTok does not offer "${audience}" on @${creator.username}; it offers ${offered.join(', ')}.`);
	}

	const d = readDisclosure(options);
	if (d.disclosed && !d.yourBrand && !d.brandedContent) problems.push(DISCLOSURE_INCOMPLETE);
	if (d.disclosed && d.brandedContent && audience === 'Private') problems.push(BRANDED_BLOCKS_PRIVATE);

	if (creator && creator.maxDurationSeconds > 0 && durationSeconds > creator.maxDurationSeconds) {
		problems.push(
			`The video runs ${Math.round(durationSeconds)}s; @${creator.username} may post up to ${creator.maxDurationSeconds}s.`
		);
	}
	return problems;
}
