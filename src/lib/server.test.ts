import { describe, expect, it } from 'vitest';
import { blockedReason, checkServer, serverAddress } from './server';

describe('serverAddress', () => {
	it('adds https when no scheme was typed', () => {
		expect(serverAddress('flock.example.com')).toBe('https://flock.example.com');
		expect(serverAddress('  flock.example.com:8091 ')).toBe('https://flock.example.com:8091');
	});

	it('keeps an http address and a port', () => {
		expect(serverAddress('http://192.0.2.10:8091')).toBe('http://192.0.2.10:8091');
	});

	it('drops the trailing slash, a page of flock, the admin and API paths and the query', () => {
		expect(serverAddress('https://flock.example.com/')).toBe('https://flock.example.com');
		expect(serverAddress('https://flock.example.com/upload?dashboard')).toBe('https://flock.example.com');
		expect(serverAddress('https://flock.example.com/log/upload?job=abc')).toBe('https://flock.example.com');
		expect(serverAddress('https://flock.example.com/_/#/collections')).toBe('https://flock.example.com');
		expect(serverAddress('https://flock.example.com/api/health?x=1')).toBe('https://flock.example.com');
	});

	it('keeps a path a proxy serves it under', () => {
		expect(serverAddress('https://example.com/flock/')).toBe('https://example.com/flock');
		expect(serverAddress('https://example.com/flock/_/')).toBe('https://example.com/flock');
	});

	it('refuses what is no web address', () => {
		expect(serverAddress('')).toBeNull();
		expect(serverAddress('   ')).toBeNull();
		expect(serverAddress('ftp://example.com')).toBeNull();
		expect(serverAddress('https://')).toBeNull();
		expect(serverAddress('not an address')).toBeNull();
	});
});

describe('blockedReason', () => {
	it('blocks http from an https page', () => {
		expect(blockedReason('http://192.0.2.10:8091', 'https:')).toMatch(/https address/);
	});

	it('lets this machine through over http', () => {
		expect(blockedReason('http://localhost:8091', 'https:')).toBe('');
		expect(blockedReason('http://127.0.0.1:8091', 'https:')).toBe('');
		expect(blockedReason('http://[::1]:8091', 'https:')).toBe('');
	});

	it('has nothing against https, or http from an http page', () => {
		expect(blockedReason('https://flock.example.com', 'https:')).toBe('');
		expect(blockedReason('http://192.0.2.10:8091', 'http:')).toBe('');
	});
});

describe('checkServer', () => {
	const answers =
		(byPath: Record<string, number | 'down'>) =>
		async (input: string): Promise<Response> => {
			const path = new URL(input).pathname;
			const status = byPath[path];
			if (status === undefined || status === 'down') throw new TypeError('Failed to fetch');
			return new Response('{}', { status });
		};

	it('passes a flock server', async () => {
		const fetcher = answers({ '/api/health': 200, '/api/collections/brands/records': 200 });
		expect(await checkServer('https://flock.example.com', fetcher)).toBe('');
	});

	it('says when nothing answers', async () => {
		expect(await checkServer('https://flock.example.com', answers({}))).toMatch(/^Nothing answered at/);
	});

	it('says when the answer is not PocketBase', async () => {
		const fetcher = answers({ '/api/health': 404 });
		expect(await checkServer('https://example.com', fetcher)).toMatch(/not as PocketBase does \(404\)/);
	});

	it('says when PocketBase has no flock in it', async () => {
		const fetcher = answers({ '/api/health': 200, '/api/collections/brands/records': 404 });
		expect(await checkServer('https://example.com', fetcher)).toMatch(/flock is not set up/);
	});

	it('says when flock would not show its data', async () => {
		const fetcher = answers({ '/api/health': 200, '/api/collections/brands/records': 403 });
		expect(await checkServer('https://example.com', fetcher)).toMatch(/would not show flock's data \(403\)/);
	});
});
