import * as vscode from 'vscode';
import { createEmptyTable } from '../model';
import { serializeTable } from '../toml';
import { TableEditorProvider } from '../editorProvider';
import { fileExists, resolveTargetFolder, validateNewFileName, writeNewFile } from '../../util';

/**
 * "New Table…" command: creates a new .td file containing an empty skeleton and
 * opens it straight away in the custom editor.
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
		validateInput: validateNewFileName,
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
	if (!(await writeNewFile(fileUri, content))) {
		return;
	}

	await vscode.commands.executeCommand('vscode.openWith', fileUri, TableEditorProvider.viewType);
}
