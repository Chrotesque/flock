import { describe, expect, it } from 'vitest';
import { previewCheckUrl, previewProblem, previewVideoUrl, playbackProblem } from './preview';

describe('previewVideoUrl', () => {
	it('names the list and the path in the query', () => {
		const url = new URL(previewVideoUrl('http://127.0.0.1:8790', 'local', 'D:\\Echo\\take 1.mp4'));
		expect(url.origin).toBe('http://127.0.0.1:8790');
		expect(url.pathname).toBe('/video');
		expect(url.searchParams.get('source')).toBe('local');
		expect(url.searchParams.get('path')).toBe('D:\\Echo\\take 1.mp4');
	});

	it('survives a trailing slash on the address', () => {
		expect(previewVideoUrl('https://pc.example.ts.net/', 'nas', 'x.mp4')).toMatch(
			/^https:\/\/pc\.example\.ts\.net\/video\?/
		);
	});

	it('carries characters that mean something in a URL through intact', () => {
		for (const path of [
			'\\\\nas\\shared\\flock-incoming\\a&b=c.mp4',
			'/mnt/user/shared/50% off #1?.mp4',
			'D:\\Echo\\clip+plus.mp4',
			'D:\\Echo\\ünïcödé ✓.mp4'
		]) {
			const url = new URL(previewVideoUrl('http://127.0.0.1:8790', 'nas', path));
			expect(url.searchParams.get('path')).toBe(path);
			expect([...url.searchParams.keys()]).toEqual(['source', 'path']);
		}
	});
});

describe('previewCheckUrl', () => {
	it('asks the same file of the check endpoint', () => {
		const check = new URL(previewCheckUrl('http://127.0.0.1:8790', 'nas', 'x.mp4'));
		const video = new URL(previewVideoUrl('http://127.0.0.1:8790', 'nas', 'x.mp4'));
		expect(check.pathname).toBe('/check');
		expect(check.search).toBe(video.search);
	});
});

describe('previewProblem', () => {
	it('explains each refusal the worker can give', () => {
		expect(previewProblem('not-listed')).toMatch(/not listed this file/);
		expect(previewProblem('gone')).toMatch(/no longer there/);
	});

	it('passes on a refusal it does not know, and copes with none', () => {
		expect(previewProblem('teapot')).toContain('(teapot)');
		expect(previewProblem(undefined)).toBe('The worker would not play this file.');
	});
});

describe('playbackProblem', () => {
	it('tells a broken stream from a format the browser cannot play', () => {
		expect(playbackProblem(2)).toMatch(/broke off/);
		expect(playbackProblem(4)).toMatch(/format/);
		expect(playbackProblem(3)).toBe(playbackProblem(4));
		expect(playbackProblem(undefined)).toBe('The browser could not play this file.');
	});
});
