// The worker as one CommonJS file: what the single executable is built from,
// and what a machine with Node runs as it is (`node flock-worker.cjs`) — the
// NAS container does. Shared by build-worker.mjs and deploy-worker.mjs, so
// both ship the same thing.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The app's version, from the one file that holds it. */
function appVersion() {
	const source = readFileSync(join(root, 'src', 'lib', 'version.ts'), 'utf8');
	const match = source.match(/VERSION\s*=\s*'([^']+)'/);
	if (!match) throw new Error('No VERSION in src/lib/version.ts');
	return match[1];
}

// Where the local worker extensions live (worker/extensions.mjs): the
// gitignored folder of the page's DevTest modules.
const LOCAL_EXTENSIONS = join(root, 'src', 'local-devtest', 'worker');

/**
 * Builds the local worker extensions in. Run from the checkout,
 * worker/extensions-found.mjs reads their folder at the start; the bundle runs
 * where that folder is not, so the file is replaced here by one importing the
 * same files. Without the folder the bundle has none.
 */
const localExtensions = {
	name: 'flock-local-extensions',
	setup(builder) {
		builder.onLoad({ filter: /[\\/]worker[\\/]extensions-found\.mjs$/ }, () => {
			const files = existsSync(LOCAL_EXTENSIONS)
				? readdirSync(LOCAL_EXTENSIONS)
						.filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
						// A helper with no default export comes in through the module that uses it.
						.filter((name) => readFileSync(join(LOCAL_EXTENSIONS, name), 'utf8').includes('export default'))
						.sort()
				: [];
			const lines = files.map((name, i) => `import m${i} from ${JSON.stringify('./' + name)};`);
			lines.push(`export async function foundExtensions() { return [${files.map((_, i) => `m${i}`).join(', ')}]; }`);
			return { contents: lines.join('\n'), loader: 'js', resolveDir: LOCAL_EXTENSIONS };
		});
	}
};

/**
 * The single-executable loader takes nothing but CommonJS. The worker's one
 * use of import.meta (config.mjs) has a fallback for the empty import.meta of
 * a CommonJS bundle, so the warning about it is silenced. The version is
 * stamped in for worker/version.mjs.
 */
export async function bundleWorker(outfile) {
	await build({
		entryPoints: [join(root, 'worker', 'cli.mjs')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node22',
		outfile,
		define: { __FLOCK_VERSION__: JSON.stringify(appVersion()) },
		logLevel: 'warning',
		logOverride: { 'empty-import-meta': 'silent' },
		plugins: [localExtensions]
	});
}
