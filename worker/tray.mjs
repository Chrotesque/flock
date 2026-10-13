// The background worker's icon in the Windows notification area.
//
// flock-worker-background.exe has no window, so the icon is what says it is
// running and what stops it. Node cannot draw one itself; a hidden Windows
// PowerShell (5.1, on every Windows) compiles a small C# WinForms program
// (trayapp.mjs) and runs it: the icon and its menu, and since 0.15.0 the
// warning card for a post that did not go out (alerts.mjs), its settings
// window and Start with Windows. The worker and the helper talk in lines over
// the helper's stdin and stdout (alerts.mjs encodeLine): the menu's Stop
// shuts the worker down as on ctrl-c. The helper holds a handle on the
// worker's process and closes the icon itself once that has exited — after a
// stop or a crash alike — so no stale icon is left behind.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSea } from 'node:sea';
import { decodeLine, encodeLine } from './alerts.mjs';
import { exeLogPath } from './filelog.mjs';
import { TRAY_APP_CS } from './trayapp.mjs';
import { TRAY_ICON_PNG } from './trayicon.mjs';

/**
 * Only for the executable without a console: one with a window, `pnpm worker`
 * and the NAS container have somewhere to be seen and stopped already.
 * FLOCK_TRAY=1 or 0 forces it either way.
 */
export function wantsTray({ env = process.env, platform = process.platform, sea = isSea(), tty = process.stdout.isTTY } = {}) {
	if (env.FLOCK_TRAY === '0') return false;
	if (platform !== 'win32') return false;
	if (env.FLOCK_TRAY === '1') return true;
	return sea && !tty;
}

/** A value as a single-quoted PowerShell string: '' is the only escape there. */
export function psQuote(value) {
	return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

/**
 * Windows PowerShell compiling the helper (trayapp.mjs) and running `call` —
 * App.Start, or App.Render for a look at the card and the window. The C#
 * goes in a single-quoted here-string, inside which nothing is expanded.
 */
export function trayHostScript(call) {
	return [
		"$ErrorActionPreference = 'Stop'",
		// Add-Type reports progress, which a redirected stderr gets as CLIXML noise.
		"$ProgressPreference = 'SilentlyContinue'",
		'Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions',
		"Add-Type -IgnoreWarnings -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions -TypeDefinition @'",
		TRAY_APP_CS.trim(),
		"'@",
		call
	].join('\r\n');
}

/** The call that starts the helper for this worker; `settings` are the card's (alerts.mjs). */
export function trayStartCall({ pid, title, url, logPath, exePath = '', runName = 'flock worker', settings = {} }) {
	const settings64 = Buffer.from(JSON.stringify(settings), 'utf8').toString('base64');
	return (
		`[FlockTray.App]::Start(${Number(pid)}, ${psQuote(String(title).slice(0, 63))}, ${psQuote(url)}, ` +
		`${psQuote(logPath)}, ${psQuote(exePath)}, ${psQuote(runName)}, ${psQuote(settings64)}, ${psQuote(TRAY_ICON_PNG)})`
	);
}

/**
 * The few lines that run a script from `file` and delete it once read. The
 * helper is far past what fits on a command line (32,767 characters, and
 * -EncodedCommand doubles them twice over), so it goes through a file — read
 * by a bootstrap that is itself an encoded command, which, like the helper
 * always was, no execution policy applies to.
 */
export function bootstrapScript(file) {
	return (
		`$p = ${psQuote(file)}; $s = [IO.File]::ReadAllText($p); ` +
		'Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; . ([ScriptBlock]::Create($s))'
	);
}

function spawnScript(script, stdio) {
	const file = join(tmpdir(), `flock-tray-${process.pid}-${randomBytes(4).toString('hex')}.ps1`);
	// With a byte order mark, so Windows PowerShell reads a path with any letters in it as UTF-8.
	writeFileSync(file, String.fromCharCode(0xfeff) + script, 'utf8');
	// -WindowStyle Hidden as well as windowsHide: PowerShell hiding its own
	// console is also its first ShowWindow call, which Windows would otherwise
	// apply the hidden start-up state to — the menu's, or the card's.
	const child = spawn(
		'powershell.exe',
		[
			'-NoProfile',
			'-NonInteractive',
			'-STA',
			'-ExecutionPolicy',
			'Bypass',
			'-WindowStyle',
			'Hidden',
			'-EncodedCommand',
			Buffer.from(bootstrapScript(file), 'utf16le').toString('base64')
		],
		{ windowsHide: true, stdio }
	);
	child.on('exit', () => {
		try {
			unlinkSync(file);
		} catch {
			// Deleted by the script itself, as it should be.
		}
	});
	return child;
}

/**
 * Draws the card in each size and the settings window to PNGs in `dir`,
 * showing nothing on screen. Resolves to the helper's errors, if any.
 */
export function renderTrayPreview(dir) {
	const child = spawnScript(trayHostScript(`[FlockTray.App]::Render(${psQuote(dir)}, ${psQuote(TRAY_ICON_PNG)})`), [
		'ignore',
		'pipe',
		'pipe'
	]);
	let errors = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (text) => (errors += text));
	child.stdout.resume();
	return new Promise((resolve) => child.on('exit', (code) => resolve(code ? errors.trim() || `exit ${code}` : '')));
}

/**
 * A message box, in front of whatever is open: a background process may not
 * take the foreground, so it opens over a topmost one-pixel owner in the
 * middle of the screen the pointer is on, as folderpick.mjs does its dialog.
 */
export function messageScript({ title, text, warn = true }) {
	return String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.StartPosition = 'Manual'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
$x = $area.X + [int]($area.Width / 2)
$y = $area.Y + [int]($area.Height / 2)
$owner.Location = New-Object System.Drawing.Point($x, $y)
$owner.Show()
$owner.Activate()
[void][System.Windows.Forms.MessageBox]::Show($owner, ${psQuote(text)}, ${psQuote(title)}, 'OK', ${warn ? "'Warning'" : "'Information'"})
$owner.Close()
`;
}

/**
 * Shows `messageScript`, resolving once the box is on its way — not when it
 * is closed, so the worker can exit behind it. Node puts what it starts in a
 * job that ends with it, which would close the box the moment the worker
 * exits; a program started by one of those is outside that job (libuv allows
 * the breakaway), so a first PowerShell starts the box's own and leaves.
 */
export function showMessage({ title, text, warn = true }) {
	const box = Buffer.from(messageScript({ title, text, warn }), 'utf16le').toString('base64');
	// -WindowStyle Hidden twice, for the reason given in startTray.
	const starter =
		"Start-Process powershell.exe -WindowStyle Hidden -ArgumentList " +
		`'-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-EncodedCommand','${box}'`;
	return new Promise((resolve) => {
		const child = spawn(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(starter, 'utf16le').toString('base64')],
			{ windowsHide: true, stdio: 'ignore' }
		);
		const timer = setTimeout(resolve, 10_000);
		const done = () => {
			clearTimeout(timer);
			resolve();
		};
		child.on('error', done);
		child.on('exit', done);
	});
}

/**
 * The executable without a console, stopping on its way up — no config, flock
 * out of reach, one already running — or after a crash: its icon is not up
 * yet or goes with it, so this is the only thing anyone would see. Says
 * where the log is. Does nothing for a run that has a console to print to.
 */
export function sayOnScreen(text, { warn = true } = {}) {
	if (!wantsTray()) return Promise.resolve();
	const log = exeLogPath();
	return showMessage({ title: 'flock worker', text: log ? `${text}\n\nIts log: ${log}` : text, warn });
}

/**
 * Starts the helper. `onStop` runs when its Stop is chosen, `onDismiss(keys)`
 * when the card's Dismiss is pressed, `onSettings(settings)` when its window
 * saves. Returns `send(type, payload)` for the card — `show` with the
 * warnings, `hide` — and the process. A helper that fails, or goes, costs the
 * icon and the card, never the worker.
 */
export function startTray({
	title,
	url,
	logPath,
	exePath = '',
	runName = 'flock worker',
	settings = {},
	onStop,
	onDismiss = () => {},
	onSettings = () => {},
	log
}) {
	const script = trayHostScript(trayStartCall({ pid: process.pid, title, url, logPath, exePath, runName, settings }));
	const child = spawnScript(script, ['pipe', 'pipe', 'pipe']);
	// Writing to a helper that has gone must not take the worker with it.
	child.stdin.on('error', () => {});

	let pending = '';
	let errors = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (text) => {
		pending += text;
		let at;
		while ((at = pending.indexOf('\n')) >= 0) {
			const message = decodeLine(pending.slice(0, at));
			pending = pending.slice(at + 1);
			if (!message) continue;
			const { type, payload } = message;
			if (type === 'ready') log('tray icon shown: right-click it for flock, the warning settings or to stop the worker');
			else if (type === 'stop') onStop();
			else if (type === 'dismiss' && Array.isArray(payload?.keys)) onDismiss(payload.keys);
			else if (type === 'settings' && payload) onSettings(payload);
			else if (type === 'log' && payload?.text) log(`tray: ${payload.text}`);
		}
	});
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (text) => (errors += text));
	child.on('error', (err) => log(`tray icon unavailable: ${err.message}`));
	child.on('exit', (code) => {
		if (code) log(`tray icon closed (${code}): ${errors.trim().split('\n')[0] || 'no reason given'}`);
	});

	return {
		child,
		send(type, payload) {
			if (child.exitCode !== null || !child.stdin.writable) return;
			child.stdin.write(encodeLine(type, payload));
		}
	};
}
