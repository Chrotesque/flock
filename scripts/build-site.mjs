// Builds the copy of flock that its website serves under /app/, and zips the
// website for uploading to the static host.
//
//   pnpm build:site
//
// The copy is built from the files git would commit — tracked ones and new
// ones not ignored — copied into .site-build/, so nothing ignored can reach a
// public website: not src/local-devtest/ (this machine's own pages), not
// .env, not a worker config. It has no server address built in: with
// VITE_FLOCK_SITE=1 the page asks the browser for one (src/lib/server.ts) and
// lives under /app/ (svelte.config.js). The result replaces site/app/, and
// site/site.zip is made from site/ with forward slashes in its names (a
// backslash is part of a file name on the host's Linux).

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Inside the checkout, so the copy finds node_modules by walking up.
const work = join(root, '.site-build');
const site = join(root, 'site');
const out = join(site, 'app');
const zipFile = join(site, 'site.zip');

function fail(message) {
	console.error(`\n${message}\n`);
	process.exit(1);
}

// 1. What git would commit, but the website itself.
const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
	cwd: root,
	encoding: 'utf8'
})
	.split('\0')
	.filter(Boolean);
const files = [...new Set(listed)].filter((file) => !file.startsWith('site/') && existsSync(join(root, file)));
const private_ = files.filter(
	(file) => file.startsWith('src/local-devtest/') || /(^|\/)\.env$/.test(file) || file.endsWith('.worker-config.json')
);
if (private_.length) fail(`Refusing to build: these are private, yet git would commit them:\n  ${private_.join('\n  ')}`);

// 2. A clean copy of them.
rmSync(work, { recursive: true, force: true });
for (const file of files) {
	const to = join(work, file);
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(join(root, file), to);
}
console.log(`Copied ${files.length} files into .site-build/.`);

// 3. Built for the website: under /app/, asking for its server.
const built = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
	cwd: work,
	stdio: 'inherit',
	env: { ...process.env, VITE_FLOCK_SITE: '1', PUBLIC_POCKETBASE_URL: '' }
});
const build = join(work, 'build');
if (built.status !== 0) fail('Build failed — site/app/ was left as it was.');
if (!existsSync(join(build, 'index.html'))) fail('The build has no index.html — site/app/ was left as it was.');

// 4. Nothing of this machine in it: the hosts its own configs name.
const leaks = machineHosts().flatMap((host) =>
	walk(build)
		.filter((file) => /\.(html|js|json|css|txt)$/.test(file) && readFileSync(file, 'utf8').includes(host))
		.map((file) => `${host} in ${relative(build, file)}`)
);
if (leaks.length) fail(`Refusing to publish: the build names this machine's own hosts:\n  ${leaks.join('\n  ')}`);

// 5. Into site/app/, and the website zipped.
rmSync(out, { recursive: true, force: true });
cpSync(build, out, { recursive: true });
rmSync(work, { recursive: true, force: true });
const zipped = zipFolder(site, zipFile, (name) => !/\.zip$|(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name));
console.log(`\nsite/app/ holds the website's copy of flock; site/site.zip has ${zipped} files, ready to upload.`);

/** Every file under a folder. */
function walk(folder) {
	return readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

/**
 * The host names this machine's own configs point at — PocketBase's address
 * in .env, the worker's addresses, the shares deployed to — none of which may
 * reach the public build.
 */
function machineHosts() {
	const values = [];
	try {
		for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
			const match = /^\s*(PUBLIC_POCKETBASE_URL|FLOCK_[A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line);
			if (match) values.push(match[2].replace(/^["']|["']$/g, ''));
		}
	} catch {
		// No .env: nothing of it to look for.
	}
	try {
		const worker = JSON.parse(readFileSync(join(root, 'worker', '.worker-config.json'), 'utf8'));
		values.push(worker.pocketbaseUrl ?? '', worker.previewUrl ?? '');
	} catch {
		// No worker config here.
	}
	const hosts = values.map((value) => {
		const unc = /^\\\\([^\\]+)/.exec(value);
		if (unc) return unc[1];
		try {
			return new URL(value).hostname;
		} catch {
			return '';
		}
	});
	return [...new Set(hosts)].filter((host) => host.length >= 4 && host !== 'localhost' && host !== '127.0.0.1');
}

/** A folder as a zip file, names with forward slashes; returns how many files went in. */
function zipFolder(folder, target, keep) {
	const entries = walk(folder)
		.map((path) => ({ path, name: relative(folder, path).split(sep).join('/') }))
		.filter(({ name }) => keep(name))
		.sort((a, b) => a.name.localeCompare(b.name));
	const now = new Date();
	const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
	const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	const local = [];
	const central = [];
	let offset = 0;
	for (const { path, name } of entries) {
		const data = readFileSync(path);
		const packed = deflateRawSync(data, { level: 9 });
		const stored = packed.length >= data.length;
		const body = stored ? data : packed;
		const nameBytes = Buffer.from(name, 'utf8');
		const crc = crc32(data);
		// Local header: signature, version 2.0, UTF-8 names, method, time, date, CRC, sizes, name length.
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0);
		head.writeUInt16LE(20, 4);
		head.writeUInt16LE(0x0800, 6);
		head.writeUInt16LE(stored ? 0 : 8, 8);
		head.writeUInt16LE(time, 10);
		head.writeUInt16LE(date, 12);
		head.writeUInt32LE(crc, 14);
		head.writeUInt32LE(body.length, 18);
		head.writeUInt32LE(data.length, 22);
		head.writeUInt16LE(nameBytes.length, 26);
		local.push(head, nameBytes, body);
		// Its central directory entry, pointing back at the local header.
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(0x0800, 8);
		entry.writeUInt16LE(stored ? 0 : 8, 10);
		entry.writeUInt16LE(time, 12);
		entry.writeUInt16LE(date, 14);
		entry.writeUInt32LE(crc, 16);
		entry.writeUInt32LE(body.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(nameBytes.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(entry, nameBytes);
		offset += head.length + nameBytes.length + body.length;
	}
	const size = central.reduce((sum, part) => sum + part.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(size, 12);
	end.writeUInt32LE(offset, 16);
	writeFileSync(target, Buffer.concat([...local, ...central, end]));
	return entries.length;
}
