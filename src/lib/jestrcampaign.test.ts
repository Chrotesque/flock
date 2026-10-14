import { describe, expect, it } from 'vitest';
import { NO_MARKS, flaggedPosts, isCampaign, mark, readMarks, tickedIn, withTick } from './jestrcampaign';

const yt = { id: 'Ab3dE6gH9jK' };
const ig = { id: '17900000000000001', url: 'https://www.instagram.com/reel/Cx1-Yz2Ab3/' };

describe('readMarks', () => {
	it('keeps true and false marks and drops anything else', () => {
		expect(readMarks({ youtube: { a: true, b: false, c: 'yes' }, instagram: null, other: 1 })).toEqual({
			youtube: { a: true, b: false },
			instagram: {}
		});
		expect(readMarks(null)).toEqual(NO_MARKS);
	});
});

describe('isCampaign', () => {
	const flagged = flaggedPosts([
		{ platform: 'youtube', remote_url: 'https://www.youtube.com/watch?v=Ab3dE6gH9jK', jestr: true },
		{ platform: 'instagram', remote_url: 'https://www.instagram.com/reel/Zz9/', jestr: true },
		{ platform: 'facebook', remote_url: 'https://www.facebook.com/reel/1/', jestr: true },
		{ platform: 'youtube', remote_url: 'https://www.youtube.com/watch?v=Qr5sT7uV9wX' }
	]);

	it('takes the upload’s tick on either post', () => {
		expect(isCampaign({ youtube: yt }, NO_MARKS, flagged)).toBe(true);
		expect(isCampaign({ instagram: { id: 'x', url: 'http://instagram.com/reel/Zz9?igsh=2' } }, NO_MARKS, flagged)).toBe(true);
		expect(isCampaign({ youtube: { id: 'Qr5sT7uV9wX' } }, NO_MARKS, flagged)).toBe(false);
	});

	it('lets a dashboard mark win over the tick, either way', () => {
		const off = mark(NO_MARKS, { youtube: yt, instagram: ig }, false);
		expect(isCampaign({ youtube: yt, instagram: ig }, off, flagged)).toBe(false);
		const on = mark(NO_MARKS, { instagram: ig }, true);
		expect(isCampaign({ instagram: ig }, on, flaggedPosts([]))).toBe(true);
	});

	it('marks every post of a video', () => {
		const out = mark(NO_MARKS, { youtube: yt, instagram: ig }, true);
		expect(out.youtube[yt.id]).toBe(true);
		expect(out.instagram[ig.id]).toBe(true);
	});
});

describe('the Details tick', () => {
	it('is on when any Jestr platform carries it', () => {
		expect(tickedIn({ instagram: { jestrCampaign: true } })).toBe(true);
		expect(tickedIn({ facebook: { jestrCampaign: true } })).toBe(false);
		expect(tickedIn({})).toBe(false);
	});

	it('is set on YouTube, Instagram and TikTok and taken off again, keeping other choices', () => {
		const on = withTick({ tiktok: { privacy: 'Public' } }, true);
		expect(on).toEqual({
			youtube: { jestrCampaign: true },
			instagram: { jestrCampaign: true },
			tiktok: { privacy: 'Public', jestrCampaign: true }
		});
		expect(withTick(on, false)).toEqual({ tiktok: { privacy: 'Public' } });
	});
});
