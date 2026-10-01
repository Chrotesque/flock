// Builds the worker into one program that runs without Node installed:
// a copy of this Node with the bundled worker baked in, Node's own
// single-executable feature.
//
//   pnpm build:worker      -> dist/worker/flock-worker.exe (+ example config)
//
// The result is for the platform this runs on, so a Windows exe is built on
// Windows. It is not signed: Windows may show a SmartScreen notice the first
// time it is run, and the copied Node's own signature no longer matches.

import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'worker');
const exe = process.platform === 'win32' ? 'flock-worker.exe' : 'flock-worker';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. One CommonJS file. The single-executable loader takes nothing else. The
//    worker's one use of import.meta sits behind an isSea() check, so the
//    empty import.meta of a CommonJS bundle is never read there.
await build({
	entryPoints: [join(root, 'worker', 'cli.mjs')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	outfile: join(out, 'flock-worker.cjs'),
	logLevel: 'warning',
	logOverride: { 'empty-import-meta': 'silent' }
});

// 2. The blob Node loads at startup.
writeFileSync(
	join(out, 'sea-config.json'),
	JSON.stringify(
		{ main: 'flock-worker.cjs', output: 'flock-worker.blob', disableExperimentalSEAWarning: true },
		null,
		2
	)
);
const sea = spawnSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
	cwd: out,
	stdio: 'inherit'
});
if (sea.status !== 0) {
	console.error('\nBuilding the blob failed.');
	process.exit(1);
}

// 3. A copy of this Node with the blob injected where Node looks for it.
copyFileSync(process.execPath, join(out, exe));
await inject(join(out, exe), 'NODE_SEA_BLOB', readFileSync(join(out, 'flock-worker.blob')), {
	sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
});

// 4. The example config beside it, so the folder is complete on its own.
copyFileSync(
	join(root, 'worker', '.worker-config.example.json'),
	join(out, '.worker-config.example.json')
);
for (const f of ['flock-worker.cjs', 'flock-worker.blob', 'sea-config.json']) {
	rmSync(join(out, f), { force: true });
}

const size = (statSync(join(out, exe)).size / 1048576).toFixed(0);
console.log(`\nBuilt ${join(out, exe)} (${size} MB, Node ${process.version}).`);
console.log('Put .worker-config.json beside it on the other machine, then run it like pnpm worker.');
