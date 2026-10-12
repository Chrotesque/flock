import { describe, expect, it } from 'vitest';
import {
	loggedFileName,
	mergeTimeline,
	optionLines,
	readUploadRecord,
	recordFromJob,
	slotMoved,
	type UploadRecord
} from './uploadrecord';
import type { UploadJob, UploadTarget } from './types';

const record: UploadRecord = {
	v: 1,
	version: '0.12.0',
	confirmedAt: '2026-10-12T10:00:00.000Z',
	timeZone: 'Europe/Berlin',
	brand: 'Owls Nest',
	project: '',
	video: { name: 'clip.mp4', size: 1000, duration: 42, source: 'nas', path: '\\\\nas\\in\\clip.mp4', previewed: true },
	others: [{ name: 'cut.mp4', platforms: ['tiktok'] }],
	destination: { label: 'Archive', path: '\\\\nas\\archive' },
	cover: null,
	devtest: [],
	targets: [
		{
			platform: 'youtube',
			account: 'Owls Nest',
			accountId: 'UC1',
			typed: { title: 'Hi https://x.y', description: 'Body' },
			title: 'Hi',
			description: 'Body',
			rules: [{ find: 'https://x.y', replace: '', count: 1 }],
			options: { visibility: 'Public', tags: ['a', 'b'], playlist: 'Clips' },
			immediate: false,
			date: '2026-10-13',
			time: '09:00',
			scheduledAt: '2026-10-13T07:00:00.000Z',
			profile: 'Morning',
			warnings: []
		}
	]
};

describe('readUploadRecord', () => {
	it('reads back what was written', () => {
		expect(readUploadRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
	});

	it('is null for anything that is not a record', () => {
		expect(readUploadRecord(null)).toBeNull();
		expect(readUploadRecord({ targets: [] })).toBeNull();
		expect(readUploadRecord('x')).toBeNull();
	});

	it('drops unknown platforms and odd values instead of failing', () => {
		const odd = readUploadRecord({
			v: 1,
			video: { source: 'floppy', size: 'big' },
			others: [{ name: 'x', platforms: ['youtube', 'myspace'] }],
			targets: [{ platform: 'myspace' }, { platform: 'tiktok', options: { privacy: 'Private', n: NaN, o: {} } }]
		})!;
		expect(odd.video.source).toBe('browser');
		expect(odd.video.size).toBe(0);
		expect(odd.others[0].platforms).toEqual(['youtube']);
		expect(odd.targets).toHaveLength(1);
		expect(odd.targets[0].options).toEqual({ privacy: 'Private' });
	});
});

describe('recordFromJob', () => {
	const job = {
		id: 'j1',
		title: 'Hi',
		description: '',
		video: '',
		source_path: '/mnt/user/Shared/in/clip.mp4',
		source_origin: 'D:\\rec\\clip.mp4',
		video_name: 'clip.mp4',
		video_size: 1000,
		video_duration: 42,
		destination_label: '',
		destination_path: '',
		status: 'done',
		brand_name: 'Owls Nest',
		created: '2026-10-01T10:00:00.000Z',
		updated: ''
	} as UploadJob;
	const target = (platform: 'tiktok' | 'youtube'): UploadTarget =>
		({
			id: platform,
			job: 'j1',
			platform,
			title: 'Hi',
			description: 'Body',
			options: { privacy: 'Private' },
			scheduled_at: '2026-10-02T07:00:00.000Z',
			status: 'published',
			created: '',
			updated: ''
		}) as UploadTarget;

	it('rebuilds what the stored upload still says, marked as such', () => {
		const rebuilt = recordFromJob(job, [target('tiktok'), target('youtube')]);
		expect(rebuilt.reconstructed).toBe(true);
		expect(rebuilt.video).toMatchObject({ name: 'clip.mp4', source: 'local', path: 'D:\\rec\\clip.mp4' });
		expect(rebuilt.targets.map((t) => t.platform)).toEqual(['youtube', 'tiktok']);
		expect(rebuilt.targets[1].typed).toEqual({ title: 'Hi', description: 'Body' });
		expect(rebuilt.destination).toBeNull();
	});
});

describe('loggedFileName', () => {
	it('takes the file name off an old upload row', () => {
		expect(loggedFileName('clip one.mp4 (from the watch folder) → 2 platform(s): youtube, tiktok · Owls Nest')).toBe(
			'clip one.mp4'
		);
		expect(loggedFileName('clip.mp4 (from a local folder) → 1 platform(s): instagram')).toBe('clip.mp4');
		expect(loggedFileName('clip.mp4 → 1 platform(s): youtube')).toBe('clip.mp4');
	});
});

describe('optionLines', () => {
	it('names registry fields, then box choices, then anything else', () => {
		const lines = optionLines('youtube', { visibility: 'Unlisted', tags: ['a'], playlist: 'Clips', legacy: 'x' });
		expect(lines[0]).toEqual({ key: 'visibility', label: 'Visibility', value: 'Unlisted', empty: false });
		const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
		expect(byKey.playlist.label).toBe('Playlist');
		expect(byKey.tags).toMatchObject({ label: 'Tags as sent', value: 'a' });
		expect(byKey.madeForKids.empty).toBe(true);
		expect(lines[lines.length - 1]).toMatchObject({ key: 'legacy', label: 'legacy', value: 'x' });
	});

	it("shows TikTok's hand-picked choices by their names", () => {
		const lines = optionLines('tiktok', { privacy: 'Private', allowComments: false });
		const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
		expect(byKey.privacy).toMatchObject({ label: 'Who can view this video', value: 'Private' });
		expect(byKey.allowComments).toMatchObject({ label: 'Allow comments', value: 'No' });
	});

	it("says TikTok's unticked boxes and an unchosen audience rather than leaving them out", () => {
		const byKey = Object.fromEntries(optionLines('tiktok', { allowComments: true }).map((l) => [l.key, l]));
		expect(byKey.privacy).toMatchObject({ value: 'not set', empty: true });
		expect(byKey.allowComments.value).toBe('Yes');
		expect(byKey.allowDuet.value).toBe('No');
		expect(byKey.discloseContent.value).toBe('No');
		expect(byKey.brandOrganic).toBeUndefined();
	});
});

describe('slotMoved', () => {
	it('notices a slot moved by a minute or more', () => {
		expect(slotMoved('2026-10-13T07:00:00.000Z', '2026-10-13T07:00:00.000Z')).toBe(false);
		expect(slotMoved('2026-10-13T07:00:00.000Z', '2026-10-13 08:00:00.000Z')).toBe(true);
		expect(slotMoved('', '2026-10-13T07:00:00.000Z')).toBe(false);
	});
});

describe('mergeTimeline', () => {
	it('puts rows and console lines in the order they happened', () => {
		const merged = mergeTimeline(
			[
				{ id: 'r1', created: '2026-10-12 10:00:00.000Z', action: 'Uploaded "x"', detail: 'clip.mp4', device: 'Desk' },
				{ id: 'r2', created: '2026-10-12 10:05:00.000Z', action: 'Published to youtube', detail: '', device: 'worker' }
			],
			[
				{ id: 'l2', created: '2026-10-12 10:05:00.000Z', message: 'done youtube "x"' },
				{ id: 'l1', created: '2026-10-12 10:01:00.000Z', message: 'claimed youtube "x"' }
			]
		);
		expect(merged.map((e) => e.id)).toEqual(['r1', 'l1', 'r2', 'l2']);
		expect(merged[1]).toMatchObject({ kind: 'console', by: 'worker', text: 'claimed youtube "x"' });
	});
});
