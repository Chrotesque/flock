/**
 * Whether the flock an open page runs is the one deployed. Every build is
 * named `<version>+<build time>` (svelte.config.js), and SvelteKit serves
 * that name in `_app/version.json` beside the page; an open page reads it now
 * and then (stores/appupdate.svelte.ts) and compares it with its own
 * (`$app/environment`'s `version`). A tab left open across a deploy runs the
 * old code until it is reloaded — no worker is needed to tell, since the page
 * asks the server it was loaded from.
 */

import type { Change } from './changelog';

export interface Build {
	version: string;
	/** When it was built (ms); null for a name without one. */
	builtAt: number | null;
}

/** A build's name read back; null for anything else, like the dev server's bare timestamp. */
export function readBuild(name: unknown): Build | null {
	if (typeof name !== 'string') return null;
	const m = /^(\d+)\.(\d+)\.(\d+)(?:\+(\d+))?$/.exec(name.trim());
	return m ? { version: `${m[1]}.${m[2]}.${m[3]}`, builtAt: m[4] ? Number(m[4]) : null } : null;
}

/** MAJOR.FEATURE.ITERATION compared part by part: below 0 when `a` is older. */
export function compareVersions(a: string, b: string): number {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
	return 0;
}

export interface Update {
	/** The deployed version. */
	version: string;
	/** The same version built again (a redeploy): the code still differs. */
	sameVersion: boolean;
}

/**
 * What the deployed build is to the running one: an update when it is a
 * newer version, or the same version built later; null when it is the same
 * build, an older one (a rollback is no update), or either cannot be read.
 * `deployed` is `version.json` as SvelteKit writes it, `{ version }`.
 */
export function updateFrom(running: string, deployed: unknown): Update | null {
	const here = readBuild(running);
	const there = readBuild(deployed && typeof deployed === 'object' ? (deployed as { version?: unknown }).version : deployed);
	if (!here || !there) return null;
	const order = compareVersions(there.version, here.version);
	if (order < 0) return null;
	if (order === 0 && (there.builtAt === null || here.builtAt === null || there.builtAt <= here.builtAt)) return null;
	return { version: there.version, sameVersion: order === 0 };
}

/**
 * The change lines a page lacks: those in the deployed build's
 * `whatsnew.json` (`{ changes }`, newest first) that it does not carry
 * itself, from its own version on — so a line added on a redeploy of the same
 * version shows too, and an older line reworded since does not.
 */
export function newChanges(running: string, mine: readonly Change[], deployed: unknown): Change[] {
	const list = deployed && typeof deployed === 'object' ? (deployed as { changes?: unknown }).changes : null;
	if (!Array.isArray(list)) return [];
	const known = new Set(mine.map((c) => `${c.version}\n${c.line}`));
	return list.filter(
		(c): c is Change =>
			!!c &&
			typeof c.version === 'string' &&
			typeof c.line === 'string' &&
			c.line.trim() !== '' &&
			readBuild(c.version) !== null &&
			compareVersions(c.version, running) >= 0 &&
			!known.has(`${c.version}\n${c.line}`)
	);
}

/** The box's two lines: the changes, or the newest one and how many more when they do not fit. */
export function changeLines(changes: readonly Change[], max = 2): string[] {
	if (changes.length <= max) return changes.map((c) => c.line);
	return [...changes.slice(0, max - 1).map((c) => c.line), `+${changes.length - max + 1} more`];
}
