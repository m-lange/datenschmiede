import * as vscode from 'vscode';

/** Generates a random nonce for the webview's Content Security Policy. */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/** Range covering the whole document (used to replace its text wholesale). */
export function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
	const lastLine = document.lineCount - 1;
	return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
}

/**
 * Resolves the target folder for a "New…" command (see commands/newTable.ts,
 * commands/newProject.ts): the folder right-clicked in the explorer — or its
 * parent folder if a file was clicked — and otherwise the first workspace
 * folder.
 */
export async function resolveTargetFolder(target: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
	if (target) {
		try {
			const stat = await vscode.workspace.fs.stat(target);
			if (stat.type & vscode.FileType.Directory) {
				return target;
			}
			return vscode.Uri.joinPath(target, '..');
		} catch {
			// Target no longer exists -> fall back to the workspace root.
		}
	}

	if (vscode.workspace.workspaceFolders?.length) {
		return vscode.workspace.workspaceFolders[0].uri;
	}

	return undefined;
}

/** Returns whether the given URI points at an existing file or folder. */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
