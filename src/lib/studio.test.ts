import { describe, expect, it } from 'vitest';
import {
	STUDIO_COVER,
	STUDIO_PAID,
	STUDIO_THUMBNAIL,
	isShortLength,
	studioNotes,
	studioTasks,
	studioUrl,
	videoIdOf
} from './studio';

describe('studioUrl and videoIdOf', () => {
	it('opens the video’s edit page', () => {
		expect(studioUrl('LTk4d1CwGQE')).toBe('https://studio.youtube.com/video/LTk4d1CwGQE/edit');
	});

	it('reads the id out of watch and Shorts addresses', () => {
		expect(videoIdOf('https://www.youtube.com/watch?v=LTk4d1CwGQE')).toBe('LTk4d1CwGQE');
		expect(videoIdOf('https://www.youtube.com/shorts/es-6eL_S3BE')).toBe('es-6eL_S3BE');
		expect(videoIdOf('https://www.instagram.com/reel/DeU7dOYiULb/')).toBe('');
		expect(videoIdOf(undefined)).toBe('');
	});
});

describe('isShortLength', () => {
	it('is a Short up to three minutes, unknown without a length', () => {
		expect(isShortLength(30)).toBe(true);
		expect(isShortLength(180)).toBe(true);
		expect(isShortLength(181)).toBe(false);
		expect(isShortLength(0)).toBeNull();
		expect(isShortLength(undefined)).toBeNull();
	});
});

describe('studioTasks', () => {
	it('always leaves the cover and paid promotion for a Short', () => {
		expect(studioTasks(30)).toEqual([STUDIO_COVER, STUDIO_PAID]);
	});

	it('the thumbnail and paid promotion for a long video, or one of unknown length', () => {
		expect(studioTasks(600)).toEqual([STUDIO_THUMBNAIL, STUDIO_PAID]);
		expect(studioTasks(undefined)).toEqual([STUDIO_THUMBNAIL, STUDIO_PAID]);
	});
});

describe('studioNotes', () => {
	it('says what to do in Studio before upload', () => {
		const notes = studioNotes(true, true, 30);
		expect(notes).toHaveLength(2);
		expect(notes[0]).toMatch(/^Tick paid promotion in YouTube Studio/);
		expect(notes[1]).toMatch(/^Set the Short's cover in Studio/);
	});

	it('hedges when the length is not known, and is quiet for a long video', () => {
		expect(studioNotes(false, true, 0)[0]).toMatch(/^If this is a Short/);
		expect(studioNotes(false, true, 600)).toEqual([]);
	});
});
