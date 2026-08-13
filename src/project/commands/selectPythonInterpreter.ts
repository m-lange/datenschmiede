import * as vscode from 'vscode';
import { pickPythonInterpreter } from '../python';
import { parseProjectText, serializeProject } from '../toml';
import { ProjectEditorProvider } from '../editorProvider';
import { fullDocumentRange } from '../../util';

/**
 * Befehl "Python-Interpreter auswählen…": dasselbe wie der "Ändern…"-Knopf im
 * Übersicht-Tab der Projekt-Webview (siehe project/editorProvider.ts), aber
 * auch direkt über die Command Palette erreichbar. Wirkt auf den gerade
 * fokussierten `.tdproject`-Tab (siehe `activeProjectDocument`) — ohne
 * offenes Projekt gibt es nichts zu verknüpfen.
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
 * Das `.tdproject`-Textdokument des gerade fokussierten Editor-Tabs, falls
 * vorhanden — über die native Tab-API statt einer eigenen "aktives Projekt"-
 * Verfolgung, da der Projekt-Editor selbst keine Seitenleisten-Ansicht mehr
 * hat, die das bräuchte.
 */
function activeProjectDocument(): vscode.TextDocument | undefined {
	const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
	const input = activeTab?.input;
	if (!(input instanceof vscode.TabInputCustom) || input.viewType !== ProjectEditorProvider.viewType) {
		return undefined;
	}
	return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === input.uri.toString());
}
