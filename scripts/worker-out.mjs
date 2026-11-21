// Where `pnpm build:worker` writes the worker's executables and bundle, and
// where deploy-worker and publish-worker look for them.
//
// `dist/worker` in the checkout unless FLOCK_BUILD_DIR (from the environment
// or the gitignored .env) names another folder, relative to the checkout or
// absolute — so a backup of the checkout can leave the ~180 MB of rebuildable
// output elsewhere. The worker lands in `<FLOCK_BUILD_DIR>/worker`.

import { join, resolve } from 'node:path';

export function workerOutDir(root) {
	try {
		process.loadEnvFile(join(root, '.env'));
	} catch {
		// The environment alone.
	}
	return join(resolve(root, process.env.FLOCK_BUILD_DIR || 'dist'), 'worker');
}
