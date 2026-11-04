import { describe, expect, it } from 'vitest';
import { footNote } from './dashfoot';

describe('footNote', () => {
	it('names no other platform when only TikTok is in view', () => {
		const text = footNote(['tiktok'], false).join(' ');
		expect(text).toContain("Views, likes and comments are TikTok's own counters.");
		expect(text).toContain('For TikTok, which only reports how many an account has');
		expect(text).toContain('TikTok lists public videos only.');
		for (const other of ['YouTube', 'Instagram', 'Facebook', 'Sums across']) expect(text).not.toContain(other);
	});

	it('says everything with every platform in view', () => {
		const text = footNote(['youtube', 'instagram', 'tiktok', 'facebook'], true).join(' ');
		expect(text).toContain("each platform's own counters");
		expect(text).toContain('Sums across platforms, "usual"');
		expect(text).toContain("A video's followers are Facebook's own count for a reel and YouTube Analytics' for a video.");
		expect(text).toContain(
			"For Instagram and TikTok, which only report how many an account has, and for YouTube's newest days, a video's followers are flock's estimate"
		);
		expect(text).toContain('One channel at a time');
	});

	it("explains YouTube's newest days on their own", () => {
		const text = footNote(['youtube'], false).join(' ');
		expect(text).toContain("A video's followers are YouTube Analytics' for a video.");
		expect(text).toContain("For YouTube's newest days they are flock's estimate");
		expect(text).not.toContain('TikTok');
	});
});
