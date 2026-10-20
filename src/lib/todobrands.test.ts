import { describe, expect, it } from 'vitest';
import { followedChannels, followedItems, followedLines, follows, readTodoBrands, toggled } from './todobrands';
import type { Attention } from './attention';
import type { Account, Brand } from './types';
import type { TodoLine } from './videotodo';

const brand = (id: string, youtube?: string): Brand => ({
	id,
	name: id,
	sort_order: 0,
	accounts: youtube ? { youtube } : {}
});
const channel = (id: string): Account => ({
	id: `r-${id}`,
	platform: 'youtube',
	account_id: id,
	handle: id,
	name: id,
	details: null,
	error: '',
	fetched_at: ''
});
const all = [brand('owls', 'UC-owls'), brand('moon', 'UC-moon'), brand('fern')];
const rows = [channel('UC-owls'), channel('UC-moon')];

const line = (id: string, channelId: string) => ({ id, channelId }) as TodoLine;
const item = (kind: Attention['kind'], brandId: string): Attention => ({
	level: kind === 'failed' || kind === 'unsent' ? 'error' : 'warn',
	kind,
	key: `${kind}:${brandId}`,
	text: '',
	detail: '',
	job: 'j',
	platform: brandId ? 'instagram' : '',
	brand: brandId
});

describe('readTodoBrands', () => {
	it('reads a list without blanks or repeats, anything else as every brand', () => {
		expect(readTodoBrands(['owls', '', 3, 'owls', 'moon'])).toEqual(['owls', 'moon']);
		expect(readTodoBrands([])).toEqual([]);
		expect(readTodoBrands(undefined)).toBeNull();
		expect(readTodoBrands('owls')).toBeNull();
	});
});

describe('toggled', () => {
	it('starts from every brand, and keeps the app’s order', () => {
		expect(toggled(all, null, 'moon')).toEqual(['owls', 'fern']);
		expect(toggled(all, ['fern'], 'owls')).toEqual(['owls', 'fern']);
		expect(toggled(all, ['owls'], 'owls')).toEqual([]);
	});

	it('follows every brand with nothing chosen', () => {
		expect(follows(null, 'fern')).toBe(true);
		expect(follows(['owls'], 'fern')).toBe(false);
	});
});

describe('followedChannels and followedLines', () => {
	it('leaves every line with every brand followed', () => {
		expect(followedChannels(all, rows, null)).toBeNull();
		const lines = [line('a', 'UC-owls'), line('b', 'UC-moon')];
		expect(followedLines(lines, null)).toBe(lines);
	});

	it('keeps the followed brands’ channels, and a line whose channel is not known yet', () => {
		const channels = followedChannels(all, rows, ['owls', 'fern']);
		expect([...(channels ?? [])]).toEqual(['UC-owls']);
		const lines = [line('a', 'UC-owls'), line('b', 'UC-moon'), line('c', '')];
		expect(followedLines(lines, channels).map((l) => l.id)).toEqual(['a', 'c']);
		expect(followedLines(lines, followedChannels(all, rows, [])).map((l) => l.id)).toEqual(['c']);
	});
});

describe('followedItems', () => {
	it('keeps only the other brands’ posts that did not go out, and every system item', () => {
		const items = [
			item('failed', 'moon'),
			item('unsent', 'moon'),
			item('cover', 'moon'),
			item('private', 'moon'),
			item('stuck', 'moon'),
			item('cover', 'owls'),
			item('system', '')
		];
		expect(followedItems(items, ['owls']).map((i) => i.key)).toEqual([
			'failed:moon',
			'unsent:moon',
			'cover:owls',
			'system:'
		]);
		expect(followedItems(items, null)).toBe(items);
	});
});
