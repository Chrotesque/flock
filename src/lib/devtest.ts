import type { Component } from 'svelte';

/**
 * local-devtest: test extensions that live only on the machine that builds
 * flock. Every `.ts` file in `src/local-devtest/` (gitignored, so none ship
 * with the repository) whose default export is a `DevTestModule` is built in:
 * started with the app, given a section under Settings → DevTest, named in
 * the sidebar while it is changing anything, given a sidebar link for each
 * page it brings (shown at `/devtest?page=<id>`) and a button on the
 * dashboard for each scope it brings. With the folder empty
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

/** One set of accounts the dashboard shows: a brand's, as a local scope names it. */
export interface DashboardGroup {
	/** Shown on each of its videos while several groups are in view. */
	label: string;
	/** The YouTube channel id its videos are on; '' for none. */
	channel: string;
	/** The Instagram account id its reels are on; '' for none. */
	instagram: string;
	/** The brand id its posts belong to. */
	brand: string;
	/** A CSS colour its rows are tinted with, while several groups are in view. */
	colour?: string;
}

/**
 * A button a local module puts beside the dashboard's brand buttons. While
 * chosen, the dashboard shows its groups instead of the brand in view —
 * each group's videos and reels paired only among themselves. The tracked
 * dashboard never shows more than one brand at a time by itself.
 */
export interface DashboardScope {
	label: string;
	/** Its tooltip. */
	title?: string;
	/** Whether it is chosen; read reactively. */
	active: () => boolean;
	select: () => void;
	/** Called when a brand is chosen instead. */
	release: () => void;
	groups: () => DashboardGroup[];
	/** Shown when a brand button is right-clicked while this scope is chosen, at the pointer. */
	BrandMenu?: Component<{ brand: string; x: number; y: number; close: () => void }>;
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
	/** Buttons beside the dashboard's brands (see DashboardScope). */
	dashboardScopes?: DashboardScope[];
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

/** Every module's dashboard scopes, in module order. */
export const devtestDashboardScopes: DashboardScope[] = devtestModules.flatMap((mod) => mod.dashboardScopes ?? []);
