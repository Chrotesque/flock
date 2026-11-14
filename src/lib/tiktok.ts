import { TIKTOK_PRIVACY_LABELS } from './platforms';
import type { OptionValues, TikTokCreator } from './types';

/** An error's first line, short enough for a line of the compose box. */
function firstLine(text: string): string {
	const line = text.split('\n')[0].trim();
	return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

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

/**
 * How a post goes to TikTok — the Post to TikTok box's choice, written into
 * the post's options as `postMode`: straight to the profile (Direct Post,
 * video.publish), or to the creator's TikTok inbox as a draft (Upload,
 * video.upload), finished and posted in TikTok's own editor. Absent is
 * direct, which every post was before drafts existed.
 */
export const POST_MODE_OPTION = 'postMode';
export type PostMode = 'direct' | 'draft';

export function postModeOf(options: OptionValues | undefined): PostMode {
	return options?.[POST_MODE_OPTION] === 'draft' ? 'draft' : 'direct';
}

export function isDraft(options: OptionValues | undefined): boolean {
	return postModeOf(options) === 'draft';
}

/**
 * A direct post's choices, none of which go with a draft: TikTok asks for
 * them when the draft is posted in the app. Dropped from a draft's plan so
 * its record and Review row show only what TikTok gets.
 */
export const DIRECT_ONLY = [
	'privacy',
	'allowComments',
	'allowDuet',
	'allowStitch',
	'discloseContent',
	'brandOrganic',
	'brandContent',
	'disclosure',
	'aiGenerated',
	'coverFrame'
] as const;

/** A TikTok post's options as they go out: a draft's without the direct post's choices. */
export function forPostMode(options: OptionValues): OptionValues {
	if (!isDraft(options)) return options;
	const out: OptionValues = { ...options };
	for (const key of DIRECT_ONLY) delete out[key];
	return out;
}

/** The longest video TikTok takes as a draft (its Upload reference: 10 minutes). */
export const DRAFT_MAX_SECONDS = 600;

/**
 * What TikTok asks an app to tell whoever sends a draft: the post is
 * finished from the notification in their TikTok inbox. Its docs: "inform
 * users that they must click on inbox notifications to continue the editing
 * flow in TikTok and complete the post."
 */
export const DRAFT_INBOX_NOTICE =
	'Once it is uploaded, click the notification in your TikTok inbox to continue editing in TikTok and complete the post.';

/** Why a draft carries none of flock's caption or settings. */
/** A sign-in from before flock asked for drafts (video.upload) cannot send one. */
export const DRAFT_NOT_ALLOWED = (username: string) =>
	`@${username} was signed in before flock could send drafts. Sign it in again to allow them, or send this as a post.`;

export const DRAFT_TAKES_NOTHING =
	'TikTok takes only the video with a draft: the caption, who can view it, comments, Duet, Stitch and the content disclosure are all set in TikTok when you post it.';

export const MUSIC_USAGE_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
export const BRANDED_CONTENT_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** The audiences the account offers, in the registry's words and TikTok's order. */
export function audienceChoices(creator: TikTokCreator | null): string[] {
	if (!creator) return [];
	return creator.privacyOptions.map((level) => TIKTOK_PRIVACY_LABELS[level] ?? level);
}

export interface TikTokDisclosure {
	/** The Content Disclosure Setting toggle in the Post to TikTok box. */
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
	if (d.brandedContent) return "Your photo/video will be labeled as 'Paid partnership'";
	if (d.yourBrand) return "Your photo/video will be labeled as 'Promotional content'";
	return null;
}

/** The disclosure toggle's label, and the tooltip over it and its two options — TikTok's words. */
export const DISCLOSURE_TOGGLE = 'Content Disclosure Setting';

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

	// TikTok's creator info refused, or said the account cannot post now (its
	// daily cap, a posting ban): the guidelines say stop and try again later.
	if (creator?.error) {
		problems.push(`TikTok says @${creator.username} cannot post right now — try again later. (${firstLine(creator.error)})`);
	}

	// A draft is only the video: every choice is made in TikTok. What stops
	// one is a sign-in that cannot send drafts and TikTok's ten minutes.
	if (isDraft(options)) {
		if (creator && creator.canDraft !== true) problems.push(DRAFT_NOT_ALLOWED(creator.username));
		if (durationSeconds > DRAFT_MAX_SECONDS) {
			problems.push(`The video runs ${Math.round(durationSeconds)}s; TikTok takes a draft of up to 10 minutes.`);
		}
		return problems;
	}

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
