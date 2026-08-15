import * as vscode from 'vscode';
import { createEmptyProject } from '../model';
import { serializeProject } from '../toml';
import { ProjectEditorProvider } from '../editorProvider';
import { fileExists, resolveTargetFolder, validateNewFileName, writeNewFile } from '../../util';

/**
 * "New Test Data Project…" command: creates a new .tdproject file containing an
 * empty skeleton and opens it straight away in the custom editor. Analogous to
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
		validateInput: validateNewFileName,
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
	if (!(await writeNewFile(fileUri, content))) {
		return;
	}

	await vscode.commands.executeCommand('vscode.openWith', fileUri, ProjectEditorProvider.viewType);
}
