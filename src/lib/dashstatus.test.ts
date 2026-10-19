import { describe, expect, it } from 'vitest';
import { limitLevel, lineLevel, shortError, worstLevel } from './dashstatus';

describe('shortError', () => {
	const body = JSON.stringify(
		{
			error: {
				code: 500,
				message: 'Internal error encountered.',
				errors: [{ message: 'Internal error encountered.', domain: 'global', reason: 'backendError' }],
				status: 'INTERNAL'
			}
		},
		null,
		2
	);

	it("names a refused YouTube call by its status and message, not its JSON", () => {
		expect(shortError(`YouTube GET /playlistItems -> 500: ${body}`)).toBe(
			'Error 500 on /playlistItems: Internal error encountered.'
		);
	});

	it('reads the message from a body cut short', () => {
		const cut = `YouTube GET /videos -> 403: ${body.replace('Internal error encountered.', 'Access denied.').slice(0, 80)}`;
		expect(shortError(cut)).toBe('Error 403 on /videos: Access denied.');
	});

	it('takes the body after a newline too, and leaves out the query', () => {
		expect(shortError(`YouTube GET /videos?part=status&id=x -> 404\n${body}`)).toBe(
			'Error 404 on /videos: Internal error encountered.'
		);
	});

	it('gives the status alone when the body says nothing readable', () => {
		expect(shortError('YouTube GET /channels -> 502: <html>Bad Gateway</html>')).toBe('Error 502 on /channels');
	});

	it('keeps only the first line of a long explanation', () => {
		expect(
			shortError(
				'Google rejected the refresh token (invalid_grant).\nIt has expired or been revoked. Re-authorise with:  pnpm worker:auth'
			)
		).toBe('Google rejected the refresh token (invalid_grant).');
	});

	it("drops Meta's trace id", () => {
		expect(shortError('Instagram 190: Error validating access token (trace AbC_12-x)')).toBe(
			'Instagram 190: Error validating access token'
		);
	});

	it('leaves a short line alone and says nothing for no error', () => {
		expect(shortError('Cannot reach https://graph.facebook.com (ETIMEDOUT)')).toBe(
			'Cannot reach https://graph.facebook.com (ETIMEDOUT)'
		);
		expect(shortError('')).toBe('');
		expect(shortError(undefined)).toBe('');
	});
});

describe('limitLevel', () => {
	it('is ok under half', () => {
		expect(limitLevel(30, 6000)).toBe('ok');
		expect(limitLevel(49, 100)).toBe('ok');
	});

	it('is half from 50 % and close from 80 %', () => {
		expect(limitLevel(50, 100)).toBe('half');
		expect(limitLevel(79, 100)).toBe('half');
		expect(limitLevel(80, 100)).toBe('close');
		expect(limitLevel(5999, 6000)).toBe('close');
	});

	it('is bad once used up, or past it', () => {
		expect(limitLevel(100, 100)).toBe('bad');
		expect(limitLevel(6400, 6000)).toBe('bad');
	});

	it('says nothing about a limit it cannot read', () => {
		expect(limitLevel(5, 0)).toBe('ok');
		expect(limitLevel(Number.NaN, 100)).toBe('ok');
	});
});

describe('worstLevel', () => {
	it('takes the worst, ok for none', () => {
		expect(worstLevel([])).toBe('ok');
		expect(worstLevel(['ok', 'half'])).toBe('half');
		expect(worstLevel(['close', 'half', 'ok'])).toBe('close');
		expect(worstLevel(['half', 'bad', 'close'])).toBe('bad');
	});
});

describe('lineLevel', () => {
	it('is bad on an error whatever the limit says', () => {
		expect(lineLevel({ error: 'invalid_grant', used: 1, total: 100 })).toBe('bad');
	});

	it('follows its limit', () => {
		expect(lineLevel({ used: 2, total: 100 })).toBe('ok');
		expect(lineLevel({ used: 3100, total: 6000 })).toBe('half');
		expect(lineLevel({ used: 100, total: 100 })).toBe('bad');
	});

	it('is ok with no limit and no error', () => {
		expect(lineLevel({})).toBe('ok');
		expect(lineLevel({ error: '' })).toBe('ok');
	});

	it('makes a partial read at least close, never less than its limit', () => {
		expect(lineLevel({ partial: true })).toBe('close');
		expect(lineLevel({ partial: true, used: 100, total: 100 })).toBe('bad');
	});
});
