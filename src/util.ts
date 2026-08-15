import * as vscode from 'vscode';
import { encodeUtf8 } from './encoding';

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

/**
 * Validation for the name prompts of the "New …" commands: the typed name
 * becomes a file name directly, so anything a file name cannot contain has to
 * be rejected here rather than surfacing as a raw file-system error afterwards
 * (a `/` would silently mean a subfolder, a `?` fails outright).
 *
 * @returns The message for `validateInput`, or `undefined` when the name is fine.
 */
export function validateNewFileName(value: string): string | undefined {
	const name = value.trim();
	if (!name) {
		return vscode.l10n.t('The name must not be empty.');
	}
	// The union of what Windows and POSIX forbid, so a project stays portable.
	const invalid = name.match(/[\\/:*?"<>|]/);
	if (invalid) {
		return vscode.l10n.t('The name must not contain any of these characters: {0}', '\\ / : * ? " < > |');
	}
	// Windows also refuses these device names, with or without an extension.
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) {
		return vscode.l10n.t('"{0}" is a reserved file name.', name);
	}
	if (name.endsWith('.') || name.endsWith(' ')) {
		return vscode.l10n.t('The name must not end with a dot or a space.');
	}
	return undefined;
}

/**
 * Writes a file freshly created by a "New …" command. A failure (no write
 * permission, a path the file system refuses) is reported as a readable
 * message — without this the command would fail with a raw file-system error
 * in a modal "command resulted in an error" dialog.
 *
 * @returns `true` when the file was written.
 */
export async function writeNewFile(uri: vscode.Uri, content: string): Promise<boolean> {
	try {
		await vscode.workspace.fs.writeFile(uri, encodeUtf8(content));
		return true;
	} catch (err) {
		const name = uri.path.split('/').pop() ?? uri.fsPath;
		void vscode.window.showErrorMessage(
			vscode.l10n.t('"{0}" could not be created: {1}', name, err instanceof Error ? err.message : String(err)),
		);
		return false;
	}
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

/**
 * Opens a file that a description links relatively (see renderMarkdownInline in
 * media/common.js). The target is resolved against the folder of the file
 * showing the description, so `../../lookups/laender.lkp` works exactly as
 * written — a webview cannot do this itself, as it knows neither the document
 * nor the file system. Each file opens in its own editor, which for `.td`,
 * `.tdproject`, `.lkp`, `.tdgen` and `.filegen` is the matching visual one.
 *
 * A missing target is reported instead of being swallowed: a typo in a
 * description would otherwise look like a link that simply does nothing.
 */
export async function openRelativeLink(documentUri: vscode.Uri, target: string): Promise<void> {
	// Anchors and query strings belong to web links; for a file they are noise.
	const relative = target.trim().split('#')[0].split('?')[0].trim();
	if (!relative) {
		return;
	}
	const uri = vscode.Uri.joinPath(documentUri, '..', relative);
	if (!(await fileExists(uri))) {
		void vscode.window.showWarningMessage(
			vscode.l10n.t('"{0}" was not found — the link points at a file that does not exist.', relative),
		);
		return;
	}
	await vscode.commands.executeCommand('vscode.open', uri);
}
