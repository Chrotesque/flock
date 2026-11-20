// Updating the PC worker's executable from the NAS.
//
// `pnpm deploy:worker` builds the background exe, signs it with a key kept
// only on the machine that publishes (scripts/.worker-signing-key.json,
// gitignored) and uploads it to PocketBase's `worker_builds` — which lives on
// the NAS, so a build stays there for whichever PC comes on next. A worker
// running from that exe looks for a newer build at start and every half
// hour, offers it in its tray menu, and on a press downloads it beside
// itself, checks the size, hash and signature, finishes what it holds,
// renames itself to .old, moves the new one in, starts it and exits.
//
// The signature is what makes this safe: every collection is open to anyone
// on the tailnet, so a build is taken only when it was signed by the key
// whose public half was built into this worker (`__FLOCK_UPDATE_KEY__`).

import { createHash, verify } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** The builds a worker on this machine may take. */
export const BUILD_PLATFORM = 'win32-x64';

/** The public key built in, or '' — then this worker never updates itself. */
export const UPDATE_KEY = typeof __FLOCK_UPDATE_KEY__ === 'string' ? __FLOCK_UPDATE_KEY__ : '';

/** Whether version `a` is newer than `b` (MAJOR.FEATURE.ITERATION). */
export function isNewer(a, b) {
	const parse = (v) => String(v ?? '').split('.').map((n) => Number(n));
	const x = parse(a);
	const y = parse(b);
	if (x.length !== 3 || y.length !== 3 || [...x, ...y].some((n) => !Number.isInteger(n) || n < 0)) return false;
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
	return false;
}

/** What is signed: everything a download is checked against. */
export function signedText({ version, platform, size, sha256 }) {
	return `flock-worker\n${version}\n${platform}\n${size}\n${sha256}`;
}

/** Whether a build row was signed by the key built in. */
export function signatureHolds(build, publicKey = UPDATE_KEY) {
	if (!publicKey || typeof build?.signature !== 'string') return false;
	try {
		return verify(null, Buffer.from(signedText(build)), publicKey, Buffer.from(build.signature, 'base64'));
	} catch {
		return false;
	}
}

/**
 * The newest build newer than `current` and signed by the key, from the
 * rows PocketBase lists, or null. An unsigned or wrongly signed row is
 * passed over, never offered.
 */
export function pickBuild(rows, current, publicKey = UPDATE_KEY) {
	let best = null;
	for (const row of rows ?? []) {
		if (row?.platform !== BUILD_PLATFORM || !isNewer(row.version, current)) continue;
		if (!Number.isInteger(row.size) || row.size <= 0 || !/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) continue;
		if (!signatureHolds(row, publicKey)) continue;
		if (!best || isNewer(row.version, best.version)) best = row;
	}
	return best;
}

/**
 * Downloads a build to `dest`, refusing anything that is not exactly the
 * signed file: size and SHA-256 compared before it is kept.
 */
export async function downloadBuild(url, dest, build, fetchImpl = fetch) {
	const res = await fetchImpl(url);
	if (!res.ok || !res.body) throw new Error(`Download refused (${res.status})`);
	const hash = createHash('sha256');
	let size = 0;
	const counter = new Transform({
		transform(chunk, _enc, done) {
			hash.update(chunk);
			size += chunk.length;
			done(null, chunk);
		}
	});
	try {
		await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(dest));
		if (size !== build.size) throw new Error(`Download was ${size} bytes, the build ${build.size}`);
		const got = hash.digest('hex');
		if (got !== build.sha256) throw new Error('Download does not match the signed build');
	} catch (err) {
		await rm(dest, { force: true });
		throw err;
	}
}

/** The SHA-256 of a file on disk, hex. */
export async function fileHash(path) {
	const hash = createHash('sha256');
	await pipeline(createReadStream(path), hash);
	return hash.digest('hex');
}

/**
 * A Windows program's subsystem (2 = no window, 3 = console), read from its
 * PE header — the published build is the windowless one, and a worker run
 * from the console exe keeps its console.
 */
export async function peSubsystem(path) {
	const fd = await open(path, 'r');
	try {
		const head = Buffer.alloc(4096);
		await fd.read(head, 0, head.length, 0);
		const pe = head.readUInt32LE(0x3c);
		if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
		return head.readUInt16LE(pe + 24 + 68);
	} finally {
		await fd.close();
	}
}

export async function setPeSubsystem(path, value) {
	const fd = await open(path, 'r+');
	try {
		const head = Buffer.alloc(4096);
		await fd.read(head, 0, head.length, 0);
		const pe = head.readUInt32LE(0x3c);
		if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a Windows program');
		const field = Buffer.alloc(2);
		field.writeUInt16LE(value);
		await fd.write(field, 0, 2, pe + 24 + 68);
	} finally {
		await fd.close();
	}
}

/**
 * Moves the new program in: the running one is renamed (Windows lets a
 * running exe be renamed, not overwritten) to `.old`, the download to the
 * program's name. A failed second step puts the first back.
 */
export async function swapIn(exe, incoming) {
	const old = `${exe}.old`;
	await rm(old, { force: true });
	await rename(exe, old);
	try {
		await rename(incoming, exe);
	} catch (err) {
		await rename(old, exe).catch(() => {});
		throw err;
	}
}

/** Leftovers of an earlier update: the old program and a half download. */
export async function cleanUp(exe) {
	for (const leftover of [`${exe}.old`, `${exe}.new`]) {
		try {
			await stat(leftover);
		} catch {
			continue;
		}
		// The old one may still be closing for a moment after the swap.
		for (let i = 0; i < 10; i++) {
			try {
				await rm(leftover, { force: true });
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 2000));
			}
		}
	}
}

/**
 * The PowerShell that starts the new program once this one has gone:
 * Node's children die with it, so this starter launches a second one through
 * Start-Process (which outlives it) that waits a few seconds — for this
 * worker to let go of its instance pipe — and then starts the program.
 * `--autostart` keeps a start that still finds the old one up from showing
 * its "already running" box.
 */
export function relaunchScript(exe) {
	const quoted = `'${exe.replace(/'/g, "''")}'`;
	const inner = `Start-Sleep -Seconds 4; Start-Process -FilePath ${quoted} -ArgumentList '--autostart'`;
	const encoded = Buffer.from(inner, 'utf16le').toString('base64');
	return `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','${encoded}'`;
}
