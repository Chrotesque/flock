import { describe, expect, it } from 'vitest';
import {
	copyRefusal,
	deleteRefusal,
	devicesWithoutUser,
	personalPart,
	sharedPart,
	userKey,
	userLines,
	userNameProblem,
	userOfDevice,
	userSettingKey,
	withPersonal,
	type DeviceRow,
	type User
} from './users';

const sam: User = { id: 'u1', name: 'Sam', key: 'sam' };
const kim: User = { id: 'u2', name: 'Kim', key: 'kim' };

const devices: DeviceRow[] = [
	{ id: 'd1', name: 'Studio PC', key: 'studio pc', user: 'u1', created: '2026-09-01 10:00:00.000Z' },
	{ id: 'd2', name: 'Laptop', key: 'laptop', user: 'u2', created: '2026-09-02 10:00:00.000Z' },
	{ id: 'd3', name: 'Old PC', key: 'old pc', user: '', created: '2026-08-01 10:00:00.000Z' },
	{ id: 'd4', name: 'Gone', key: 'gone', user: 'u9', created: '2026-08-02 10:00:00.000Z' },
	{ id: 'd5', name: 'Nexus', key: 'nexus', user: 'u1', created: '2026-08-15 10:00:00.000Z' }
];

describe('userNameProblem', () => {
	it('wants a name that is no user yet, case aside', () => {
		expect(userNameProblem('  ', [sam])).toMatch(/Enter/);
		expect(userNameProblem('sAM ', [sam])).toMatch(/is a user already/);
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

describe('userOfDevice', () => {
	it('is the device row’s user while that user exists', () => {
		expect(userOfDevice('Studio PC', devices, [sam, kim])).toBe('u1');
		expect(userOfDevice(' studio pc ', devices, [sam, kim])).toBe('u1');
	});

	it('is nobody for a browser with no user, a deleted one, or no row', () => {
		expect(userOfDevice('Old PC', devices, [sam, kim])).toBe('');
		expect(userOfDevice('Gone', devices, [sam, kim])).toBe('');
		expect(userOfDevice('Elsewhere', devices, [sam, kim])).toBe('');
	});
});

describe('userLines', () => {
	it('lists you first, then by name, each with their browsers oldest first', () => {
		expect(userLines([sam, kim], devices, 'u2')).toEqual([
			{ user: kim, devices: ['Laptop'], you: true },
			{ user: sam, devices: ['Nexus', 'Studio PC'], you: false }
		]);
	});

	it('lists a user with no browser too', () => {
		const alex: User = { id: 'u3', name: 'Alex', key: 'alex' };
		expect(userLines([sam, alex], devices, 'u1').map((l) => [l.user.name, l.devices])).toEqual([
			['Sam', ['Nexus', 'Studio PC']],
			['Alex', []]
		]);
	});

	it('names the browsers that belong to nobody', () => {
		expect(devicesWithoutUser(devices, [sam, kim])).toEqual(['Old PC', 'Gone']);
	});
});

describe('refusals', () => {
	it('never deletes the user this browser is', () => {
		expect(deleteRefusal('u1', 'u1')).toMatch(/This is you/);
		expect(deleteRefusal('u2', 'u1')).toBe('');
	});

	it('copies only another user’s settings, to a browser that has a user', () => {
		expect(copyRefusal('u1', 'u1')).toMatch(/your own/);
		expect(copyRefusal('u2', '')).toMatch(/no user/);
		expect(copyRefusal('u2', 'u1')).toBe('');
	});
});
