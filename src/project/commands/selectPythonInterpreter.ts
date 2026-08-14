import * as vscode from 'vscode';
import { pickPythonInterpreter } from '../python';
import { parseProjectText, serializeProject } from '../toml';
import { ProjectEditorProvider } from '../editorProvider';
import { fullDocumentRange } from '../../util';

/**
 * "Select Python Interpreter…" command: the same as the "Change…" button on the
 * project webview's overview tab (see project/editorProvider.ts), but also
 * reachable directly from the Command Palette. It acts on the currently focused
 * `.tdproject` tab (see `activeProjectDocument`) — without an open project
 * there is nothing to link.
 */
export async function selectPythonInterpreterCommand(): Promise<void> {
	const document = activeProjectDocument();
	if (!document) {
		void vscode.window.showErrorMessage(vscode.l10n.t('Open a test data project (.tdproject) first.'));
		return;
	}

	const link = await pickPythonInterpreter();
	if (!link) {
		return;
	}

	let project;
	try {
		project = parseProjectText(document.getText());
	} catch {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('This project file contains invalid TOML and cannot be updated. Fix it as text first.'),
		);
		return;
	}

	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, fullDocumentRange(document), serializeProject({ ...project, python: link }));
	await vscode.workspace.applyEdit(edit);
}

/**
 * The `.tdproject` text document of the currently focused editor tab, if any —
 * obtained through the native tab API rather than our own "active project"
 * tracking, since the project editor itself no longer has a sidebar view that
 * would need it.
 */
function activeProjectDocument(): vscode.TextDocument | undefined {
	const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
	const input = activeTab?.input;
	if (!(input instanceof vscode.TabInputCustom) || input.viewType !== ProjectEditorProvider.viewType) {
		return undefined;
	}
	return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === input.uri.toString());
}
