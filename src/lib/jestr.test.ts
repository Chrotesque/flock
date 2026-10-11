import { describe, expect, it } from 'vitest';
import {
	JESTR_DONE_MAX,
	markDone,
	mergeDone,
	pendingVideos,
	readJestrState,
	startOfDay,
	videoUrl,
	type JestrRow
} from './jestr';

const since = '2026-10-10T22:00:00.000Z';
const row = (id: string, published: string, extra: Partial<JestrRow> = {}): JestrRow => ({
	video_id: id,
	title: `Video ${id}`,
	published_at: published,
	duration: 30,
	data: { snippet: { channelTitle: "Owl's Nest" } },
	...extra
});

describe('startOfDay', () => {
	it('is local midnight of the same day', () => {
		const start = new Date(startOfDay(new Date(2026, 9, 11, 15, 42)));
		expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([
			2026, 9, 11, 0, 0
		]);
	});
});

describe('readJestrState', () => {
	it('keeps a good row', () => {
		expect(readJestrState({ since, done: ['a', 'b'] }, 'x')).toEqual({ since, done: ['a', 'b'] });
	});

	it('falls back on a missing or broken row, and drops what is not an id', () => {
		expect(readJestrState(null, since)).toEqual({ since, done: [] });
		expect(readJestrState({ since: 'soon', done: ['a', 3, null] }, since)).toEqual({ since, done: ['a'] });
	});
});

describe('markDone and mergeDone', () => {
	it('adds each id once', () => {
		const once = markDone({ since, done: ['a'] }, 'b');
		expect(markDone(once, 'b').done).toEqual(['a', 'b']);
	});

	it('drops the oldest past the cap', () => {
		const full = { since, done: Array.from({ length: JESTR_DONE_MAX }, (_, i) => `v${i}`) };
		const next = markDone(full, 'new');
		expect(next.done).toHaveLength(JESTR_DONE_MAX);
		expect(next.done[0]).toBe('v1');
		expect(next.done.at(-1)).toBe('new');
	});

	it('keeps both browsers’ marks', () => {
		expect(mergeDone({ since, done: ['a', 'b'] }, { since, done: ['b', 'c'] }).done).toEqual(['a', 'b', 'c']);
	});
});

describe('videoUrl', () => {
	it('gives a Short its Shorts address and anything else the watch page', () => {
		expect(videoUrl('abc', 28, false)).toBe('https://www.youtube.com/shorts/abc');
		expect(videoUrl('abc', 600, false)).toBe('https://www.youtube.com/watch?v=abc');
		expect(videoUrl('abc', 28, true)).toBe('https://www.youtube.com/watch?v=abc');
		expect(videoUrl('abc', undefined, false)).toBe('https://www.youtube.com/watch?v=abc');
	});
});

describe('pendingVideos', () => {
	const rows = [
		row('late', '2026-10-11 13:08:04.000Z'),
		row('early', '2026-10-11 07:00:14.000Z'),
		row('before', '2026-10-10 18:00:01.000Z')
	];

	it('lists what went public since the list began, oldest first', () => {
		expect(pendingVideos(rows, { since, done: [] }).map((v) => v.id)).toEqual(['early', 'late']);
	});

	it('leaves out what was marked', () => {
		expect(pendingVideos(rows, { since, done: ['early'] }).map((v) => v.id)).toEqual(['late']);
	});

	it('carries what a line shows', () => {
		const [video] = pendingVideos([rows[1]], { since, done: [] });
		expect(video).toEqual({
			id: 'early',
			title: 'Video early',
			channel: "Owl's Nest",
			publishedAt: '2026-10-11T07:00:14.000Z',
			url: 'https://www.youtube.com/shorts/early'
		});
	});

	it('names an untitled video by its id', () => {
		expect(pendingVideos([row('x', '2026-10-11 08:00:00.000Z', { title: '' })], { since, done: [] })[0].title).toBe('x');
	});
});
