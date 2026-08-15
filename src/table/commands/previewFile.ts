import * as vscode from 'vscode';
import { parseTableText } from '../toml';
import { runTablePreview } from '../preview';
import { isCustomFormat } from '../../filegen/model';

/**
 * "Preview File" command (play button in the table editor's title bar, mirroring
 * the run button of the project editor).
 *
 * Generates 20 records with the table's current configuration and opens the
 * resulting file in a new **untitled** editor — the real thing the run would
 * write, for every file type, so it can be read, searched and copied with the
 * normal editor instead of a dialog. Nothing is written to disk.
 */
export async function previewFileCommand(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
	const uri = resource ?? activeTableUri();
	if (!uri) {
		void vscode.window.showErrorMessage(vscode.l10n.t('Open a table definition (.td) first.'));
		return;
	}

	const document = await vscode.workspace.openTextDocument(uri);
	let format: string;
	try {
		format = (parseTableText(document.getText()).output.format || 'csv').trim().toLowerCase();
	} catch {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('This .td file contains invalid TOML — fix it before generating a preview.'),
		);
		return;
	}

	if (format === 'temp') {
		// A temporary table writes no file, so there is nothing to preview.
		void vscode.window.showInformationMessage(
			vscode.l10n.t('This table is temporary — it generates records but writes no file.'),
		);
		return;
	}

	const result = await runTablePreview(context, document);
	if (!result) {
		// runTablePreview already reported the problem.
		return;
	}
	if (typeof result.text !== 'string') {
		// Binary formats (Excel, a file generator returning bytes) have nothing
		// readable to put in a text editor.
		void vscode.window.showInformationMessage(
			vscode.l10n.t('"{0}" writes a binary file, which cannot be shown as text.', format.toUpperCase()),
		);
		return;
	}

	const preview = await vscode.workspace.openTextDocument({
		content: result.text,
		language: previewLanguage(format),
	});
	await vscode.window.showTextDocument(preview, { preview: false });
}

/** URI of the `.td` file in the active table editor, or `undefined`. */
function activeTableUri(): vscode.Uri | undefined {
	const active = vscode.window.activeTextEditor?.document.uri;
	if (active?.path.endsWith('.td')) {
		return active;
	}
	// A custom editor is not an active *text* editor — fall back to the tab.
	const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (tab && typeof tab === 'object' && 'uri' in tab) {
		const uri = (tab as { uri: vscode.Uri }).uri;
		if (uri.path.endsWith('.td')) {
			return uri;
		}
	}
	return undefined;
}

/**
 * Language mode of the preview editor, so the result gets syntax highlighting.
 * CSV and fixed length have no built-in language in VS Code — plain text keeps
 * them readable without pulling in an extension.
 */
function previewLanguage(format: string): string {
	if (isCustomFormat(format)) {
		// A file generator declares its extension, not a language — plain text
		// is the safe default for whatever it writes.
		return 'plaintext';
	}
	switch (format) {
		case 'json':
			return 'json';
		case 'xml':
			return 'xml';
		default:
			return 'plaintext';
	}
}
