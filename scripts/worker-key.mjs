// The key PC worker builds are signed with (worker/exeupdate.mjs).
//
//   pnpm worker:key     make it, once — refuses if one is there
//
// Kept in scripts/.worker-signing-key.json (gitignored), or wherever
// FLOCK_SIGNING_KEY names. The public half is built into every worker; a
// worker takes an update only when it was signed with the private half. Lose
// the file and the next key's builds are refused by every worker out there:
// each PC then needs one exe swapped by hand.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
	process.loadEnvFile(join(root, '.env'));
} catch {
	// No .env: the default place.
}

export const KEY_FILE = process.env.FLOCK_SIGNING_KEY || join(root, 'scripts', '.worker-signing-key.json');

/** `{ publicKey, privateKey }` as PEM, or null when there is no key yet. */
export function loadSigningKey() {
	if (!existsSync(KEY_FILE)) return null;
	const value = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
	if (typeof value?.publicKey !== 'string' || typeof value?.privateKey !== 'string') {
		throw new Error(`${KEY_FILE} holds no key pair`);
	}
	return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (existsSync(KEY_FILE)) {
		console.error(`\nA signing key is there already:\n  ${KEY_FILE}\n\nNot replacing it: workers built with it would refuse every later build.\n`);
		process.exit(1);
	}
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	writeFileSync(
		KEY_FILE,
		JSON.stringify(
			{
				publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
				privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
				created: new Date().toISOString()
			},
			null,
			2
		)
	);
	console.log(`\nSigning key written to\n  ${KEY_FILE}\n\nKeep a copy somewhere safe; it never goes into git.\n`);
}
