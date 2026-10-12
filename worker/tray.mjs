// The background worker's icon in the Windows notification area.
//
// flock-worker-background.exe has no window, so the icon is what says it is
// running and what stops it. Node cannot draw one itself; a hidden Windows
// PowerShell (5.1, on every Windows) shows it through WinForms' NotifyIcon,
// the same way folderpick.mjs opens its dialog. The menu opens flock or the
// log, or stops the worker: the helper prints "stop", the worker shuts down as
// on ctrl-c. The helper holds a handle on the worker's process and closes the
// icon itself once that has exited — after a stop or a crash alike — so no
// stale icon is left behind.

import { spawn } from 'node:child_process';
import { isSea } from 'node:sea';
import { exeLogPath } from './filelog.mjs';
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
 * The helper. `extra` runs just before the message loop — the tests use it to
 * press Stop without anyone clicking.
 */
export function trayScript({ pid, title, url, logPath, extra = '' }) {
	return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$worker = [System.Diagnostics.Process]::GetProcessById(${Number(pid)})
$url = ${psQuote(url)}
$log = ${psQuote(logPath)}
try {
	$png = [Convert]::FromBase64String(${psQuote(TRAY_ICON_PNG)})
	$bitmap = New-Object System.Drawing.Bitmap (New-Object System.IO.MemoryStream (,$png))
	$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
} catch {
	$icon = [System.Drawing.SystemIcons]::Application
}
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = ${psQuote(title.slice(0, 63))}
$menu = New-Object System.Windows.Forms.ContextMenuStrip
if ($url) {
	$open = $menu.Items.Add('Open flock')
	$open.Font = New-Object System.Drawing.Font ($open.Font, [System.Drawing.FontStyle]::Bold)
	$open.add_Click({ Start-Process $url })
	$tray.add_DoubleClick({ Start-Process $url })
}
if ($log) {
	$logItem = $menu.Items.Add('Open log')
	$logItem.add_Click({ Start-Process notepad.exe -ArgumentList ('"' + $log + '"') })
}
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$stop = $menu.Items.Add('Stop flock worker')
$stop.add_Click({
	$stop.Enabled = $false
	$tray.Text = 'flock worker: stopping'
	[Console]::Out.WriteLine('stop')
	[Console]::Out.Flush()
})
$tray.ContextMenuStrip = $menu
$tray.Visible = $true
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 1000
$watch.add_Tick({ if ($worker.HasExited) { $watch.Stop(); [System.Windows.Forms.Application]::Exit() } })
$watch.Start()
${extra}
[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
`;
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
 * Starts the helper; `onStop` runs when its Stop is chosen. Resolves to
 * nothing useful — the icon looks after itself from there, and a helper that
 * fails only costs the icon, never the worker.
 */
export function startTray({ title, url, logPath, onStop, log, extra = '' }) {
	const script = trayScript({ pid: process.pid, title, url, logPath, extra });
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	// -WindowStyle Hidden as well as windowsHide: PowerShell hiding its own
	// console is also its first ShowWindow call, which Windows would otherwise
	// apply the hidden start-up state to — the menu's.
	const child = spawn(
		'powershell.exe',
		['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
		{ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
	);

	let pending = '';
	let errors = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (text) => {
		pending += text;
		let at;
		while ((at = pending.indexOf('\n')) >= 0) {
			const line = pending.slice(0, at).trim();
			pending = pending.slice(at + 1);
			if (line === 'ready') log('tray icon shown: right-click it to open flock or stop the worker');
			if (line === 'stop') onStop();
		}
	});
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (text) => (errors += text));
	child.on('error', (err) => log(`tray icon unavailable: ${err.message}`));
	child.on('exit', (code) => {
		if (code) log(`tray icon closed (${code}): ${errors.trim().split('\n')[0] || 'no reason given'}`);
	});
	return child;
}
