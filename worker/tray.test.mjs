import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { messageScript, psQuote, trayScript, wantsTray } from './tray.mjs';

describe('wantsTray', () => {
	const exe = { env: {}, platform: 'win32', sea: true, tty: undefined };

	it('shows an icon for the executable without a console', () => {
		assert.equal(wantsTray(exe), true);
	});

	it('shows none where there is a console, a script run or another system', () => {
		assert.equal(wantsTray({ ...exe, tty: true }), false);
		assert.equal(wantsTray({ ...exe, sea: false }), false);
		assert.equal(wantsTray({ ...exe, platform: 'linux' }), false);
	});

	it('can be forced either way on Windows', () => {
		assert.equal(wantsTray({ ...exe, tty: true, env: { FLOCK_TRAY: '1' } }), true);
		assert.equal(wantsTray({ ...exe, env: { FLOCK_TRAY: '0' } }), false);
		assert.equal(wantsTray({ ...exe, platform: 'linux', env: { FLOCK_TRAY: '1' } }), false);
	});
});

describe('psQuote', () => {
	it("doubles single quotes, PowerShell's only escape in such a string", () => {
		assert.equal(psQuote("C:\\Joe's\\flock-worker.log"), "'C:\\Joe''s\\flock-worker.log'");
		assert.equal(psQuote('$env:USERNAME `n'), "'$env:USERNAME `n'");
		assert.equal(psQuote(undefined), "''");
	});
});

describe('trayScript', () => {
	const script = trayScript({
		pid: 4242,
		title: 'flock worker (local)',
		url: 'https://flock.example/',
		logPath: "C:\\it's\\flock-worker.log"
	});

	it('fills in every value, quoted', () => {
		assert.match(script, /GetProcessById\(4242\)/);
		assert.match(script, /\$url = 'https:\/\/flock\.example\/'/);
		assert.match(script, /\$log = 'C:\\it''s\\flock-worker\.log'/);
		assert.match(script, /\$tray\.Text = 'flock worker \(local\)'/);
		assert.doesNotMatch(script, /\$\{/);
	});

	it('keeps the tooltip within what Windows allows', () => {
		const long = trayScript({ pid: 1, title: 'x'.repeat(100), url: '', logPath: '' });
		assert.match(long, new RegExp(`\\$tray\\.Text = 'x{63}'`));
	});

	it('fits on a Windows command line once encoded', () => {
		const encoded = Buffer.from(script, 'utf16le').toString('base64');
		assert.ok(encoded.length < 30_000, `${encoded.length} characters`);
	});
});

describe('messageScript', () => {
	const text = "No worker configuration: C:\\Joe's\\.worker-config.json does not exist.\n\nIts log: C:\\x\\flock-worker.log";

	it('puts the text and title in quoted, line breaks and all', () => {
		const script = messageScript({ title: 'flock worker', text });
		assert.match(script, /C:\\Joe''s\\\.worker-config\.json does not exist\.\n\nIts log/);
		assert.match(script, /'flock worker', 'OK', 'Warning'\)/);
		assert.doesNotMatch(script, /\$\{/);
	});

	it('is a plain notice when it is not a warning', () => {
		assert.match(messageScript({ title: 't', text: 'x', warn: false }), /'OK', 'Information'\)/);
	});

	it('fits on a Windows command line, encoded twice over as showMessage sends it', () => {
		const box = Buffer.from(messageScript({ title: 'flock worker', text: text + 'x'.repeat(2000) }), 'utf16le').toString('base64');
		const starter = `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-EncodedCommand','${box}'`;
		const encoded = Buffer.from(starter, 'utf16le').toString('base64');
		assert.ok(encoded.length < 30_000, `${encoded.length} characters`);
	});
});
