import type { Component } from 'svelte';

/**
 * local-devtest: test extensions that live only on the machine that builds
 * flock. Every `.ts` file in `src/local-devtest/` (gitignored, so none ship
 * with the repository) whose default export is a `DevTestModule` is built in:
 * started with the app, given a section under Settings → DevTest, and named
 * in the sidebar while it is changing anything. With the folder empty or
 * absent there is no DevTest tab, no sidebar line and nothing else — this
 * file then does nothing at all.
 */
export interface DevTestModule {
	/** Its heading under Settings → DevTest. */
	title: string;
	/** Run once when the app starts; may hand back a stop function. */
	start?: () => void | (() => void);
	/** Its settings, rendered under its heading. */
	Settings?: Component;
	/** What it is changing right now, a short line each; read reactively. */
	active?: () => string[];
}

// Whole modules rather than `import: 'default'`, so a helper file with no
// default export is skipped instead of failing the build.
const found = import.meta.glob<{ default?: unknown }>(
	['/src/local-devtest/*.ts', '!/src/local-devtest/*.test.ts'],
	{ eager: true }
);

function isModule(value: unknown): value is DevTestModule {
	return Boolean(value && typeof value === 'object' && typeof (value as DevTestModule).title === 'string');
}

/** The modules found, in file-name order. */
export const devtestModules: DevTestModule[] = Object.keys(found)
	.sort()
	.map((path) => found[path].default)
	.filter(isModule);

/** Starts every module; the returned function stops them again. */
export function startDevtest(): () => void {
	const stops = devtestModules.map((mod) => mod.start?.());
	return () => {
		for (const stop of stops) if (typeof stop === 'function') stop();
	};
}

/** Every module's lines of what it is changing right now. */
export function devtestActive(): string[] {
	return devtestModules.flatMap((mod) => mod.active?.() ?? []);
}
