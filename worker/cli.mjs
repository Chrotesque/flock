#!/usr/bin/env node
// One entry for the single-file executable, which cannot have two.
//
//   flock-worker                 poll forever, like `pnpm worker`
//   flock-worker --once / --dry / --stats / --vidiq / --tiktok / --instagram
//   flock-worker auth            the Google consent, like `pnpm worker:auth`
//   flock-worker auth --tiktok   and the other consent flows
//
// `auth` is a subcommand rather than a flag because authorize.mjs and
// index.mjs each run on import; this picks one and hands it the rest of the
// arguments exactly as `node worker/<file>.mjs` would have seen them. No
// top-level await: the bundle the executable is built from is CommonJS, which
// has none, and each module reports its own failures anyway.

const args = process.argv.slice(2);

// UMASK, as Unraid's containers take it ("000"): run as nobody:users with
// root's default 022, the destination copies would be read-only over SMB.
if (process.env.UMASK && /^[0-7]{1,4}$/.test(process.env.UMASK)) {
	process.umask(parseInt(process.env.UMASK, 8));
}

if (args[0] === 'auth') {
	process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];
	void import('./authorize.mjs');
} else {
	void import('./index.mjs');
}
