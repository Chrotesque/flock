import { describe, expect, it } from 'vitest';
import { compareVersions, readBuild, updateFrom } from './appupdate';

describe('readBuild', () => {
	it('reads a build’s version and when it was built', () => {
		expect(readBuild('0.18.3+1792870592576')).toEqual({ version: '0.18.3', builtAt: 1792870592576 });
		expect(readBuild('0.18.3')).toEqual({ version: '0.18.3', builtAt: null });
	});

	it('reads nothing else, the dev server’s bare timestamp included', () => {
		expect(readBuild('1792870592576')).toBeNull();
		expect(readBuild(undefined)).toBeNull();
		expect(readBuild('v0.18.3')).toBeNull();
	});
});

describe('compareVersions', () => {
	it('compares part by part, as numbers', () => {
		expect(compareVersions('0.18.10', '0.18.9')).toBeGreaterThan(0);
		expect(compareVersions('0.18.3', '0.19.0')).toBeLessThan(0);
		expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
		expect(compareVersions('0.18.3', '0.18.3')).toBe(0);
	});
});

describe('updateFrom', () => {
	const running = '0.18.3+1000';

	it('is an update when a newer version is deployed', () => {
		expect(updateFrom(running, { version: '0.18.4+2000' })).toEqual({ version: '0.18.4', sameVersion: false });
		expect(updateFrom(running, { version: '0.19.0+900' })).toEqual({ version: '0.19.0', sameVersion: false });
	});

	it('is an update when the same version was built again later', () => {
		expect(updateFrom(running, { version: '0.18.3+2000' })).toEqual({ version: '0.18.3', sameVersion: true });
	});

	it('is none for the same build, an older one, or anything unreadable', () => {
		expect(updateFrom(running, { version: running })).toBeNull();
		expect(updateFrom(running, { version: '0.18.3+500' })).toBeNull();
		expect(updateFrom(running, { version: '0.18.2+9000' })).toBeNull();
		expect(updateFrom(running, { version: '1792870592576' })).toBeNull();
		expect(updateFrom('1792870592576', { version: '0.18.4+2000' })).toBeNull();
		expect(updateFrom(running, null)).toBeNull();
	});
});
