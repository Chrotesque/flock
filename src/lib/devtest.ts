import type { Component } from 'svelte';

/**
 * local-devtest: test extensions that live only on the machine that builds
 * flock. Every `.ts` file in `src/local-devtest/` (gitignored, so none ship
 * with the repository) whose default export is a `DevTestModule` is built in:
 * started with the app, given a section under Settings → DevTest, named in
 * the sidebar while it is changing anything, and given a sidebar link for
 * each page it brings (shown at `/devtest?page=<id>`). With the folder empty
 * or absent there is no DevTest tab, no sidebar line or link and nothing
 * else — this file then does nothing at all.
 */
/** A flask: DevTest's mark in Settings, and a local page's icon by default. */
export const DEVTEST_ICON =
	'M9.5 4h5M10.5 4v5.2L5.6 17.4A1.7 1.7 0 0 0 7.1 20h9.8a1.7 1.7 0 0 0 1.5-2.6L13.5 9.2V4M8 14h8';

export interface DevTestPage {
	/** In the address, `/devtest?page=<id>`; unique across modules. */
	id: string;
	/** The sidebar link's name. */
	label: string;
	/** The line under it; "Local only" when left out. */
	hint?: string;
	/** An SVG path in a 24×24 box, stroked like the other links' icons. */
	icon?: string;
	/** The page itself, rendered in the content area. */
	Page: Component;
}

export interface DevTestModule {
	/** Its heading under Settings → DevTest. */
	title: string;
	/** Run once when the app starts; may hand back a stop function. */
	start?: () => void | (() => void);
	/** Its settings, rendered under its heading. */
	Settings?: Component;
	/** What it is changing right now, a short line each; read reactively. */
	active?: () => string[];
	/** Pages of its own, each a sidebar link under the main ones. */
	pages?: DevTestPage[];
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

/** Every module's pages, in module order; a repeated id keeps the first. */
export const devtestPages: DevTestPage[] = devtestModules
	.flatMap((mod) => mod.pages ?? [])
	.filter((p, i, all) => Boolean(p?.id && p.label && p.Page) && all.findIndex((q) => q.id === p.id) === i);

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
