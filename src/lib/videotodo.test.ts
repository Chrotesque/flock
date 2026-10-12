import { describe, expect, it } from 'vitest';
import {
	TODO_DONE_MAX,
	markDone,
	mergeStates,
	readTodoState,
	startOfDay,
	todoLines,
	videoUrl,
	WAITING,
	type StatsRow,
	type TodoState,
	type UploadRow
} from './videotodo';

const since = '2026-10-10T22:00:00.000Z';
const fresh: TodoState = { since, jestr: [], studio: [] };

const stat = (id: string, published: string, extra: Partial<StatsRow> = {}): StatsRow => ({
	video_id: id,
	title: `Video ${id}`,
	published_at: published,
	duration: 30,
	privacy: 'public',
	data: { snippet: { channelTitle: "Owl's Nest" } },
	...extra
});

const upload = (id: string, created: string): UploadRow => ({
	id: `t-${id}`,
	title: `Upload ${id}`,
	remote_url: `https://www.youtube.com/watch?v=${id}`,
	created
});

describe('startOfDay', () => {
	it('is local midnight of the same day', () => {
		const start = new Date(startOfDay(new Date(2026, 9, 11, 15, 42)));
		expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([
			2026, 9, 11, 0, 0
		]);
	});
});

describe('readTodoState', () => {
	it('keeps a good row', () => {
		expect(readTodoState({ since, jestr: ['a'], studio: ['b'] }, null, 'x')).toEqual({
			since,
			jestr: ['a'],
			studio: ['b']
		});
	});

	it('adopts the Jestr-only list’s start and marks when there is no row', () => {
		expect(readTodoState(null, { since, done: ['a', 'b'] }, 'x')).toEqual({ since, jestr: ['a', 'b'], studio: [] });
	});

	it('falls back on a missing or broken row, and drops what is not an id', () => {
		expect(readTodoState(null, null, since)).toEqual(fresh);
		expect(readTodoState({ since: 'soon', jestr: ['a', 3] }, null, since)).toEqual({ since, jestr: ['a'], studio: [] });
	});
});

describe('markDone and mergeStates', () => {
	it('adds each id once, per kind', () => {
		const once = markDone(fresh, 'studio', 'a');
		expect(markDone(once, 'studio', 'a')).toEqual({ since, jestr: [], studio: ['a'] });
	});

	it('drops the oldest past the cap', () => {
		const full = { ...fresh, jestr: Array.from({ length: TODO_DONE_MAX }, (_, i) => `v${i}`) };
		const next = markDone(full, 'jestr', 'new');
		expect(next.jestr).toHaveLength(TODO_DONE_MAX);
		expect(next.jestr[0]).toBe('v1');
	});

	it('keeps both browsers’ marks', () => {
		const merged = mergeStates({ since, jestr: ['a'], studio: [] }, { since: 'other', jestr: ['b'], studio: ['c'] });
		expect(merged).toEqual({ since, jestr: ['a', 'b'], studio: ['c'] });
	});
});

describe('videoUrl', () => {
	it('gives a Short its Shorts address and anything else the watch page', () => {
		expect(videoUrl('abc', 28, false)).toBe('https://www.youtube.com/shorts/abc');
		expect(videoUrl('abc', 600, false)).toBe('https://www.youtube.com/watch?v=abc');
		expect(videoUrl('abc', undefined, false)).toBe('https://www.youtube.com/watch?v=abc');
	});
});

describe('todoLines', () => {
	const stats = [
		stat('late', '2026-10-11 13:08:04.000Z'),
		stat('early', '2026-10-11 07:00:14.000Z'),
		stat('before', '2026-10-10 18:00:01.000Z'),
		stat('soon', '2026-10-11 15:06:56.000Z', {
			privacy: 'private',
			data: { snippet: { channelTitle: "Owl's Nest" }, status: { publishAt: '2026-10-11T15:30:00Z' } }
		}),
		stat('hidden', '2026-10-11 09:00:00.000Z', { privacy: 'unlisted' })
	];
	const uploads = [upload('soon', '2026-10-11 15:06:41.000Z')];

	it('without Jestr, lists only flock uploads, each with its cover and paid promotion to set', () => {
		const lines = todoLines(stats, uploads, fresh, { jestr: false });
		expect(lines.map((l) => [l.id, l.studio, l.jestr])).toEqual([['soon', ['Shorts cover', 'paid promotion'], null]]);
		expect(lines[0].studioUrl).toBe('https://studio.youtube.com/video/soon/edit');
		expect(lines[0].title).toBe('Video soon');
	});

	it('with Jestr, adds every video since the start, a scheduled one waiting', () => {
		const lines = todoLines(stats, uploads, fresh, { jestr: true });
		expect(lines.map((l) => [l.id, l.jestr])).toEqual([
			['early', 'open'],
			['late', 'open'],
			['soon', 'waiting']
		]);
		expect(lines[2].publicAt).toBe('2026-10-11T15:30:00Z');
	});

	it('drops a line once nothing is left on it', () => {
		const state = { since, jestr: ['early', 'late'], studio: ['soon'] };
		expect(todoLines(stats, uploads, state, { jestr: true }).map((l) => [l.id, l.studio, l.jestr])).toEqual([
			['soon', [], 'waiting']
		]);
		expect(todoLines(stats, uploads, { ...state, jestr: ['early', 'late', 'soon'] }, { jestr: true })).toEqual([]);
	});

	it('lists an upload the worker has not read yet by its own title, with the plain thumbnail', () => {
		const lines = todoLines([], [upload('new', '2026-10-11 16:00:00.000Z')], fresh, { jestr: true });
		expect(lines.map((l) => [l.id, l.title, l.studio])).toEqual([['new', 'Upload new', ['thumbnail', 'paid promotion']]]);
	});

	it('leaves out uploads from before the start; a long video gets its thumbnail', () => {
		const old = upload('before', '2026-10-10 17:00:00.000Z');
		const long = upload('long', '2026-10-11 10:00:00.000Z');
		const longStat = stat('long', '2026-10-11 10:00:00.000Z', { duration: 900, privacy: 'unlisted' });
		expect(todoLines([longStat], [old, long], fresh, { jestr: false }).map((l) => [l.id, l.studio])).toEqual([
			['long', ['thumbnail', 'paid promotion']]
		]);
	});

	it('holds a placeholder from confirm until YouTube has the video', () => {
		const queued: UploadRow = { id: 't1', title: 'Fresh', status: 'pending', created: '2026-10-11 20:50:30.000Z' };
		const sending: UploadRow = { ...queued, id: 't2', status: 'publishing' };
		const failed: UploadRow = { ...queued, id: 't3', status: 'failed' };
		const lines = todoLines([], [queued, sending, failed], fresh, { jestr: false });
		expect(lines.map((l) => [l.id, l.title, l.waiting, l.watchUrl])).toEqual([
			['upload:t1', 'Fresh', WAITING.queued, ''],
			['upload:t2', 'Fresh', WAITING.uploading, '']
		]);
	});

	it('with Jestr, keeps waiting until the channel lists the video, then hands over', () => {
		const up: UploadRow = { id: 't1', title: 'Fresh', status: 'scheduled', remote_url: 'https://www.youtube.com/watch?v=v1', created: '2026-10-11 20:50:30.000Z' };
		const before = todoLines([], [up], fresh, { jestr: true });
		expect(before.map((l) => [l.id, l.waiting, l.jestr, l.studioUrl])).toEqual([
			['v1', WAITING.listing, null, 'https://studio.youtube.com/video/v1/edit']
		]);
		const listed = stat('v1', '2026-10-12 19:00:00.000Z', {
			privacy: 'private',
			data: { status: { publishAt: '2026-10-12T19:00:00Z' } }
		});
		const after = todoLines([listed], [up], fresh, { jestr: true });
		expect(after.map((l) => [l.id, l.waiting, l.jestr])).toEqual([['v1', null, 'waiting']]);
	});

	it('without Jestr, a video YouTube has is no line once Studio was opened for it', () => {
		const up: UploadRow = { id: 't1', status: 'scheduled', remote_url: 'https://www.youtube.com/watch?v=v1', created: '2026-10-11 20:50:30.000Z' };
		expect(todoLines([], [up], fresh, { jestr: false }).map((l) => l.studio)).toEqual([['thumbnail', 'paid promotion']]);
		expect(todoLines([], [up], { ...fresh, studio: ['v1'] }, { jestr: false })).toEqual([]);
	});
});
