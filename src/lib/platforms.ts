import type { PlatformDefinition, PlatformId } from './types';

/**
 * The platform registry.
 *
 * YouTube's, Instagram's and TikTok's sets are REAL — every field maps to
 * something the platform's publish call actually accepts, and the matching
 * worker adapter (worker/youtube.mjs, instagram.mjs, tiktok.mjs) is what maps
 * it. Facebook's is still an INVENTED placeholder that exists to give the UI
 * something plausible to render; expect to throw most of it away once that
 * API is wired up. The character limits and `hasTitle` mirror reality
 * throughout.
 */

/**
 * TikTok's audiences by the name the registry shows them under, against the
 * level TikTok calls them. worker/tiktok.mjs holds the same table for the
 * wire; keep the two together. Which of these an account actually offers
 * comes from the worker's creator row, not from here — Followers exists only
 * on a private account, Public only on a public one.
 */
export const TIKTOK_PRIVACY_LEVELS: Record<string, string> = {
	Public: 'PUBLIC_TO_EVERYONE',
	Friends: 'MUTUAL_FOLLOW_FRIENDS',
	Followers: 'FOLLOWER_OF_CREATOR',
	Private: 'SELF_ONLY'
};
export const TIKTOK_PRIVACY_LABELS: Record<string, string> = Object.fromEntries(
	Object.entries(TIKTOK_PRIVACY_LEVELS).map(([label, level]) => [level, label])
);
/**
 * Offered by name; worker/youtube.mjs maps them to the BCP-47 codes the API
 * takes. Extend both lists together.
 */
export const YOUTUBE_LANGUAGES = [
	'English (US)',
	'English (UK)',
	'German',
	'French',
	'Spanish',
	'Italian',
	'Dutch',
	'Portuguese (Brazil)',
	'Japanese',
	'Korean',
	'Polish',
	'Swedish',
	'Turkish',
	'Russian',
	'Chinese (Simplified)'
];

export const PLATFORMS: Record<PlatformId, PlatformDefinition> = {
	youtube: {
		id: 'youtube',
		label: 'YouTube',
		color: '#e8484a',
		hasTitle: true,
		composeFields: ['tagsStandard', 'tagsShorts', 'tagsLongform', 'tagsOther'],
		tagBudget: {
			keys: ['tagsStandard', 'tagsShorts', 'tagsLongform', 'tagsOther'],
			limit: 500
		},
		titleLimit: 100,
		descriptionLimit: 5000,
		fieldNote: 'Title and description are used as-is.',
		fields: [
			{ key: 'visibility', label: 'Visibility', type: 'select', choices: ['Public', 'Unlisted', 'Private'] },
			{
				key: 'category',
				label: 'Category',
				type: 'select',
				choices: ['Gaming', 'Education', 'Entertainment', 'Music', 'Science & Technology', 'People & Blogs']
			},
			{
				key: 'videoLanguage',
				label: 'Video language',
				type: 'select',
				choices: YOUTUBE_LANGUAGES,
				hint: 'The language spoken in the video.'
			},
			{
				key: 'textLanguage',
				label: 'Title & description language',
				type: 'select',
				choices: YOUTUBE_LANGUAGES
			},
			// The playlist is deliberately not a field here: it differs on every
			// upload, so it is picked on the compose screen and lands in the
			// target's options as `playlist` (the playlist's title) from there.
			// Split only for the interface's sake. videos.insert takes one list, and
			// buildPlan is where these four become it.
			{ key: 'tagsStandard', label: 'Standard', type: 'tags', placeholder: 'Paste or type' },
			{ key: 'tagsShorts', label: 'Shorts', type: 'tags', placeholder: 'Paste or type' },
			{ key: 'tagsLongform', label: 'Long Form', type: 'tags', placeholder: 'Paste or type' },
			{ key: 'tagsOther', label: 'Other', type: 'tags', placeholder: 'Paste or type' },
			{ key: 'madeForKids', label: 'Made for kids', type: 'bool', hint: 'Disables comments and personalised ads.' },
			{ key: 'notifySubscribers', label: 'Notify subscribers', type: 'bool' },
			{ key: 'allowEmbedding', label: 'Allow embedding', type: 'bool' },
			{ key: 'license', label: 'License', type: 'select', choices: ['Standard YouTube License', 'Creative Commons'] },
			{
				key: 'syntheticMedia',
				label: 'Contains synthetic media',
				type: 'bool',
				hint: 'Discloses AI-generated or altered content. Required by YouTube when it applies.'
			}
		],
		defaults: {
			visibility: 'Public',
			category: 'Science & Technology',
			videoLanguage: 'English (US)',
			textLanguage: 'English (US)',

			tagsStandard: [],
			tagsShorts: [],
			tagsLongform: [],
			tagsOther: [],
			madeForKids: false,
			notifySubscribers: true,
			allowEmbedding: true,
			license: 'Standard YouTube License',
			syntheticMedia: false
		}
	},

	instagram: {
		id: 'instagram',
		label: 'Instagram',
		color: '#d6558f',
		hasTitle: false,
		titleLimit: 125,
		descriptionLimit: 2200,
		fieldNote: 'Caption only — published as a Reel.',
		// Every field maps to a parameter of the Graph API's media container;
		// worker/instagram.mjs does the mapping. A Reel is the only kind of video
		// the API still publishes, which is why there is no surface to pick.
		fields: [
			{
				key: 'shareToFeed',
				label: 'Show in the profile feed',
				type: 'bool',
				hint: 'Off keeps the reel to the Reels tab.'
			},
			{
				key: 'coverFrame',
				label: 'Cover frame',
				type: 'number',
				min: 0,
				max: 900,
				step: 0.5,
				unit: 's',
				hint: 'The frame used as the cover. Instagram takes a cover image only from a public URL, so the thumbnail box does not apply here.'
			},
			{
				key: 'collaborators',
				label: 'Collaborators',
				type: 'tags',
				placeholder: 'username',
				hint: 'Up to three. Each gets an invite to accept.'
			},
			{
				key: 'audioName',
				label: 'Audio name',
				type: 'text',
				placeholder: 'Original audio',
				hint: 'Renames the original audio.'
			}
		],
		defaults: {
			shareToFeed: true,
			coverFrame: 1,
			collaborators: [],
			audioName: ''
		}
	},

	tiktok: {
		id: 'tiktok',
		label: 'TikTok',
		color: '#3de0dc',
		hasTitle: false,
		titleLimit: 90,
		descriptionLimit: 2200,
		fieldNote: 'Caption only — TikTok has no separate title.',
		// TikTok shows roughly the first hundred characters of a caption under
		// the video before "…more". A guess, not an API value: adjust here.
		visibleCaption: 100,
		// Every field maps to a field of the Content Posting API's init call;
		// worker/tiktok.mjs does the mapping. Most of TikTok's per-post choices
		// are deliberately NOT here: their Content Sharing Guidelines require
		// the audience to be picked by hand from what the account offers with
		// nothing preselected, and comments, Duet and Stitch to be off until
		// ticked — so those, and the disclosure kind, are per-upload controls
		// in the TikTok box on the compose screen (`src/lib/tiktok.ts` holds the
		// rules) and land in the target's options as `privacy`, `allowComments`,
		// `allowDuet`, `allowStitch`, `discloseContent`, `brandOrganic` and
		// `brandContent`. Only what may carry a saved default is listed.
		fields: [
			{
				key: 'coverFrame',
				label: 'Cover frame',
				type: 'number',
				min: 0,
				max: 600,
				step: 0.5,
				unit: 's',
				hint: 'The frame used as the cover. TikTok takes a time, not an image, so the thumbnail box does not apply here.'
			},
			{
				key: 'aiGenerated',
				label: 'AI-generated content',
				type: 'bool',
				hint: 'Labels the video as made with AI.'
			}
		],
		defaults: {
			coverFrame: 1,
			aiGenerated: false
		}
	},

	facebook: {
		id: 'facebook',
		label: 'Facebook',
		color: '#3b82f6',
		hasTitle: true,
		titleLimit: 255,
		descriptionLimit: 63206,
		fieldNote: 'Title is the video headline, description is the post body.',
		fields: [
			{ key: 'page', label: 'Publish as', type: 'text', placeholder: 'Page name' },
			{ key: 'visibility', label: 'Visibility', type: 'select', choices: ['Public', 'Friends', 'Only me'] },
			{ key: 'distribution', label: 'Distribution', type: 'select', choices: ['Feed', 'Reels', 'Feed + Reels'] },
			{ key: 'taggedSponsor', label: 'Tagged sponsor', type: 'text', placeholder: 'None' },
			{ key: 'crosspostToInstagram', label: 'Crosspost to Instagram', type: 'bool' },
			{ key: 'allowEmbedding', label: 'Allow embedding', type: 'bool' }
		],
		defaults: {
			page: '',
			visibility: 'Public',
			distribution: 'Feed + Reels',
			taggedSponsor: '',
			crosspostToInstagram: false,
			allowEmbedding: true
		}
	}
};

/** Registry order — the *display* order lives in platform_settings.sort_order. */
export const PLATFORM_IDS: PlatformId[] = ['youtube', 'instagram', 'tiktok', 'facebook'];

export function isPlatformId(value: string): value is PlatformId {
	return (PLATFORM_IDS as string[]).includes(value);
}
