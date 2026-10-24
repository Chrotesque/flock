import { describe, expect, it } from 'vitest';
import {
	changedAnything,
	editChanges,
	editHold,
	editing,
	planEdit,
	stepWords,
	type EditPost,
	type EditRow,
	type EditState
} from './uploadedit';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

function post(extra: Partial<EditPost> = {}): EditPost {
	return {
		id: 'p1',
		platform: 'tiktok',
		status: 'pending',
		scheduled_at: at(5),
		title: '',
		description: 'Owls at dusk #owls',
		options: { privacy: 'Public', coverImageAt: 'end' },
		...extra
	};
}

function state(extra: Partial<EditState> = {}): EditState {
	return { title: '', description: 'Owls at dusk #owls', options: { privacy: 'Public', coverImageAt: 'end' }, at: at(5), ...extra };
}

function row(extra: Partial<EditRow> = {}): EditRow {
	return { platform: 'tiktok', immediate: false, kept: true, ...state(), ...extra };
}

describe('editHold', () => {
	it("lets the page rewrite a post flock still holds, a failed one included", () => {
		expect(editHold(post(), NOW)).toEqual({ by: 'page' });
		expect(editHold(post({ status: 'failed', scheduled_at: at(-2) }), NOW)).toEqual({ by: 'page' });
	});

	it('leaves a YouTube video the platform holds to the worker', () => {
		expect(editHold(post({ platform: 'youtube', status: 'scheduled', remote_url: 'https://youtu.be/x' }), NOW)).toEqual({
			by: 'worker'
		});
	});

	it('locks what is out, in hand, about to go, or cancelled — with why', () => {
		expect(editHold(post({ status: 'published' }), NOW)).toEqual({ refused: 'It is out on TikTok already.' });
		expect(editHold(post({ status: 'publishing' }), NOW)).toEqual({
			refused: 'The worker has it ready for its minute; TikTok takes it as it is.'
		});
		expect(editHold(post({ platform: 'instagram', scheduled_at: at(0.15) }), NOW)).toEqual({
			refused: 'The worker takes it up for Instagram any moment now.'
		});
		expect(editHold(post({ status: 'cancelled' }), NOW)).toEqual({ refused: 'It was cancelled.' });
		expect(editHold(post({ status: 'failed', remote_url: 'https://x' }), NOW)).toEqual({
			refused: "TikTok has it; see the upload's overview."
		});
		expect(editHold(post({ request: { kind: 'delete' } }), NOW)).toEqual({ refused: 'The worker is on it already.' });
	});

	it('does not reach into a reel Facebook holds yet', () => {
		expect(editHold(post({ platform: 'facebook', status: 'scheduled' }), NOW)).toEqual({
			refused: 'Facebook has it already; flock cannot edit it there yet.'
		});
	});
});

describe('editChanges', () => {
	it('names what was touched, and nothing else', () => {
		const changes = editChanges(state(), row({ description: 'Owls at dawn', options: { privacy: 'Friends', coverImageAt: 'end' } }));
		expect(changes).toEqual({ text: true, options: ['privacy'], time: false });
		expect(changedAnything(editChanges(state(), row()))).toBe(false);
	});

	it('counts a time only to the minute, and going out now as a new time', () => {
		expect(editChanges(state(), row({ at: new Date(NOW + 5 * 3_600_000 + 20_000).toISOString() })).time).toBe(false);
		expect(editChanges(state(), row({ at: at(6) })).time).toBe(true);
		expect(editChanges(state(), row({ immediate: true })).time).toBe(true);
	});

	it('compares lists by their content', () => {
		const base = state({ options: { tags: ['a', 'b'] } });
		expect(editChanges(base, row({ options: { tags: ['a', 'b'] } })).options).toEqual([]);
		expect(editChanges(base, row({ options: { tags: ['b', 'a'] } })).options).toEqual(['tags']);
	});
});

describe('planEdit', () => {
	const opened = ['tiktok' as const];

	it('writes nothing for an untouched post, even one locked since', () => {
		const result = planEdit({ posts: [post({ status: 'publishing' })], baseline: { tiktok: state() }, opened, rows: [row()], now: NOW });
		expect(result).toEqual({ steps: [], refused: [] });
	});

	it('rewrites a post flock holds, whole', () => {
		const { steps, refused } = planEdit({
			posts: [post()],
			baseline: { tiktok: state() },
			opened,
			rows: [row({ description: 'Owls at dawn', at: at(7) })],
			now: NOW
		});
		expect(refused).toEqual([]);
		expect(steps).toEqual([
			{
				kind: 'update',
				id: 'p1',
				platform: 'tiktok',
				patch: { title: '', description: 'Owls at dawn', options: { privacy: 'Public', coverImageAt: 'end' }, scheduled_at: at(7) },
				changes: { text: true, options: [], time: true }
			}
		]);
		expect(stepWords(steps[0])).toBe('TikTok: text, time changed');
	});

	it('sends a failed post again, and an immediate one now', () => {
		const { steps } = planEdit({
			posts: [post({ status: 'failed', scheduled_at: at(-1), handle: { run: 'r' }, remote_url: '' })],
			baseline: { tiktok: state({ at: at(-1) }) },
			opened,
			rows: [row({ immediate: true, at: at(-1) })],
			now: NOW
		});
		expect(steps[0]).toMatchObject({
			kind: 'update',
			patch: { scheduled_at: new Date(NOW).toISOString(), status: 'pending', error: '', handle: null }
		});
	});

	it('refuses a time under 15 minutes ahead', () => {
		const { steps, refused } = planEdit({
			posts: [post()],
			baseline: { tiktok: state() },
			opened,
			rows: [row({ at: at(0.1) })],
			now: NOW
		});
		expect(steps).toEqual([]);
		expect(refused).toEqual(['TikTok: At least 15 minutes from now.']);
	});

	it('refuses the whole post when the worker took it up since the edit opened', () => {
		const { refused } = planEdit({
			posts: [post({ status: 'publishing' })],
			baseline: { tiktok: state() },
			opened,
			rows: [row({ description: 'new' })],
			now: NOW
		});
		expect(refused).toEqual(['TikTok: The worker has it ready for its minute; TikTok takes it as it is.']);
	});

	describe('a YouTube video YouTube holds', () => {
		const yt = post({
			id: 'y1',
			platform: 'youtube',
			status: 'scheduled',
			title: 'Owls',
			description: 'At dusk',
			options: { visibility: 'Public', tags: ['owls'], tagsOther: ['owls'], playlists: ['Birds'] },
			remote_url: 'https://youtu.be/abc'
		});
		const base = state({ title: 'Owls', description: 'At dusk', options: yt.options });
		const ytRow = (extra: Partial<EditRow>) => row({ platform: 'youtube', ...base, ...extra });

		it('asks the worker for new text, tags and playlists, with what it was', () => {
			const options = { visibility: 'Public', tags: ['owls', 'dusk'], tagsOther: ['owls', 'dusk'], playlists: ['Birds', 'Night'] };
			const { steps, refused } = planEdit({
				posts: [yt],
				baseline: { youtube: base },
				opened: ['youtube'],
				rows: [ytRow({ title: 'Owls at dusk', options })],
				now: NOW
			});
			expect(refused).toEqual([]);
			expect(steps).toEqual([
				{
					kind: 'ask',
					id: 'y1',
					platform: 'youtube',
					request: {
						kind: 'edit',
						title: 'Owls at dusk',
						description: 'At dusk',
						options,
						before: { title: 'Owls', description: 'At dusk', options: yt.options }
					},
					at: null,
					changes: { text: true, options: ['playlists', 'tags', 'tagsOther'], time: false }
				}
			]);
		});

		it('moves it without asking for text when only the time changed', () => {
			const { steps } = planEdit({ posts: [yt], baseline: { youtube: base }, opened: ['youtube'], rows: [ytRow({ at: at(8) })], now: NOW });
			expect(steps).toMatchObject([{ kind: 'ask', request: null, at: at(8) }]);
		});

		it('refuses what its API cannot change, by name, and going out now', () => {
			const visibility = planEdit({
				posts: [yt],
				baseline: { youtube: base },
				opened: ['youtube'],
				rows: [ytRow({ options: { ...yt.options, visibility: 'Unlisted' } })],
				now: NOW
			});
			expect(visibility.refused).toEqual([
				'YouTube: YouTube has the video already, so only its title, description, tags and playlists can change — not Visibility.'
			]);
			const now = planEdit({ posts: [yt], baseline: { youtube: base }, opened: ['youtube'], rows: [ytRow({ immediate: true })], now: NOW });
			expect(now.refused).toEqual(["YouTube: YouTube holds it for its time — release it from the Calendar's menu instead."]);
		});
	});

	it('adds a post for a platform ticked on the edit, and takes off one unticked', () => {
		const { steps } = planEdit({
			posts: [post(), post({ id: 'i1', platform: 'instagram' })],
			baseline: { tiktok: state(), instagram: state() },
			opened: ['tiktok', 'instagram'],
			rows: [row(), row({ platform: 'youtube', title: 'Owls' })],
			now: NOW
		});
		expect(steps).toEqual([
			{ kind: 'add', platform: 'youtube' },
			{ kind: 'remove', id: 'i1', platform: 'instagram', by: 'page' }
		]);
	});

	it('leaves alone a post that opened locked', () => {
		const { steps, refused } = planEdit({
			posts: [post(), post({ id: 'y1', platform: 'youtube', status: 'published' })],
			baseline: { tiktok: state() },
			opened: ['tiktok'],
			rows: [row()],
			now: NOW
		});
		expect(steps).toEqual([]);
		expect(refused).toEqual([]);
	});

	it('hands a post given another video to the new upload, flock-held only', () => {
		const swap = planEdit({ posts: [post()], baseline: { tiktok: state() }, opened, rows: [row({ kept: false })], now: NOW });
		expect(swap.steps).toEqual([{ kind: 'replace', id: 'p1', platform: 'tiktok', by: 'page' }]);
		const held = planEdit({
			posts: [post({ platform: 'youtube', status: 'scheduled' })],
			baseline: { youtube: state() },
			opened: ['youtube'],
			rows: [row({ platform: 'youtube', kept: false })],
			now: NOW
		});
		expect(held.refused).toEqual(['YouTube: YouTube has the video already; flock cannot swap it there yet.']);
	});
});

describe('editing', () => {
	it('is a post with an edit waiting for the worker', () => {
		expect(editing({ request: { kind: 'edit' } })).toBe(true);
		expect(editing({ request: { kind: 'delete' } })).toBe(false);
		expect(editing({})).toBe(false);
	});
});
