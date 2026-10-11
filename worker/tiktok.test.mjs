import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, forgetToken, resolvePrivacy } from './tiktok.mjs';

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
