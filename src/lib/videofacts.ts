import { formatBytes, formatDuration } from './format';
import type { VideoStats, YouTubeVideo } from './types';
import type { ReelRow } from './releases';

/**
 * What an opened row of the dashboard's list shows: everything the platform
 * returned, grouped for reading, empty fields dropped.
 */

export type Fact = [string, string];

export interface FactGroup {
	title: string;
	rows: Fact[];
}

const CATEGORIES: Record<string, string> = {
	'1': 'Film & Animation',
	'2': 'Autos & Vehicles',
	'10': 'Music',
	'15': 'Pets & Animals',
	'17': 'Sports',
	'19': 'Travel & Events',
	'20': 'Gaming',
	'22': 'People & Blogs',
	'23': 'Comedy',
	'24': 'Entertainment',
	'25': 'News & Politics',
	'26': 'Howto & Style',
	'27': 'Education',
	'28': 'Science & Technology',
	'29': 'Nonprofits & Activism'
};

function pairs(list: [string, string | undefined | null][]): Fact[] {
	return list.filter((p): p is Fact => p[1] != null && p[1] !== '');
}

function yes(v: boolean | undefined): string | undefined {
	return v === undefined ? undefined : v ? 'yes' : 'no';
}

function when(iso: string | undefined): string | undefined {
	return iso ? new Date(iso.replace(' ', 'T')).toLocaleString() : undefined;
}

function mbps(bps: string | undefined): string | undefined {
	return bps ? `${(Number(bps) / 1e6).toFixed(1)} Mbit/s` : undefined;
}

function count(n: number | string | null | undefined, missing?: string): string | undefined {
	return n == null || n === '' ? missing : Number(n).toLocaleString();
}

export function youtubeFacts(row: VideoStats, ago: (iso: string | undefined) => string): FactGroup[] {
	const d = row.data ?? ({} as YouTubeVideo);
	const s = d.snippet ?? {};
	const st = d.status ?? {};
	const c = d.contentDetails ?? {};
	const stats = d.statistics ?? {};
	const f = d.fileDetails;
	const p = d.processingDetails;
	const sg = d.suggestions;
	const video = f?.videoStreams?.[0];
	const audio = f?.audioStreams?.[0];
	const last = row.history?.[row.history.length - 1];

	const groups: FactGroup[] = [
		{
			title: 'Listing',
			rows: pairs([
				['Published', when(s.publishedAt)],
				['Goes public', when(st.publishAt)],
				['Privacy', st.privacyStatus],
				['Upload status', st.uploadStatus],
				['Category', s.categoryId ? (CATEGORIES[s.categoryId] ?? s.categoryId) : undefined],
				['Tags', s.tags?.length ? `${s.tags.length} — ${s.tags.join(', ')}` : 'none'],
				[
					'Topics',
					d.topicDetails?.topicCategories
						?.map((u) => decodeURIComponent(u.split('/').pop() ?? '').replace(/_/g, ' '))
						.join(', ')
				],
				['Language', s.defaultLanguage],
				['Audio language', s.defaultAudioLanguage],
				['License', st.license],
				['Embeddable', yes(st.embeddable)],
				['Public stats', yes(st.publicStatsViewable)],
				['Made for kids', yes(st.madeForKids)],
				['Synthetic media', yes(st.containsSyntheticMedia)],
				['Paid promotion', yes(d.paidProductPlacementDetails?.hasPaidProductPlacement)],
				['Live', s.liveBroadcastContent !== 'none' ? s.liveBroadcastContent : undefined]
			])
		},
		{
			title: 'Counters',
			rows: pairs([
				['Views', count(stats.viewCount)],
				['Likes', count(stats.likeCount, 'hidden')],
				['Comments', count(stats.commentCount, 'off')],
				['Favourites', stats.favoriteCount],
				['Samples kept', String(row.history?.length ?? 0)],
				['Last movement', last ? ago(last[0]) : undefined],
				['Last changed', ago(row.fetched_at)]
			])
		},
		{
			title: 'Media',
			rows: pairs([
				['Duration', formatDuration(row.duration)],
				['Definition', c.definition],
				['Dimension', c.dimension],
				['Captions', c.caption],
				['Licensed content', yes(c.licensedContent)],
				['Projection', c.projection],
				['File', f?.fileName],
				['Size', f?.fileSize ? formatBytes(Number(f.fileSize)) : undefined],
				['Container', f?.container],
				[
					'Video stream',
					video
						? [
								video.widthPixels && video.heightPixels ? `${video.widthPixels}×${video.heightPixels}` : '',
								video.frameRateFps ? `${video.frameRateFps} fps` : '',
								video.codec,
								mbps(video.bitrateBps)
							]
								.filter(Boolean)
								.join(' · ')
						: undefined
				],
				[
					'Audio stream',
					audio
						? [
								audio.codec,
								audio.channelCount ? `${audio.channelCount} ch` : '',
								audio.bitrateBps ? `${Math.round(Number(audio.bitrateBps) / 1000)} kbit/s` : ''
							]
								.filter(Boolean)
								.join(' · ')
						: undefined
				]
			])
		},
		{
			title: 'Processing',
			rows: pairs([
				['Status', p?.processingStatus],
				[
					'Progress',
					p?.processingProgress?.partsTotal
						? `${p.processingProgress.partsProcessed ?? 0} of ${p.processingProgress.partsTotal}`
						: undefined
				],
				['Failure', p?.processingFailureReason],
				['Errors', sg?.processingErrors?.join(', ')],
				['Warnings', sg?.processingWarnings?.join(', ')],
				['Hints', sg?.processingHints?.join(', ')],
				['Suggested tags', sg?.tagSuggestions?.map((t) => t.tag).join(', ')],
				['Editor suggestions', sg?.editorSuggestions?.join(', ')]
			])
		},
		{
			title: 'Live stream',
			rows: pairs(Object.entries(d.liveStreamingDetails ?? {}).map(([k, v]) => [k, String(v)]))
		}
	];
	return groups.filter((g) => g.rows.length > 0);
}

/** A reel as `post_stats` holds it; Instagram's insights may lag up to two days. */
export function reelFacts(
	row: ReelRow & { platform?: string; data?: Record<string, unknown> },
	ago: (iso: string | undefined) => string
): FactGroup[] {
	const last = row.history?.[row.history.length - 1];
	const facebook = row.platform === 'facebook';
	// Facebook's insights (fbstats.mjs), kept in `data` beside the columns.
	const insights = (facebook ? (row.data?.insights ?? {}) : {}) as Record<string, unknown>;
	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const social = insights.post_video_social_actions as Record<string, number> | undefined;
	const avgMs = num(insights.post_video_avg_time_watched);
	const length = num(row.data?.length);
	return [
		{
			title: 'Reel',
			rows: pairs([
				['Posted', when(row.published_at)],
				['Length', length ? formatDuration(Math.round(length)) : undefined],
				['Caption', row.caption]
			])
		},
		{
			title: 'Counters',
			rows: pairs([
				['Views', count(row.views, facebook ? 'not read yet' : undefined)],
				['Plays without replays', count(num(insights.blue_reels_play_count))],
				['Average watched', avgMs != null ? `${(avgMs / 1000).toFixed(1)} s` : undefined],
				// Instagram's estimate (igstats.mjs); Facebook gives none.
				[
					'Skipped in the first 3 s',
					facebook
						? undefined
						: row.skipRate != null
							? `${row.skipRate.toLocaleString('en-GB', { maximumFractionDigits: 1 })} %`
							: 'not given yet'
				],
				['Accounts reached', count(row.reach)],
				['Likes', count(row.likes)],
				['Comments', count(row.comments)],
				['Shares', count(social?.SHARE ?? null)],
				['Samples kept', String(row.history?.length ?? 0)],
				['Last movement', last ? ago(last[0]) : undefined]
			])
		}
	].filter((g) => g.rows.length > 0);
}
