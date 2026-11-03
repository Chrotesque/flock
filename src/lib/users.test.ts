import { describe, expect, it } from 'vitest';
import {
	copyRefusal,
	personalPart,
	sharedPart,
	userKey,
	userLines,
	userNameProblem,
	userSettingKey,
	withPersonal,
	type User
} from './users';

const sam: User = { id: 'u1', name: 'Sam', key: 'sam' };
const kim: User = { id: 'u2', name: 'Kim', key: 'kim' };


describe('userNameProblem', () => {
	it('wants a name that is no profile yet, case aside', () => {
		expect(userNameProblem('  ', [sam])).toMatch(/Enter/);
		expect(userNameProblem('sAM ', [sam])).toMatch(/is a profile already/);
		expect(userNameProblem('x'.repeat(61), [])).toMatch(/at most 60/);
		expect(userNameProblem('Alex', [sam, kim])).toBe('');
		expect(userKey('  Alex ')).toBe('alex');
	});
});

describe('withPersonal / sharedPart', () => {
	const shared = { watchFolders: ['w'], showTodo: true, todoBrands: null, timeZones: [], complianceBranding: true };

	it('reads the shared row with the user’s own keys over it, and only those', () => {
		const own = { showTodo: false, todoBrands: ['b1'], watchFolders: ['nope'], stray: 1 };
		expect(withPersonal(shared, own)).toEqual({ ...shared, showTodo: false, todoBrands: ['b1'] });
	});

	it('gives a user with no row of their own the shared values', () => {
		expect(withPersonal(shared, null)).toEqual(shared);
		expect(withPersonal(shared, ['not', 'an', 'object'])).toEqual(shared);
		expect(withPersonal(null, null)).toEqual({});
	});

	it('writes the shared row with its personal keys as stored, never as this user has them', () => {
		const value = { ...shared, watchFolders: ['w', 'x'], showTodo: false, dashboardColumns: ['views'] };
		expect(sharedPart(value, shared)).toEqual({ ...shared, watchFolders: ['w', 'x'] });
	});

	it('leaves a personal key out of the shared row when it never held one', () => {
		expect(sharedPart({ watchFolders: [], showTodo: false }, {})).toEqual({ watchFolders: [] });
	});

	it('takes only the personal keys', () => {
		expect(personalPart({ showTodo: false, watchFolders: [], jestrIntegration: true })).toEqual({
			showTodo: false,
			jestrIntegration: true
		});
		expect(personalPart(null)).toEqual({});
	});

	it('names each user’s rows by area and id', () => {
		expect(userSettingKey('user_prefs', 'u1')).toBe('user_prefs:u1');
		expect(userSettingKey('dashboard_hidden', 'u1')).toBe('dashboard_hidden:u1');
	});
});

describe('userLines', () => {
	it('lists yours first, then by name', () => {
		const alex: User = { id: 'u3', name: 'Alex', key: 'alex' };
		expect(userLines([sam, kim, alex], 'u2')).toEqual([
			{ user: kim, you: true },
			{ user: alex, you: false },
			{ user: sam, you: false }
		]);
	});
});

describe('copyRefusal', () => {
	it('copies only another profile’s settings, to a browser that has a profile', () => {
		expect(copyRefusal('u1', 'u1')).toMatch(/your own/);
		expect(copyRefusal('u2', '')).toMatch(/no profile/);
		expect(copyRefusal('u2', 'u1')).toBe('');
	});
});
