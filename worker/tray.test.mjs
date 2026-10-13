import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapScript, messageScript, psQuote, trayHostScript, trayStartCall, wantsTray } from './tray.mjs';
import { TRAY_APP_CS } from './trayapp.mjs';

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

describe('trayStartCall', () => {
	const call = trayStartCall({
		pid: 4242,
		title: 'flock worker (local)',
		url: 'https://flock.example/',
		logPath: "C:\\it's\\flock-worker.log",
		exePath: 'C:\\Program Files\\flock\\flock-worker-background.exe',
		runName: 'flock worker (local)',
		settings: { position: 'bottom-left' }
	});

	it('fills in every value, quoted', () => {
		assert.match(call, /^\[FlockTray\.App\]::Start\(4242, 'flock worker \(local\)', 'https:\/\/flock\.example\/', /);
		assert.match(call, /'C:\\it''s\\flock-worker\.log', 'C:\\Program Files\\flock\\flock-worker-background\.exe', 'flock worker \(local\)', /);
		const settings64 = call.match(/'flock worker \(local\)', '([A-Za-z0-9+/=]+)'/)[1];
		assert.deepEqual(JSON.parse(Buffer.from(settings64, 'base64').toString('utf8')), { position: 'bottom-left' });
	});

	it('keeps the tooltip within what Windows allows', () => {
		const long = trayStartCall({ pid: 1, title: 'x'.repeat(100), url: '', logPath: '' });
		assert.match(long, /Start\(1, 'x{63}', /);
	});
});

describe('trayHostScript', () => {
	const script = trayHostScript('[FlockTray.App]::Start()');

	it('compiles the helper from a here-string nothing in it can end early', () => {
		const lines = script.split('\r\n');
		const open = lines.findIndex((line) => line.endsWith("-TypeDefinition @'"));
		const close = lines.indexOf("'@");
		assert.ok(open > 0 && close > open, 'here-string opened and closed');
		assert.equal(lines.slice(open + 1, close).filter((line) => line.startsWith("'@")).length, 0);
		assert.equal(lines.at(-1), '[FlockTray.App]::Start()');
	});

	it('is plain ASCII C# 5, as the compiler and every encoding on the way take it', () => {
		assert.equal([...TRAY_APP_CS].filter((c) => c.charCodeAt(0) > 127).length, 0);
		assert.doesNotMatch(TRAY_APP_CS, /\$"|\?\.|=>/);
	});
});

describe('bootstrapScript', () => {
	it('reads the script from its file, deletes it, and fits on a command line', () => {
		const boot = bootstrapScript("C:\\Users\\Jo's\\AppData\\Local\\Temp\\flock-tray-1-ab.ps1");
		assert.match(boot, /\$p = 'C:\\Users\\Jo''s\\AppData\\Local\\Temp\\flock-tray-1-ab\.ps1'/);
		assert.match(boot, /Remove-Item -LiteralPath \$p/);
		assert.ok(Buffer.from(boot, 'utf16le').toString('base64').length < 2000);
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
