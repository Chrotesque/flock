import { describe, expect, it } from 'vitest';
import { depthOf, toneOf } from './workerlog';

describe('toneOf', () => {
	it('reads failures', () => {
		expect(toneOf('FAILED instagram "x": Instagram 100: video_url is required')).toBe('fail');
		expect(toneOf('  thumbnail failed (video is still up): 500')).toBe('fail');
		expect(toneOf('stopped: Cannot reach PocketBase')).toBe('fail');
	});

	it('reads skips', () => {
		expect(toneOf('  playlist skipped: the upload-only grant cannot touch playlists.')).toBe('skip');
		expect(toneOf('  thumbnail skipped: YouTube refused it.')).toBe('skip');
		expect(toneOf('  playlist "First Peck" not found on the channel — video left out of it')).toBe('skip');
		expect(toneOf('2 pending for facebook, which is not set up here')).toBe('skip');
	});

	it('reads successes and leaves the rest plain', () => {
		expect(toneOf('done youtube "x" — live as private  https://youtu.be/x')).toBe('done');
		expect(toneOf('  thumbnail set (120 KB)')).toBe('done');
		expect(toneOf('  added to playlist "First Peck"')).toBe('done');
		expect(toneOf('watch folder: 3 video(s) in \\\\nas\\x')).toBe('');
		expect(toneOf('  40%')).toBe('');
	});
});

describe('depthOf', () => {
	it('counts two spaces a level, capped', () => {
		expect(depthOf('claimed youtube')).toBe(0);
		expect(depthOf('  40%')).toBe(1);
		expect(depthOf('          deep')).toBe(3);
	});
});
