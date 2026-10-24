import { describe, expect, it } from 'vitest';
import { changeLines, compareVersions, newChanges, readBuild, updateFrom } from './appupdate';
import { CHANGES } from './changelog';
import { firstWord } from './logwords';
import { VERSION } from './version';

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

describe('newChanges', () => {
	const mine = [
		{ at: '2026-10-25T00:15:00+02:00', version: '0.18.10', line: 'Added: Update > What Changed' },
		{ at: '2026-10-24T23:51:00+02:00', version: '0.18.9', line: 'Changed: Ratio View > Heatmap' }
	];
	const at = '2026-10-26T12:00:00+01:00';

	it('gives the deployed lines this page does not carry, newest first', () => {
		const deployed = {
			version: '0.18.12',
			changes: [
				{ at, version: '0.18.12', line: 'Fixed: Calendar > Drag' },
				{ at, version: '0.18.11', line: 'Added: Log > Sub Filtering' },
				...mine
			]
		};
		expect(newChanges('0.18.10', mine, deployed)).toEqual(deployed.changes.slice(0, 2));
	});

	it('gives a line added on a redeploy of the same version', () => {
		const deployed = { changes: [{ at, version: '0.18.10', line: 'Fixed: Update > Width' }, ...mine] };
		expect(newChanges('0.18.10', mine, deployed)).toEqual([{ at, version: '0.18.10', line: 'Fixed: Update > Width' }]);
	});

	it('leaves out lines older than this page, reworded ones too', () => {
		const deployed = { changes: [{ at, version: '0.18.9', line: 'Changed: Ratio View > Heat Map' }, mine[0]] };
		expect(newChanges('0.18.10', mine, deployed)).toEqual([]);
	});

	it('reads nothing from an old build or a broken file', () => {
		expect(newChanges('0.18.10', mine, null)).toEqual([]);
		expect(newChanges('0.18.10', mine, '<!doctype html>')).toEqual([]);
		expect(newChanges('0.18.10', mine, { version: '0.18.11' })).toEqual([]);
		expect(newChanges('0.18.10', mine, { changes: [null, { version: 'x', line: 'y' }, { version: '0.18.11', line: ' ' }, { version: '0.18.11' }] })).toEqual([]);
	});
});

describe('changeLines', () => {
	const at = (n: number) =>
		Array.from({ length: n }, (_, i) => ({ at: '2026-10-26T12:00:00+01:00', version: `0.18.${20 - i}`, line: `Line ${i + 1}` }));

	it('shows up to two lines as they are', () => {
		expect(changeLines([])).toEqual([]);
		expect(changeLines(at(1))).toEqual(['Line 1']);
		expect(changeLines(at(2))).toEqual(['Line 1', 'Line 2']);
	});

	it('shows the newest and how many more past two', () => {
		expect(changeLines(at(3))).toEqual(['Line 1', '+2 more']);
		expect(changeLines(at(7))).toEqual(['Line 1', '+6 more']);
	});
});

describe('CHANGES', () => {
	it('says what this version changed, in short dated lines, newest first', () => {
		expect(CHANGES[0]?.version).toBe(VERSION);
		for (const c of CHANGES) {
			expect(readBuild(c.version)).not.toBeNull();
			expect(c.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
			expect(c.line).toMatch(/^(Added|Changed|Fixed|Removed): \S/);
			// The Log's word bar reads the kind; a lower-case word after the colon would pass for a brand.
			expect(['Added', 'Changed', 'Fixed', 'Removed']).toContain(firstWord(c.line));
			// About what fits the rail at 11px; a longer one is cut there (the tooltip has it whole).
			expect(c.line.length).toBeLessThanOrEqual(28);
		}
		for (let i = 1; i < CHANGES.length; i++) {
			expect(compareVersions(CHANGES[i - 1].version, CHANGES[i].version)).toBeGreaterThanOrEqual(0);
			expect(Date.parse(CHANGES[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(CHANGES[i].at));
		}
	});
});
