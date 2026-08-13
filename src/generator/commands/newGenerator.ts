import * as vscode from 'vscode';
import { createEmptyGeneratorFile } from '../model';
import { serializeGenerator } from '../toml';
import { GeneratorEditorProvider } from '../editorProvider';
import { fileExists, resolveTargetFolder } from '../../util';

/**
 * Befehl "Neuen Generator erstellen…": legt eine neue .tdgen-Datei mit
 * einem Grundgerüst (Beispiel-Code-Zellen) an und öffnet sie direkt im
 * Custom Editor — Gegenstück zu table/commands/newTable.ts.
 */
export async function newGeneratorCommand(target?: vscode.Uri): Promise<void> {
	const folder = await resolveTargetFolder(target);
	if (!folder) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('Please open a folder first, or pick a target folder in the Explorer.'),
		);
		return;
	}

	const input = await vscode.window.showInputBox({
		title: vscode.l10n.t('New Generator'),
		prompt: vscode.l10n.t('Generator name'),
		placeHolder: 'my_generator',
		validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('The name must not be empty.')),
	});
	if (!input) {
		return;
	}

	const fileName = input.trim().endsWith('.tdgen') ? input.trim() : `${input.trim()}.tdgen`;
	const fileUri = vscode.Uri.joinPath(folder, fileName);

	if (await fileExists(fileUri)) {
		void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists in this folder.', fileName));
		return;
	}

	const generatorName = fileName.replace(/\.tdgen$/, '');
	const content = serializeGenerator(createEmptyGeneratorFile(generatorName));
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

	await vscode.commands.executeCommand('vscode.openWith', fileUri, GeneratorEditorProvider.viewType);
}
