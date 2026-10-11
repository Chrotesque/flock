// Choosing a watch or project folder with the Windows folder dialog.
//
// A browser cannot hand back a real path — its folder picker yields a handle
// and a name, never where the folder is — and the local folders belong to the
// worker's machine anyway. So Settings asks, and the worker opens the dialog
// on its own desktop and writes the answer back through PocketBase, the same
// round trip as a vidIQ score.
//
// The dialog is the modern Explorer one (IFileOpenDialog with
// FOS_PICKFOLDERS), driven from Windows PowerShell through a few lines of C#.
// FolderBrowserDialog would be simpler, but under PowerShell 5.1 it is the old
// tree view with no address bar to paste a path into.

import { execFile } from 'node:child_process';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# Add-Type reports progress, which a redirected stderr gets as CLIXML noise.
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FlockFolderPicker {
	[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
	class FileOpenDialog {}

	[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IShellItem {
		void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
		void GetParent(out IShellItem ppsi);
		void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
	}

	[ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IFileDialog {
		[PreserveSig] int Show(IntPtr parent);
		void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
		void SetFileTypeIndex(uint iFileType);
		void GetFileTypeIndex(out uint piFileType);
		void Advise(IntPtr pfde, out uint pdwCookie);
		void Unadvise(uint dwCookie);
		void SetOptions(uint fos);
		void GetOptions(out uint pfos);
		void SetDefaultFolder(IShellItem psi);
		void SetFolder(IShellItem psi);
		void GetFolder(out IShellItem ppsi);
		void GetCurrentSelection(out IShellItem ppsi);
		void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
		void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
		void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
		void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
		void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
		void GetResult(out IShellItem ppsi);
	}

	const uint FOS_PICKFOLDERS = 0x20;
	const uint FOS_FORCEFILESYSTEM = 0x40;
	const uint SIGDN_FILESYSPATH = 0x80058000;
	const int CANCELLED = unchecked((int)0x800704C7);

	// Null on cancel.
	public static string Pick(IntPtr owner, string title) {
		IFileDialog dialog = (IFileDialog)new FileOpenDialog();
		uint options;
		dialog.GetOptions(out options);
		dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
		dialog.SetTitle(title);
		int hr = dialog.Show(owner);
		if (hr == CANCELLED) return null;
		Marshal.ThrowExceptionForHR(hr);
		IShellItem item;
		dialog.GetResult(out item);
		string path;
		item.GetDisplayName(SIGDN_FILESYSPATH, out path);
		return path;
	}
}
'@

# A topmost owner, so the dialog comes up in front of the browser rather than
# behind it: the worker is a background process, and Windows will not let one
# of those simply take the foreground. One borderless pixel in the middle of
# the screen the pointer is on, since the dialog opens over its owner: parked
# off-screen, as it was, the dialog came up in the top-left corner of the
# main screen, which on a PC with several monitors is easy to miss.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.StartPosition = 'Manual'
$owner.Size = New-Object System.Drawing.Size(1, 1)
# The dialog opens with its top-left corner at the owner (about 1200 x 720),
# so the owner sits that much up and left of the middle.
$area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
$x = [Math]::Max($area.X, $area.X + [int](($area.Width - 1200) / 2))
$y = [Math]::Max($area.Y, $area.Y + [int](($area.Height - 720) / 2))
$owner.Location = New-Object System.Drawing.Point($x, $y)
$owner.Show()
$owner.Activate()
try {
	$path = [FlockFolderPicker]::Pick($owner.Handle, 'Choose a folder for flock')
	if ($path) { [Console]::Out.Write($path) }
} finally {
	$owner.Close()
}
`;

/**
 * How long the dialog may stay open before the worker gives up on it. Short
 * enough that a dialog nobody saw does not hold the next request for long —
 * though a newer request closes it at once anyway (index.mjs).
 */
const DIALOG_MAX_MS = 5 * 60_000;

/**
 * What PowerShell wrote to stderr, readable. A redirected stderr carries
 * CLIXML — `#< CLIXML` and an XML stream — whose error records are the only
 * part worth showing; anything else is passed through as it is.
 */
export function readStderr(stderr) {
	const text = String(stderr ?? '').trim();
	if (!text.startsWith('#< CLIXML')) return text;
	const errors = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) =>
		m[1]
			.replace(/_x000D_/g, '')
			.replace(/_x000A_/g, '\n')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&')
	);
	return errors.join('').trim();
}

/**
 * The PowerShell arguments. No `-WindowStyle Hidden` here, unlike the tray
 * icon (tray.mjs): started from the background executable the dialog shows
 * without it (tested 11 Oct 2026), and with it the dialog came up without
 * the keyboard focus.
 */
export function dialogArgs(script) {
	// -EncodedCommand takes UTF-16LE base64, which spares the script every
	// layer of quoting between here and PowerShell.
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	return ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
}

/**
 * Opens the dialog and resolves to the chosen folder, or null if it was
 * cancelled. Windows only — elsewhere there is no dialog to open, and a worker
 * in a NAS container has no local folders to offer in the first place.
 * Aborting `signal` closes the dialog (its PowerShell is ended) and rejects
 * with an AbortError.
 */
export function pickFolder({ signal } = {}) {
	if (process.platform !== 'win32') {
		return Promise.reject(
			new Error('The folder dialog needs the worker to run on Windows, on the PC with the folders.')
		);
	}
	return new Promise((resolve, reject) => {
		execFile(
			'powershell.exe',
			dialogArgs(SCRIPT),
			{ windowsHide: true, timeout: DIALOG_MAX_MS, maxBuffer: 1024 * 1024, signal },
			(err, stdout, stderr) => {
				if (err?.name === 'AbortError') {
					reject(err);
					return;
				}
				if (err) {
					const why = err.killed
						? 'nobody answered it within 5 minutes, on the PC the worker runs on.'
						: readStderr(stderr) || err.message;
					reject(new Error(`Folder dialog failed: ${why.slice(0, 500)}`));
					return;
				}
				const path = stdout.trim();
				resolve(path || null);
			}
		);
	});
}
