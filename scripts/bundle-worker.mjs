// The worker as one CommonJS file: what the single executable is built from,
// and what a machine with Node runs as it is (`node flock-worker.cjs`) — the
// NAS container does. Shared by build-worker.mjs and deploy-worker.mjs, so
// both ship the same thing.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The single-executable loader takes nothing but CommonJS. The worker's one
 * use of import.meta (config.mjs) has a fallback for the empty import.meta of
 * a CommonJS bundle, so the warning about it is silenced.
 */
export async function bundleWorker(outfile) {
	await build({
		entryPoints: [join(root, 'worker', 'cli.mjs')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node22',
		outfile,
		logLevel: 'warning',
		logOverride: { 'empty-import-meta': 'silent' }
	});
}
