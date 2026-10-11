import { describe, expect, it } from 'vitest';
import { listedProjects, projectState, readSavedDraft, readVideos, uploadedName, withoutHandPicked } from './projects';
import type { ProjectRow } from './types';

function row(patch: Partial<ProjectRow>): ProjectRow {
	return {
		id: 'p',
		key: '',
		path: 'D:\\Projects\\Monetized\\Cats',
		name: 'Cats',
		root: 'D:\\Projects\\Monetized',
		local: true,
		manifest: '{"flock":1}',
		manifest_name: 'flock.json',
		manifest_modified: '2026-10-11T10:00:00.000Z',
		videos: [],
		missing: false,
		error: '',
		status: '',
		draft: null,
		thumbnail: '',
		cover: '',
		done_at: '',
		archived_at: '',
		archived_as: '',
		created: '2026-10-11 10:00:00.000Z',
		updated: '2026-10-11 10:00:00.000Z',
		...patch
	};
}

describe('withoutHandPicked', () => {
	it('drops what TikTok wants picked by hand, and paid promotion', () => {
		const out = withoutHandPicked({
			tiktok: { privacy: 'Public', allowComments: true, coverFrame: 2 },
			youtube: { paidPromotion: true, tagsOther: ['a'] }
		});
		expect(out.overrides).toEqual({ tiktok: { coverFrame: 2 }, youtube: { tagsOther: ['a'] } });
		expect(out.dropped).toBe(true);
	});

	it('does not count an unticked box as a dropped choice', () => {
		const out = withoutHandPicked({ tiktok: { allowDuet: false }, instagram: { shareToFeed: true } });
		expect(out.overrides).toEqual({ instagram: { shareToFeed: true } });
		expect(out.dropped).toBe(false);
	});
});

describe('readSavedDraft', () => {
	it('is null for anything that is not a saved draft', () => {
		expect(readSavedDraft(null)).toBeNull();
		expect(readSavedDraft({ v: 2 })).toBeNull();
		expect(readSavedDraft([])).toBeNull();
	});

	it('reads a draft field by field, dropping what does not fit', () => {
		const saved = readSavedDraft({
			v: 1,
			base: 'b',
			brand: 'br',
			step: 7,
			composing: 'myspace',
			texts: { youtube: { title: 'T', description: 'D' }, myspace: { title: 'x' }, tiktok: 'nope' },
			selected: { youtube: true, instagram: 'yes' },
			overrides: { youtube: { tagsOther: ['a', 'b'], bad: { deep: 1 }, paidPromotion: true } },
			schedule: { youtube: { date: '2026-10-12', time: '08:00' }, tiktok: { date: 1 } },
			immediate: { tiktok: true },
			profile: { youtube: 'pr1' },
			split: ['tiktok', 'tiktok', 'nope'],
			videos: { all: { name: 'a.mp4', path: 'D:\\a.mp4', size: 10, local: true }, tiktok: { name: 'x' }, nope: {} },
			imagesLinked: false,
			thumbnailName: 'thumb.png',
			queued: ['all', 'all', 'zzz'],
			repick: true
		});
		expect(saved).toEqual({
			v: 1,
			base: 'b',
			brand: 'br',
			step: 0,
			composing: null,
			texts: { youtube: { title: 'T', description: 'D' } },
			selected: { youtube: true },
			overrides: { youtube: { tagsOther: ['a', 'b'] } },
			schedule: { youtube: { date: '2026-10-12', time: '08:00' } },
			immediate: { tiktok: true },
			profile: { youtube: 'pr1' },
			split: ['tiktok'],
			videos: { all: { name: 'a.mp4', path: 'D:\\a.mp4', size: 10, modified: '', local: true } },
			imagesLinked: false,
			thumbnailName: 'thumb.png',
			coverName: '',
			queued: ['all'],
			repick: true
		});
	});
});

describe('readVideos', () => {
	it('keeps only entries with a path and a name', () => {
		expect(readVideos([{ name: 'a.mp4', path: 'p', size: 3, modified: 'm' }, { name: 'b' }, 5])).toEqual([
			{ name: 'a.mp4', path: 'p', size: 3, modified: 'm' }
		]);
		expect(readVideos(null)).toEqual([]);
	});
});

describe('projectState', () => {
	it('reads the status the page wrote', () => {
		expect(projectState(row({}))).toBe('new');
		expect(projectState(row({ status: 'started' }))).toBe('started');
		expect(projectState(row({ status: 'uploaded' }))).toBe('done');
		expect(projectState(row({ status: 'dismissed' }))).toBe('done');
	});
});

describe('listedProjects', () => {
	const roots = [{ id: 'r', path: 'd:\\projects\\monetized\\' }];

	it('lists what is still to send, under a configured folder', () => {
		const rows = [
			row({ id: 'a' }),
			row({ id: 'sent', status: 'uploaded' }),
			row({ id: 'gone', missing: true }),
			row({ id: 'other', root: 'D:\\Elsewhere' })
		];
		expect(listedProjects(rows, roots).map((r) => r.id)).toEqual(['a']);
	});

	it('puts started ones first, then the newest project files', () => {
		const rows = [
			row({ id: 'old', manifest_modified: '2026-10-01T00:00:00Z' }),
			row({ id: 'new', manifest_modified: '2026-10-10T00:00:00Z' }),
			row({ id: 'begun', status: 'started', manifest_modified: '2026-09-01T00:00:00Z' })
		];
		expect(listedProjects(rows, roots).map((r) => r.id)).toEqual(['begun', 'new', 'old']);
	});
});

describe('uploadedName', () => {
	it('names the file a sent project is renamed to', () => {
		expect(uploadedName('flock.json')).toBe('flock_uploaded.json');
		expect(uploadedName('Upload.JSON')).toBe('Upload_uploaded.json');
		expect(uploadedName('')).toBe('flock_uploaded.json');
	});
});
