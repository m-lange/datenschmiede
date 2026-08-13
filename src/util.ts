import * as vscode from 'vscode';

/** Erzeugt eine zufällige Nonce für die Content-Security-Policy der Webview. */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/** Range, die das gesamte Dokument abdeckt (für einen Voll-Ersatz des Texts). */
export function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
	const lastLine = document.lineCount - 1;
	return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
}

/**
 * Löst den Zielordner für einen "Neu…"-Befehl auf (siehe commands/newTable.ts,
 * commands/newProject.ts): der per Rechtsklick im Explorer gewählte Ordner
 * (bzw. dessen übergeordneter Ordner, falls eine Datei angeklickt wurde),
 * sonst der erste Workspace-Ordner.
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
			// Ziel existiert nicht (mehr) -> auf Workspace-Root zurückfallen.
		}
	}

	if (vscode.workspace.workspaceFolders?.length) {
		return vscode.workspace.workspaceFolders[0].uri;
	}

	return undefined;
}

export async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
