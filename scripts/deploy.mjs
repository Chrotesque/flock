// Builds flock and mirrors it into its PocketBase's pb_public.
//
//   pnpm deploy        build and sync
//   pnpm deploy:dry    show what would change, touch nothing
//
// The destination comes from FLOCK_DEPLOY_DEST, in the environment or in .env,
// and must be a pb_public directory. The guard below refuses anything else,
// because robocopy /MIR deletes whatever it finds in the destination that is
// not in the source — pointed at a pb_public that other apps share, it erases
// them.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'build');

// .env already holds the dev URL, so the deploy destination lives there too.
try {
	process.loadEnvFile(join(root, '.env'));
} catch {
	// No .env: the environment alone has to say where to deploy.
}
const dest = process.env.FLOCK_DEPLOY_DEST || '';
const dry = process.argv.includes('--dry');

function fail(message) {
	console.error(`\n${message}\n`);
	process.exit(1);
}

if (!dest) {
	fail(
		'FLOCK_DEPLOY_DEST is not set.\n\n' +
			"Put the pb_public directory of flock's PocketBase in .env, for example\n" +
			'  FLOCK_DEPLOY_DEST=\\\\nas\\appdata\\pocketbase_flock\\pb_public\n' +
			'or set it in the environment.'
	);
}

const normalised = dest.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
if (!/\/pb_public$/.test(normalised)) {
	fail(
		`Refusing to deploy to:\n  ${dest}\n\n` +
			'The destination must be a pb_public directory.\n' +
			'This guard exists because the sync mirrors — aimed at a pb_public that\n' +
			'other apps share, it would delete them.'
	);
}

// The app resolves its API from window.location.origin when this is empty, so
// the deployed copy talks to whichever address it was served from rather than a
// single hard-coded one. Dev keeps the explicit URL from .env.
const build = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
	cwd: root,
	stdio: 'inherit',
	env: { ...process.env, PUBLIC_POCKETBASE_URL: '' }
});
if (build.status !== 0) fail('Build failed — nothing was copied.');

if (!existsSync(join(source, 'index.html'))) {
	fail('build/index.html is missing. Refusing to sync an incomplete build.');
}

if (!existsSync(dest)) {
	fail(`Destination is not reachable:\n  ${dest}\n\nIs the share mounted?`);
}

// Fail on permissions before robocopy does, since its exit codes are opaque.
const probe = join(dest, '.flock-deploy-probe');
try {
	writeFileSync(probe, '');
	rmSync(probe);
} catch (err) {
	fail(
		`Cannot write to:\n  ${dest}\n\n${err.message}\n\n` +
			'The share is mounted read-only for this account. Grant write access to\n' +
			'it, or copy build/ across by hand.'
	);
}

const args = [source, dest, '/MIR', '/NFL', '/NDL', '/NJH', '/NP', '/R:2', '/W:2'];
if (dry) args.push('/L');

console.log(`\n${dry ? 'Previewing' : 'Syncing'}  ${source}\n      ->  ${dest}\n`);
// No shell: with `shell: true` Node concatenates the arguments unescaped, which
// both trips a deprecation warning and mangles any path containing a space.
const sync = spawnSync('robocopy', args, { stdio: 'inherit' });

// robocopy uses exit codes as a bit field; anything under 8 is success.
if ((sync.status ?? 16) >= 8) fail(`robocopy failed with code ${sync.status}.`);

if (!dry) {
	const files = readdirSync(dest);
	console.log(`\nDeployed. ${files.length} entries in pb_public.`);
	console.log('PocketBase serves these straight from disk — no restart needed.\n');
}
