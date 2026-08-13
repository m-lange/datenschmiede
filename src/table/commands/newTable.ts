import * as vscode from 'vscode';
import { createEmptyTable } from '../model';
import { serializeTable } from '../toml';
import { TableEditorProvider } from '../editorProvider';
import { fileExists, resolveTargetFolder } from '../../util';

/**
 * Befehl "Neue Tabelle erstellen…": legt eine neue .td-Datei mit
 * einem leeren Grundgerüst an und öffnet sie direkt im Custom Editor.
 */
export async function newTableCommand(target?: vscode.Uri): Promise<void> {
	const folder = await resolveTargetFolder(target);
	if (!folder) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('Please open a folder first, or pick a target folder in the Explorer.'),
		);
		return;
	}

	const input = await vscode.window.showInputBox({
		title: vscode.l10n.t('New Table'),
		prompt: vscode.l10n.t('Table name'),
		placeHolder: 'customers',
		validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('The name must not be empty.')),
	});
	if (!input) {
		return;
	}

	const fileName = input.trim().endsWith('.td') ? input.trim() : `${input.trim()}.td`;
	const fileUri = vscode.Uri.joinPath(folder, fileName);

	if (await fileExists(fileUri)) {
		void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists in this folder.', fileName));
		return;
	}

	const tableName = fileName.replace(/\.td$/, '');
	const content = serializeTable(createEmptyTable(tableName));
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

	await vscode.commands.executeCommand('vscode.openWith', fileUri, TableEditorProvider.viewType);
}
