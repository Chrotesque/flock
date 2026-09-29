// Choosing a local watch folder with the Windows folder dialog.
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

# A topmost owner off-screen, so the dialog comes up in front of the browser
# rather than behind it: the worker is a background process, and Windows will
# not let one of those simply take the foreground.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$owner.Activate()
try {
	$path = [FlockFolderPicker]::Pick($owner.Handle, 'Choose a local watch folder for flock')
	if ($path) { [Console]::Out.Write($path) }
} finally {
	$owner.Close()
}
`;

/**
 * Opens the dialog and resolves to the chosen folder, or null if it was
 * cancelled. Windows only — elsewhere there is no dialog to open, and a worker
 * in a NAS container has no local folders to offer in the first place.
 */
export function pickFolder() {
	if (process.platform !== 'win32') {
		return Promise.reject(
			new Error('The folder dialog needs the worker to run on Windows, on the PC with the folders.')
		);
	}
	// -EncodedCommand takes UTF-16LE base64, which spares the script every
	// layer of quoting between here and PowerShell.
	const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
	return new Promise((resolve, reject) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
			{ windowsHide: true, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) {
					reject(new Error(`Folder dialog failed: ${(stderr || err.message).trim().slice(0, 500)}`));
					return;
				}
				const path = stdout.trim();
				resolve(path || null);
			}
		);
	});
}
