import type { PlatformDefinition, PlatformId } from './types';

/**
 * The platform registry.
 *
 * Every option below is INVENTED. No platform API has been wired up yet, so
 * these exist purely to give the UI something plausible to render; expect to
 * throw most of them away once the real API surfaces are known. The character
 * limits and `hasTitle` are the parts that mirror reality.
 */
export const PLATFORMS: Record<PlatformId, PlatformDefinition> = {
	youtube: {
		id: 'youtube',
		label: 'YouTube',
		color: '#e8484a',
		hasTitle: true,
		composeField: 'tags',
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
			{ key: 'playlist', label: 'Add to playlist', type: 'text', placeholder: 'None' },
			{ key: 'tags', label: 'Tags', type: 'tags', placeholder: 'Add a tag and press Enter' },
			{ key: 'madeForKids', label: 'Made for kids', type: 'bool', hint: 'Disables comments and personalised ads.' },
			{ key: 'notifySubscribers', label: 'Notify subscribers', type: 'bool' },
			{ key: 'allowEmbedding', label: 'Allow embedding', type: 'bool' },
			{
				key: 'commentPolicy',
				label: 'Comments',
				type: 'select',
				choices: ['Allow all', 'Hold potentially inappropriate', 'Hold all for review', 'Disabled']
			},
			{ key: 'license', label: 'License', type: 'select', choices: ['Standard YouTube License', 'Creative Commons'] }
		],
		defaults: {
			visibility: 'Public',
			category: 'Science & Technology',
			playlist: '',
			tags: [],
			madeForKids: false,
			notifySubscribers: true,
			allowEmbedding: true,
			commentPolicy: 'Allow all',
			license: 'Standard YouTube License'
		}
	},

	instagram: {
		id: 'instagram',
		label: 'Instagram',
		color: '#d6558f',
		hasTitle: false,
		titleLimit: 125,
		descriptionLimit: 2200,
		fieldNote: 'Caption only — Instagram has no separate title.',
		fields: [
			{ key: 'surface', label: 'Share to', type: 'select', choices: ['Reels', 'Reels + Feed', 'Feed only'] },
			{ key: 'coverFrame', label: 'Cover frame', type: 'number', min: 0, max: 60, step: 0.5, unit: 's' },
			{ key: 'collaborators', label: 'Collaborators', type: 'tags', placeholder: '@handle' },
			{ key: 'locationTag', label: 'Location tag', type: 'text', placeholder: 'None' },
			{ key: 'altText', label: 'Alt text', type: 'text', placeholder: 'Describe the video' },
			{ key: 'hideLikeCounts', label: 'Hide like counts', type: 'bool' },
			{ key: 'disableComments', label: 'Turn off commenting', type: 'bool' },
			{ key: 'shareToStory', label: 'Also share to Story', type: 'bool' }
		],
		defaults: {
			surface: 'Reels + Feed',
			coverFrame: 1,
			collaborators: [],
			locationTag: '',
			altText: '',
			hideLikeCounts: false,
			disableComments: false,
			shareToStory: false
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
		fields: [
			{ key: 'privacy', label: 'Who can view', type: 'select', choices: ['Public', 'Friends', 'Private'] },
			{ key: 'coverFrame', label: 'Cover frame', type: 'number', min: 0, max: 60, step: 0.5, unit: 's' },
			{ key: 'allowComments', label: 'Allow comments', type: 'bool' },
			{ key: 'allowDuet', label: 'Allow Duet', type: 'bool' },
			{ key: 'allowStitch', label: 'Allow Stitch', type: 'bool' },
			{ key: 'discloseContent', label: 'Disclose commercial content', type: 'bool' },
			{
				key: 'brandedContent',
				label: 'Content disclosure',
				type: 'select',
				choices: ['None', 'Your brand', 'Branded content']
			},
			{ key: 'autoAddMusic', label: 'Auto-add trending sound', type: 'bool' }
		],
		defaults: {
			privacy: 'Public',
			coverFrame: 1,
			allowComments: true,
			allowDuet: true,
			allowStitch: true,
			discloseContent: false,
			brandedContent: 'None',
			autoAddMusic: false
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
