import * as vscode from 'vscode';
import { createEmptyFileGeneratorFile } from '../model';
import { serializeFileGenerator } from '../toml';
import { FILEGEN_NOTEBOOK_TYPE } from '../notebook';
import { fileExists, resolveTargetFolder } from '../../util';
import { encodeUtf8 } from '../../encoding';

/**
 * "New File Generator…" command: creates a new .filegen file with a working
 * skeleton and opens it straight away in the notebook editor.
 */
export async function newFileGeneratorCommand(target?: vscode.Uri): Promise<void> {
	const folder = await resolveTargetFolder(target);
	if (!folder) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('Please open a folder first, or pick a target folder in the Explorer.'),
		);
		return;
	}

	const input = await vscode.window.showInputBox({
		title: vscode.l10n.t('New File Generator'),
		prompt: vscode.l10n.t('File generator name'),
		placeHolder: 'csv_with_header',
		validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('The name must not be empty.')),
	});
	if (!input) {
		return;
	}

	const fileName = input.trim().endsWith('.filegen') ? input.trim() : `${input.trim()}.filegen`;
	const fileUri = vscode.Uri.joinPath(folder, fileName);

	if (await fileExists(fileUri)) {
		void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists in this folder.', fileName));
		return;
	}

	const name = fileName.replace(/\.filegen$/, '');
	await vscode.workspace.fs.writeFile(fileUri, encodeUtf8(serializeFileGenerator(createEmptyFileGeneratorFile(name))));

	await vscode.commands.executeCommand('vscode.openWith', fileUri, FILEGEN_NOTEBOOK_TYPE);
}
