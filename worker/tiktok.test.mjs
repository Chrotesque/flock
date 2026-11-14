import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { TIKTOK_SCOPES, accessToken, forgetToken, isDraft, probeTikTok, publishToTikTok, resolvePrivacy } from './tiktok.mjs';

const creator = (levels) => ({ username: 'someone', privacyOptions: levels });

describe('resolvePrivacy', () => {
	it('takes an audience the account offers', () => {
		assert.equal(resolvePrivacy('Public', creator(['PUBLIC_TO_EVERYONE', 'SELF_ONLY'])), 'PUBLIC_TO_EVERYONE');
		assert.equal(resolvePrivacy('Private', creator(['PUBLIC_TO_EVERYONE', 'SELF_ONLY'])), 'SELF_ONLY');
	});

	it('never falls back to Public when no audience was chosen', () => {
		for (const missing of [undefined, null, '', '  ']) {
			assert.throws(() => resolvePrivacy(missing, creator(['PUBLIC_TO_EVERYONE'])), /No audience was chosen/);
		}
	});

	it('refuses a word that is no audience', () => {
		assert.throws(() => resolvePrivacy('Everybody', creator(['PUBLIC_TO_EVERYONE'])), /not a TikTok audience/);
	});

	it('refuses an audience the account does not offer, rather than downgrading', () => {
		assert.throws(() => resolvePrivacy('Public', creator(['SELF_ONLY'])), /does not offer "Public"/);
	});
});

describe('accessToken', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('shares one refresh between callers, so a rotating token is spent once', async () => {
		let calls = 0;
		globalThis.fetch = async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return new Response(JSON.stringify({ access_token: `access-${calls}`, expires_in: 86400, refresh_token: 'same' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		};
		const config = { tiktok: { clientKey: 'k', clientSecret: 's' } };
		const account = { openId: 'test-open-id', refreshToken: 'same' };
		forgetToken(account);
		const [a, b, c] = await Promise.all([
			accessToken(config, account),
			accessToken(config, account),
			accessToken(config, account)
		]);
		assert.equal(calls, 1);
		assert.deepEqual([a, b, c], ['access-1', 'access-1', 'access-1']);
		// Cached afterwards, and a later refresh is a fresh one.
		assert.equal(await accessToken(config, account), 'access-1');
		forgetToken(account);
		assert.equal(await accessToken(config, account), 'access-2');
		assert.equal(calls, 2);
		forgetToken(account);
	});
});

describe('drafts', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('asks for video.upload beside video.publish, and reads the choice', () => {
		assert.ok(TIKTOK_SCOPES.includes('video.upload'));
		assert.ok(TIKTOK_SCOPES.includes('video.publish'));
		assert.equal(isDraft({ postMode: 'draft' }), true);
		assert.equal(isDraft({ postMode: 'direct' }), false);
		assert.equal(isDraft({}), false);
		assert.equal(isDraft(undefined), false);
	});

	/** A stand-in TikTok that answers each call and keeps what was asked. */
	function stubTikTok(statuses) {
		const calls = [];
		globalThis.fetch = async (url, init = {}) => {
			const path = String(url).replace('https://open.tiktokapis.com/v2', '');
			const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
			calls.push({ path, method: init.method, body, headers: init.headers });
			const json = (data) =>
				new Response(JSON.stringify({ data, error: { code: 'ok' } }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			if (path.startsWith('/oauth/token/')) {
				return new Response(JSON.stringify({ access_token: 'a', expires_in: 86400, refresh_token: 'r', scope: TIKTOK_SCOPES.join(',') }), {
					status: 200
				});
			}
			if (path === '/post/publish/creator_info/query/') {
				return json({ creator_username: 'someone', creator_nickname: 'Some One', privacy_level_options: ['PUBLIC_TO_EVERYONE'] });
			}
			if (path === '/post/publish/inbox/video/init/') return json({ publish_id: 'v_inbox_file~1', upload_url: 'https://upload.example/x' });
			if (String(url).startsWith('https://upload.example/')) return new Response('', { status: 201 });
			if (path === '/post/publish/status/fetch/') return json({ status: statuses.shift() ?? 'SEND_TO_USER_INBOX' });
			throw new Error(`unexpected ${url}`);
		};
		return calls;
	}

	it('sends only the bytes to the inbox and is done once TikTok put it there', async () => {
		const calls = stubTikTok(['SEND_TO_USER_INBOX']);
		const account = { openId: 'draft-open-id', refreshToken: 'r' };
		forgetToken(account);
		const config = { tiktok: { clientKey: 'k', clientSecret: 's', accounts: [account] } };
		const bytes = Buffer.alloc(1000, 1);
		const handles = [];
		const result = await publishToTikTok({
			target: { account: 'draft-open-id', description: 'a caption', options: { postMode: 'draft' } },
			job: { video_name: 'clip.mp4', video_duration: 30 },
			pb: { openVideo: async () => ({ stream: Readable.from([bytes]), size: bytes.length, mimeType: 'video/mp4' }) },
			config,
			log: () => {},
			saveHandle: async (handle) => handles.push(handle)
		});
		const init = calls.find((c) => c.path === '/post/publish/inbox/video/init/');
		assert.ok(init, 'the inbox endpoint was called');
		assert.deepEqual(Object.keys(init.body), ['source_info']);
		assert.equal(init.body.source_info.source, 'FILE_UPLOAD');
		assert.equal(init.body.source_info.video_size, 1000);
		assert.ok(!calls.some((c) => c.path === '/post/publish/video/init/'), 'never posted directly');
		assert.deepEqual(handles, [{ kind: 'tiktok-publish', publishId: 'v_inbox_file~1', username: 'someone', account: 'draft-open-id', draft: true }]);
		assert.equal(result.draft, true);
		assert.equal(result.url, 'https://www.tiktok.com/@someone');
		assert.match(result.notes[0], /inbox as a draft: open the notification in the TikTok app/);
		forgetToken(account);
	});

	it("refuses a draft over TikTok's ten minutes before sending anything", async () => {
		const calls = stubTikTok([]);
		const account = { openId: 'draft-open-id-2', refreshToken: 'r' };
		forgetToken(account);
		await assert.rejects(
			publishToTikTok({
				target: { account: 'draft-open-id-2', options: { postMode: 'draft' } },
				job: { video_name: 'long.mp4', video_duration: 700 },
				pb: { openVideo: async () => assert.fail('no bytes for a refused draft') },
				config: { tiktok: { clientKey: 'k', clientSecret: 's', accounts: [account] } },
				log: () => {},
				saveHandle: async () => {}
			}),
			/at most 10 minutes/
		);
		assert.ok(!calls.some((c) => c.path.includes('/init/')));
		forgetToken(account);
	});

	it('reads a draft in the inbox as done when a worker takes it over', async () => {
		stubTikTok(['SEND_TO_USER_INBOX']);
		const account = { openId: 'draft-open-id-3', refreshToken: 'r' };
		forgetToken(account);
		const probe = await probeTikTok(
			{ tiktok: { clientKey: 'k', clientSecret: 's', accounts: [account] } },
			{ publishId: 'v_inbox_file~1', username: 'someone', account: 'draft-open-id-3', draft: true }
		);
		assert.equal(probe.state, 'done');
		assert.equal(probe.result.draft, true);
		forgetToken(account);
	});
});
