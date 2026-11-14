import { describe, expect, it } from 'vitest';
import type { DashTarget } from './dashboard';
import { rowWords, workerJobs } from './workerjobs';

const now = Date.parse('2026-11-04T02:10:00Z');

function post(platform: DashTarget['platform'], status: string, extra: Partial<DashTarget> = {}): DashTarget {
	return {
		id: `${platform}-1`,
		job: 'j1',
		platform,
		status,
		scheduled_at: '2026-11-04T01:56:00Z',
		title: 'Caption',
		visibility: '',
		jobTitle: 'THE MOUND',
		jobCreated: '',
		brand: 'b1',
		importing: false,
		jobError: '',
		...extra
	};
}

describe('workerJobs', () => {
	it('lists finished platforms in the order they finished, and the rest below', () => {
		const tasks = [
			{ text: 'Publishing to YouTube: "x"', job: 'j1', platform: 'youtube' as const, progress: 82 },
			{ text: 'Publishing to Instagram: "x"', job: 'j1', platform: 'instagram' as const, progress: 40, tries: { n: 3, max: 12 } }
		];
		const targets = [
			post('youtube', 'publishing'),
			post('instagram', 'publishing'),
			post('tiktok', 'published', { updated: '2026-11-04T02:03:51Z' }),
			post('facebook', 'published', { updated: '2026-11-04T02:01:00Z' })
		];
		const { jobs, other } = workerJobs(tasks, targets, now);
		expect(other).toEqual([]);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].title).toBe('THE MOUND');
		expect(jobs[0].brand).toBe('b1');
		expect(jobs[0].done).toEqual(['facebook', 'tiktok']);
		expect(jobs[0].rows.map((r) => [r.platform, r.state, r.progress])).toEqual([
			['youtube', 'working', 82],
			['instagram', 'working', 40]
		]);
	});

	it('marks a release held for its minute, and a failed post', () => {
		const tasks = [{ text: 'Publishing to Instagram: "x"', job: 'j1', platform: 'instagram' as const, until: '2026-11-04T03:00:00Z' }];
		const targets = [post('instagram', 'publishing'), post('tiktok', 'failed', { error: 'nope' })];
		const { jobs } = workerJobs(tasks, targets, now);
		expect(jobs[0].rows.map((r) => r.state)).toEqual(['instagram', 'tiktok'].map((p) => (p === 'instagram' ? 'held' : 'failed')));
	});

	it('keeps tasks no upload owns apart, and shows a task whose post is not read yet', () => {
		const tasks = [
			{ text: 'Filing "x" into its destination' },
			{ text: 'Publishing to TikTok: "Hello"', job: 'j9', platform: 'tiktok' as const, progress: 10 }
		];
		const { jobs, other } = workerJobs(tasks, [], now);
		expect(other).toEqual([{ text: 'Filing "x" into its destination' }]);
		expect(jobs[0].title).toBe('Hello');
		expect(jobs[0].rows[0].state).toBe('working');
	});
});

describe('an Instagram reel between tries (worker/igprep.mjs)', () => {
	const prep = { state: 'trying', since: '2026-11-04T01:00:00Z', tries: 7, lastError: 'refused (400)', nextTryAt: '2026-11-04T02:20:00Z' };

	it('is listed though no heartbeat names it', () => {
		const { jobs } = workerJobs([], [post('youtube', 'published'), post('instagram', 'pending', { prep })], now);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].done).toEqual(['youtube']);
		expect(jobs[0].rows).toEqual([{ platform: 'instagram', state: 'retrying', refused: 7, next: prep.nextTryAt, error: 'refused (400)' }]);
	});

	it('gives way to the try in hand, and is not listed before a first refusal or once ready', () => {
		const task = { text: 'Publishing to Instagram: "x"', job: 'j1', platform: 'instagram' as const, progress: 40 };
		expect(workerJobs([task], [post('instagram', 'pending', { prep })], now).jobs[0].rows[0].state).toBe('working');
		expect(workerJobs([], [post('instagram', 'pending', { prep: { ...prep, tries: 0 } })], now).jobs).toEqual([]);
		expect(workerJobs([], [post('instagram', 'pending', { prep: { ...prep, state: 'ready' } })], now).jobs).toEqual([]);
	});

	it('says the refusals and the next try', () => {
		const later = new Date(Date.now() + 600_000).toISOString();
		expect(rowWords({ platform: 'instagram', state: 'retrying', refused: 7, next: later }, () => '16:22')).toEqual([
			'Retrying · 7 refused',
			'next try 16:22'
		]);
		expect(rowWords({ platform: 'instagram', state: 'retrying', refused: 7, next: '2000-01-01T00:00:00Z' }, () => '')).toEqual([
			'Retrying · 7 refused',
			'trying again now'
		]);
	});
});

describe('rowWords', () => {
	const time = () => '15:00';
	it('says progress, and retries from the second try on', () => {
		expect(rowWords({ platform: 'instagram', state: 'working', progress: 82 }, time)).toEqual(['Progress: 82%']);
		expect(rowWords({ platform: 'instagram', state: 'working', progress: 0, tries: { n: 3, max: 12 } }, time)).toEqual([
			'Progress: 0%',
			'Retries: 2/11'
		]);
		expect(rowWords({ platform: 'youtube', state: 'working', progress: 100 }, time)).toEqual(['Progress: 100% · processing']);
	});

	it('names a held release and a wait', () => {
		expect(rowWords({ platform: 'instagram', state: 'held', until: 'x' }, time)).toEqual(['Held for its slot · out at 15:00']);
		expect(rowWords({ platform: 'tiktok', state: 'waiting', until: 'x' }, time)).toEqual(['Waiting · slot 15:00']);
	});
});
