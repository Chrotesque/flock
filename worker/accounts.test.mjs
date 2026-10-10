import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	googleAccounts,
	instagramAccounts,
	instagramReady,
	mergeAccounts,
	pickAccount,
	parseChoice
} from './accounts.mjs';

const ig = (id, extra = {}) => ({
	igUserId: id,
	username: `user${id}`,
	pageId: `page${id}`,
	pageName: `Page ${id}`,
	pageAccessToken: `tok${id}`,
	...extra
});
const byId = (a) => a.igUserId;

test('a config with a list keeps the list, cleaned', () => {
	const list = instagramAccounts({ accounts: [ig('1', { junk: 1 }), { username: 'no id' }] });
	assert.equal(list.length, 1);
	assert.deepEqual(Object.keys(list[0]).sort(), ['igUserId', 'pageAccessToken', 'pageId', 'pageName', 'username']);
});

test('the old single-account section reads as a list of one', () => {
	const list = instagramAccounts({ appId: 'x', ...ig('9') });
	assert.deepEqual(list.map(byId), ['9']);
	assert.equal(list[0].pageAccessToken, 'tok9');
});

test('an old section without a token is no account at all', () => {
	assert.deepEqual(instagramAccounts({ igUserId: '9' }), []);
});

test('the environment token goes to the named Page, or to the only account', () => {
	const two = instagramAccounts({ accounts: [ig('1'), ig('2')] }, {
		INSTAGRAM_PAGE_TOKEN: 'env',
		INSTAGRAM_PAGE_ID: 'page2'
	});
	assert.deepEqual(two.map((a) => a.pageAccessToken), ['tok1', 'env']);
	const one = instagramAccounts({ accounts: [ig('1')] }, { INSTAGRAM_PAGE_TOKEN: 'env' });
	assert.equal(one[0].pageAccessToken, 'env');
	const ambiguous = instagramAccounts({ accounts: [ig('1'), ig('2')] }, { INSTAGRAM_PAGE_TOKEN: 'env' });
	assert.deepEqual(ambiguous.map((a) => a.pageAccessToken), ['tok1', 'tok2']);
});

test('ready needs the account, its Page and the token', () => {
	assert.equal(instagramReady(ig('1')), true);
	assert.equal(instagramReady(ig('1', { pageAccessToken: '' })), false);
});

test('merging replaces an account by id and keeps the rest', () => {
	const merged = mergeAccounts([ig('1'), ig('2')], [ig('2', { pageAccessToken: 'new' }), ig('3')], byId);
	assert.deepEqual(merged.map(byId), ['1', '2', '3']);
	assert.equal(merged[1].pageAccessToken, 'new');
});

test('a post naming an account gets exactly that one', () => {
	assert.equal(pickAccount([ig('1'), ig('2')], '2', byId, 'Instagram', 'setup').igUserId, '2');
});

test('a post naming an account the worker lacks is refused, never sent elsewhere', () => {
	assert.throws(() => pickAccount([ig('1')], '2', byId, 'Instagram', 'setup'), /no credentials/);
});

test('a post naming none gets the only account, and is refused when there are several', () => {
	assert.equal(pickAccount([ig('1')], '', byId, 'Instagram', 'setup').igUserId, '1');
	assert.throws(() => pickAccount([ig('1'), ig('2')], '', byId, 'Instagram', 'setup'), /names no Instagram account/);
	assert.throws(() => pickAccount([], '', byId, 'Instagram', 'setup'), /not set up/);
});

test('choices parse from numbers, lists and "all"', () => {
	assert.deepEqual(parseChoice('2', 3), [1]);
	assert.deepEqual(parseChoice('1, 3', 3), [0, 2]);
	assert.deepEqual(parseChoice('3 1 3', 3), [0, 2]);
	assert.deepEqual(parseChoice('all', 2), [0, 1]);
	assert.equal(parseChoice('4', 3), null);
	assert.equal(parseChoice('x', 3), null);
	assert.equal(parseChoice('', 3), null);
});

const yt = (id, extra = {}) => ({ channelId: id, title: `Channel ${id}`, handle: `@c${id}`, refreshToken: `rt${id}`, ...extra });

test('YouTube channels are a list, cleaned, and a channel needs a token', () => {
	const list = googleAccounts({ accounts: [yt('A', { junk: 1 }), yt('B', { refreshToken: '' })] });
	assert.deepEqual(list.map((a) => a.channelId), ['A']);
	assert.deepEqual(Object.keys(list[0]).sort(), ['channelId', 'handle', 'refreshToken', 'scope', 'title']);
});

test('the old single refresh token reads as one channel not yet named', () => {
	const list = googleAccounts({ clientId: 'x', refreshToken: 'old' });
	assert.equal(list.length, 1);
	assert.equal(list[0].refreshToken, 'old');
	assert.equal(list[0].channelId, '');
});

test('GOOGLE_REFRESH_TOKEN is the single grant, or the only channel\'s token', () => {
	assert.equal(googleAccounts({}, { GOOGLE_REFRESH_TOKEN: 'env' })[0].refreshToken, 'env');
	assert.equal(googleAccounts({ accounts: [yt('A')] }, { GOOGLE_REFRESH_TOKEN: 'env' })[0].refreshToken, 'env');
	const two = googleAccounts({ accounts: [yt('A'), yt('B')] }, { GOOGLE_REFRESH_TOKEN: 'env' });
	assert.deepEqual(two.map((a) => a.refreshToken), ['rtA', 'rtB']);
});

test('a list wins over a leftover single token', () => {
	const list = googleAccounts({ accounts: [yt('A')], refreshToken: 'old' });
	assert.deepEqual(list.map((a) => a.refreshToken), ['rtA']);
});

test('a channel connected again replaces its old grant; others stay', () => {
	const merged = mergeAccounts([yt('A'), yt('B')], [yt('B', { refreshToken: 'new' })], (a) => a.channelId);
	assert.deepEqual(merged.map((a) => `${a.channelId}:${a.refreshToken}`), ['A:rtA', 'B:new']);
});
