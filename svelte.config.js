import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Each build is named after flock's version and when it was built; SvelteKit
// serves the name in `_app/version.json`, where an open page finds out that a
// newer flock is deployed (src/lib/appupdate.ts).
const VERSION = /VERSION = '([^']+)'/.exec(readFileSync(new URL('./src/lib/version.ts', import.meta.url), 'utf8'))?.[1] ?? '0.0.0';
// One time for the whole build: this file is loaded more than once (and the
// prerender runs in a child process), and SvelteKit names the page's global
// after the build's name, so two names would leave the page unable to start.
process.env.FLOCK_BUILT_AT ||= String(Date.now());

const config = {
	preprocess: vitePreprocess(),
	kit: {
		version: { name: `${VERSION}+${process.env.FLOCK_BUILT_AT}` },
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false
		})
	}
};

export default config;
