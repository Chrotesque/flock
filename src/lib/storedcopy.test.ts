import { describe, expect, it } from 'vitest';
import { copyOf, mixedContent, playerBox, shortPath, storedProblem, TALL, WIDE } from './storedcopy';

const job = (fields: Partial<Parameters<typeof copyOf>[0]> = {}) => ({
	destination_path: '\\\\nas\\shared\\testing',
	stored_path: '',
	status: 'done',
	video_name: 'clip.mp4',
	video: '',
	...fields
});

describe('copyOf', () => {
	it('takes the path the worker recorded', () => {
		expect(copyOf(job({ stored_path: '\\\\nas\\shared\\testing\\clip (2).mp4' }))).toEqual({
			state: 'stored',
			path: '\\\\nas\\shared\\testing\\clip (2).mp4'
		});
	});

	it('guesses the folder and name for a copy made before the path was recorded', () => {
		expect(copyOf(job())).toEqual({ state: 'stored', path: '\\\\nas\\shared\\testing\\clip.mp4' });
		expect(copyOf(job({ destination_path: '/mnt/user/Shared/testing/' }))).toEqual({
			state: 'stored',
			path: '/mnt/user/Shared/testing/clip.mp4'
		});
		expect(copyOf(job({ video_name: '', video: 'clip_ab12cd.mp4' }))).toEqual({
			state: 'stored',
			path: '\\\\nas\\shared\\testing\\clip_ab12cd.mp4'
		});
	});

	it('waits for the copy, and has none without a destination', () => {
		expect(copyOf(job({ status: 'stored' }))).toEqual({ state: 'pending' });
		expect(copyOf(job({ destination_path: ' ' }))).toEqual({ state: 'none' });
		expect(copyOf(job({ destination_path: '', stored_path: '\\\\nas\\x\\clip.mp4' }))).toEqual({ state: 'none' });
	});
});

describe('shortPath', () => {
	it('keeps the folder and the file, in the path’s own separators', () => {
		expect(shortPath('\\\\nas\\shared\\testing\\clip.mp4')).toBe('testing\\clip.mp4');
		expect(shortPath('/mnt/user/Shared/testing/clip.mp4')).toBe('testing/clip.mp4');
		expect(shortPath('clip.mp4')).toBe('clip.mp4');
	});
});

describe('mixedContent', () => {
	it('blocks plain http from an https page', () => {
		expect(mixedContent('https:', 'http://192.0.2.10:8790')).toBe(true);
		expect(mixedContent('https:', 'http://nas.example.ts.net:8790')).toBe(true);
	});

	it('lets https through, loopback through, and anything from an http page', () => {
		expect(mixedContent('https:', 'https://worker.example.ts.net')).toBe(false);
		expect(mixedContent('https:', 'http://127.0.0.1:8790')).toBe(false);
		expect(mixedContent('https:', 'http://localhost:8790')).toBe(false);
		expect(mixedContent('http:', 'http://192.0.2.10:8790')).toBe(false);
		expect(mixedContent('https:', 'not a url')).toBe(false);
	});
});

describe('playerBox', () => {
	it('stands an upright video at full height', () => {
		expect(playerBox(9 / 16)).toEqual({ width: 198, height: TALL });
		expect(playerBox(0.1).width).toBe(140);
	});

	it('lays a wide video at full width, never taller than an upright one', () => {
		expect(playerBox(16 / 9)).toEqual({ width: WIDE, height: 243 });
		expect(playerBox(1)).toEqual({ width: WIDE, height: TALL });
	});

	it('takes a wide box for a shape it cannot read', () => {
		expect(playerBox(NaN)).toEqual(playerBox(16 / 9));
		expect(playerBox(0)).toEqual(playerBox(16 / 9));
	});
});

describe('storedProblem', () => {
	it('names each answer of the worker’s check', () => {
		for (const error of ['no-job', 'not-stored', 'gone', 'differs', 'refused']) {
			const reason = storedProblem(error);
			expect(reason.title).not.toBe('');
			expect(reason.text).not.toMatch(/\(/);
		}
		expect(storedProblem('weird').text).toContain('weird');
	});
});
