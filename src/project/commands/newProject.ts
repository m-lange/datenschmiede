import * as vscode from 'vscode';
import { createEmptyProject } from '../model';
import { serializeProject } from '../toml';
import { ProjectEditorProvider } from '../editorProvider';
import { fileExists, resolveTargetFolder } from '../../util';

/**
 * Befehl "Neues Testdatenprojekt erstellen…": legt eine neue .tdproject-Datei
 * mit leerem Grundgerüst an und öffnet sie direkt im Custom Editor. Analog zu
 * table/commands/newTable.ts.
 */
export async function newProjectCommand(target?: vscode.Uri): Promise<void> {
	const folder = await resolveTargetFolder(target);
	if (!folder) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('Please open a folder first, or pick a target folder in the Explorer.'),
		);
		return;
	}

	const input = await vscode.window.showInputBox({
		title: vscode.l10n.t('New Test Data Project'),
		prompt: vscode.l10n.t('Project name'),
		placeHolder: 'sales-reporting-demo',
		validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('The name must not be empty.')),
	});
	if (!input) {
		return;
	}

	const fileName = input.trim().endsWith('.tdproject') ? input.trim() : `${input.trim()}.tdproject`;
	const fileUri = vscode.Uri.joinPath(folder, fileName);

	if (await fileExists(fileUri)) {
		void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists in this folder.', fileName));
		return;
	}

	const projectName = fileName.replace(/\.tdproject$/, '');
	const content = serializeProject(createEmptyProject(projectName));
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

	await vscode.commands.executeCommand('vscode.openWith', fileUri, ProjectEditorProvider.viewType);
}
