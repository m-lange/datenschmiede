import * as vscode from 'vscode';
import { createEmptyLookup } from '../model';
import { serializeLookup } from '../csv';
import { LookupEditorProvider } from '../editorProvider';
import { fileExists, resolveTargetFolder } from '../../util';

/**
 * "New Lookup List…" command: creates a new .lkp file containing an empty
 * skeleton and opens it straight away in the custom editor — analogous to
 * table/commands/newTable.ts.
 */
export async function newLookupCommand(target?: vscode.Uri): Promise<void> {
	const folder = await resolveTargetFolder(target);
	if (!folder) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('Please open a folder first, or pick a target folder in the Explorer.'),
		);
		return;
	}

	const input = await vscode.window.showInputBox({
		title: vscode.l10n.t('New Lookup List'),
		prompt: vscode.l10n.t('Lookup list name'),
		placeHolder: 'currencies',
		validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('The name must not be empty.')),
	});
	if (!input) {
		return;
	}

	const fileName = input.trim().endsWith('.lkp') ? input.trim() : `${input.trim()}.lkp`;
	const fileUri = vscode.Uri.joinPath(folder, fileName);

	if (await fileExists(fileUri)) {
		void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists in this folder.', fileName));
		return;
	}

	const listName = fileName.replace(/\.lkp$/, '');
	// Start with a first value column so the grid is usable right away — the
	// technical column name is deliberately not localized (it is data).
	const content = serializeLookup({ ...createEmptyLookup(listName), columns: ['value'] });
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

	await vscode.commands.executeCommand('vscode.openWith', fileUri, LookupEditorProvider.viewType);
}
