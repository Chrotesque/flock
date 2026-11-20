import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILD_PLATFORM, downloadBuild, isNewer, pickBuild, relaunchScript, signedText, swapIn } from './exeupdate.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const other = generateKeyPairSync('ed25519').privateKey;

function build(version, key = privateKey, over = {}) {
	const row = { version, platform: BUILD_PLATFORM, size: 5, sha256: 'a'.repeat(64), ...over };
	return { ...row, signature: sign(null, Buffer.from(signedText(row)), key).toString('base64') };
}

test('isNewer compares the three parts as numbers', () => {
	assert.equal(isNewer('0.24.0', '0.23.9'), true);
	assert.equal(isNewer('0.23.10', '0.23.9'), true);
	assert.equal(isNewer('0.23.9', '0.23.9'), false);
	assert.equal(isNewer('0.23.8', '0.23.9'), false);
	assert.equal(isNewer('1.0.0', 'dev'), false);
	assert.equal(isNewer('x', '0.1.0'), false);
});

test('pickBuild takes the newest signed build newer than the running one', () => {
	const rows = [build('0.24.0'), build('0.24.2'), build('0.23.9'), build('0.24.1')];
	assert.equal(pickBuild(rows, '0.23.9', pub).version, '0.24.2');
	assert.equal(pickBuild(rows, '0.24.2', pub), null);
});

test('pickBuild passes over a build signed by another key or altered after signing', () => {
	assert.equal(pickBuild([build('0.25.0', other)], '0.23.9', pub), null);
	const tampered = { ...build('0.25.0'), sha256: 'b'.repeat(64) };
	assert.equal(pickBuild([tampered], '0.23.9', pub), null);
	assert.equal(pickBuild([{ ...build('0.25.0'), signature: undefined }], '0.23.9', pub), null);
	assert.equal(pickBuild([build('0.25.0', privateKey, { platform: 'linux-x64' })], '0.23.9', pub), null);
	assert.equal(pickBuild([build('0.25.0')], '0.23.9', ''), null);
});

test('downloadBuild keeps only the exact file', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'flock-update-'));
	const bytes = Buffer.from('hello');
	const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
	const fake = async () => new Response(bytes);
	const dest = join(dir, 'w.exe.new');
	await downloadBuild('x', dest, { size: 5, sha256 }, fake);
	assert.equal(String(await readFile(dest)), 'hello');
	await assert.rejects(downloadBuild('x', dest, { size: 5, sha256: 'c'.repeat(64) }, fake), /does not match/);
	await assert.rejects(stat(dest));
	await assert.rejects(downloadBuild('x', dest, { size: 6, sha256 }, fake), /5 bytes/);
});

test('swapIn moves the old program aside and the new one in', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'flock-swap-'));
	const exe = join(dir, 'w.exe');
	await writeFile(exe, 'old');
	await writeFile(`${exe}.new`, 'new');
	await swapIn(exe, `${exe}.new`);
	assert.equal(String(await readFile(exe)), 'new');
	assert.equal(String(await readFile(`${exe}.old`)), 'old');
});

test('relaunchScript quotes the path and waits before starting', () => {
	const script = relaunchScript("C:\\It's here\\w.exe");
	const encoded = script.match(/'-EncodedCommand','([^']+)'/)[1];
	const inner = Buffer.from(encoded, 'base64').toString('utf16le');
	assert.match(inner, /Start-Sleep -Seconds 4/);
	assert.match(inner, /'C:\\It''s here\\w\.exe'/);
	assert.match(inner, /--autostart/);
});
