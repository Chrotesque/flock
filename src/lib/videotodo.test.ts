import { describe, expect, it } from 'vitest';
import {
	REELS_LISTED_FROM,
	TODO_DONE_MAX,
	isComplete,
	markDone,
	mergeStates,
	readTodoState,
	startOfDay,
	todoLines,
	videoUrl,
	WAITING,
	type StatsRow,
	type TodoReelRow,
	type TodoState,
	type UploadRow
} from './videotodo';

const since = '2026-10-10T22:00:00.000Z';
const fresh: TodoState = { since, jestr: [], studio: [], instagram: [], instagramSince: since };

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
		const row = { since, jestr: ['a'], studio: ['b'], instagram: ['r1'], instagramSince: '2026-10-20T22:00:00.000Z' };
		expect(readTodoState(row, null, 'x')).toEqual(row);
		expect(isComplete(row)).toBe(true);
	});

	it('adopts the Jestr-only list’s start and marks when there is no row', () => {
		expect(readTodoState(null, { since, done: ['a', 'b'] }, 'x')).toEqual({
			since,
			jestr: ['a', 'b'],
			studio: [],
			instagram: [],
			instagramSince: REELS_LISTED_FROM
		});
	});

	it('falls back on a missing or broken row, and drops what is not an id', () => {
		expect(readTodoState(null, null, since)).toEqual(fresh);
		expect(readTodoState({ since: 'soon', jestr: ['a', 3] }, null, since)).toEqual({
			...fresh,
			jestr: ['a'],
			instagramSince: REELS_LISTED_FROM
		});
	});

	it('starts the reels on the day they were first listed for a row from before them, until that is written', () => {
		const old = { since, jestr: [], studio: ['v1'] };
		expect(readTodoState(old, null, 'x').instagramSince).toBe(REELS_LISTED_FROM);
		expect(isComplete(old)).toBe(false);
		expect(isComplete(null)).toBe(false);
	});

	it('starts a new list’s reels where the list starts', () => {
		expect(readTodoState(null, null, '2026-12-01T23:00:00.000Z').instagramSince).toBe('2026-12-01T23:00:00.000Z');
	});
});

describe('markDone and mergeStates', () => {
	it('adds each id once, per kind', () => {
		const once = markDone(fresh, 'studio', 'a');
		expect(markDone(once, 'studio', 'a')).toEqual({ ...fresh, studio: ['a'] });
		expect(markDone(fresh, 'instagram', 'r1').instagram).toEqual(['r1']);
	});

	it('drops the oldest past the cap', () => {
		const full = { ...fresh, jestr: Array.from({ length: TODO_DONE_MAX }, (_, i) => `v${i}`) };
		const next = markDone(full, 'jestr', 'new');
		expect(next.jestr).toHaveLength(TODO_DONE_MAX);
		expect(next.jestr[0]).toBe('v1');
	});

	it('keeps both browsers’ marks', () => {
		const merged = mergeStates(
			{ ...fresh, jestr: ['a'], instagram: ['r1'] },
			{ since: 'other', jestr: ['b'], studio: ['c'], instagram: ['r2'], instagramSince: 'other' }
		);
		expect(merged).toEqual({ since, jestr: ['a', 'b'], studio: ['c'], instagram: ['r1', 'r2'], instagramSince: since });
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
		const state = { ...fresh, jestr: ['early', 'late'], studio: ['soon'] };
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

	it('says whether YouTube reports paid promotion, and null before the video is read', () => {
		const ticked = stat('soon', '2026-10-11 15:06:56.000Z', {
			data: { paidProductPlacementDetails: { hasPaidProductPlacement: true } }
		});
		const unticked = stat('soon', '2026-10-11 15:06:56.000Z', {
			data: { paidProductPlacementDetails: { hasPaidProductPlacement: false } }
		});
		expect(todoLines([ticked], uploads, fresh, { jestr: false })[0].paid).toBe(true);
		expect(todoLines([unticked], uploads, fresh, { jestr: false })[0].paid).toBe(false);
		expect(todoLines([stat('soon', '2026-10-11 15:06:56.000Z')], uploads, fresh, { jestr: false })[0].paid).toBe(false);
		expect(todoLines([], uploads, fresh, { jestr: false })[0].paid).toBeNull();
		const queued: UploadRow = { id: 't1', status: 'pending', created: '2026-10-11 20:50:30.000Z' };
		expect(todoLines([], [queued], fresh, { jestr: false })[0].paid).toBeNull();
	});

	it('carries the thumbnail and whether it is a Short, once the video is read', () => {
		const read = stat('soon', '2026-10-11 15:06:56.000Z', {
			data: { snippet: { thumbnails: { medium: { url: 'https://i.ytimg.com/vi/soon/mqdefault.jpg' } } } }
		});
		const line = todoLines([read], uploads, fresh, { jestr: false })[0];
		expect([line.thumb, line.thumbLarge, line.short]).toEqual([
			'https://i.ytimg.com/vi/soon/mqdefault.jpg',
			'https://i.ytimg.com/vi/soon/mqdefault.jpg',
			true
		]);
		const big = { ...read, data: { snippet: { thumbnails: { ...read.data?.snippet?.thumbnails, maxres: { url: 'max.jpg' } } } } };
		expect(todoLines([big], uploads, fresh, { jestr: false })[0].thumbLarge).toBe('max.jpg');
		const long = todoLines([{ ...read, duration: 900 }], uploads, fresh, { jestr: false })[0];
		expect(long.short).toBe(false);
		expect(todoLines([], uploads, fresh, { jestr: false }).map((l) => [l.thumb, l.short])).toEqual([['', false]]);
	});

	it('without Jestr, a video YouTube has is no line once Studio was opened for it', () => {
		const up: UploadRow = { id: 't1', status: 'scheduled', remote_url: 'https://www.youtube.com/watch?v=v1', created: '2026-10-11 20:50:30.000Z' };
		expect(todoLines([], [up], fresh, { jestr: false }).map((l) => l.studio)).toEqual([['thumbnail', 'paid promotion']]);
		expect(todoLines([], [up], { ...fresh, studio: ['v1'] }, { jestr: false })).toEqual([]);
	});
});

describe('todoLines with Instagram reels', () => {
	const up: UploadRow = {
		id: 't1',
		job: 'j1',
		title: 'Fresh',
		status: 'scheduled',
		remote_url: 'https://www.youtube.com/watch?v=v1',
		created: '2026-10-11 20:50:30.000Z'
	};
	const reel = (extra: Partial<TodoReelRow> = {}): TodoReelRow => ({
		id: 'r1',
		job: 'j1',
		remote_url: 'https://www.instagram.com/reel/abc/',
		status: 'published',
		scheduled_at: '2026-10-12 06:00:00.000Z',
		published_at: '2026-10-12 06:00:04.000Z',
		created: '2026-10-11 20:50:31.000Z',
		...extra
	});

	it('puts the same upload’s reel on its line, open once it is out', () => {
		const [line] = todoLines([], [up], fresh, { jestr: false }, [reel(), reel({ id: 'r2', job: 'other' })]);
		expect(line.instagram).toEqual({ state: 'open', target: 'r1', url: 'https://www.instagram.com/reel/abc/', at: null });
	});

	it('waits for a reel not out yet, with its slot', () => {
		const waiting = reel({ remote_url: '', status: 'pending', published_at: '' });
		const [line] = todoLines([], [up], fresh, { jestr: false }, [waiting]);
		expect(line.instagram).toEqual({ state: 'waiting', target: 'r1', url: '', at: '2026-10-12 06:00:00.000Z' });
		expect(todoLines([], [up], fresh, { jestr: false }, [reel({ remote_url: '', status: 'failed' })])[0].instagram).toBeNull();
	});

	it('keeps a line for its reel after Studio, and drops it once the reel was opened', () => {
		const studioDone = { ...fresh, studio: ['v1'] };
		const lines = todoLines([], [up], studioDone, { jestr: false }, [reel()]);
		expect(lines.map((l) => [l.id, l.studio, l.instagram?.state])).toEqual([['v1', [], 'open']]);
		expect(todoLines([], [up], { ...studioDone, instagram: ['r1'] }, { jestr: false }, [reel()])).toEqual([]);
	});

	it('shows a reel done while the line stays for something else', () => {
		const [line] = todoLines([], [up], { ...fresh, instagram: ['r1'] }, { jestr: false }, [reel()]);
		expect([line.studio.length, line.instagram?.state]).toEqual([2, 'done']);
	});

	it('lists the reels going out since they were listed, whenever they were confirmed', () => {
		const listed = { ...fresh, instagramSince: '2026-10-12T00:00:00.000Z' };
		expect(todoLines([], [up], listed, { jestr: false }, [reel()])[0].instagram?.state).toBe('open');
		const later = { ...fresh, instagramSince: '2026-10-12T07:00:00.000Z' };
		expect(todoLines([], [up], later, { jestr: false }, [reel()])[0].instagram).toBeNull();
		const queued = reel({ remote_url: '', status: 'pending', published_at: '', scheduled_at: '2026-10-13 06:00:00.000Z' });
		expect(todoLines([], [up], later, { jestr: false }, [queued])[0].instagram?.state).toBe('waiting');
	});
});
