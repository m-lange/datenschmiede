import * as vscode from 'vscode';
import { parseTableText } from '../toml';
import { runTablePreview } from '../preview';
import { tableLabel } from '../repository';
import { Table, outputExtension } from '../model';
import { setPreviewContent } from '../previewDocument';
import { customFormatName, isCustomFormat } from '../../filegen/model';
import { toFileGeneratorOptions } from '../../filegen/repository';
import { WorkspaceIndex } from '../../workspaceIndex';

/**
 * "Preview File" command (play button in the table editor's title bar, mirroring
 * the run button of the project editor).
 *
 * Generates 20 records with the table's current configuration and opens the
 * resulting file in a new **untitled** editor — the real thing the run would
 * write, for every file type, so it can be read, searched and copied with the
 * normal editor instead of a dialog. Nothing is written to disk.
 *
 * Which table is meant is resolved in three steps, so the one command covers
 * both the button and the Command Palette: an explicitly passed resource (the
 * title bar hands one over), otherwise the table editor in front, otherwise the
 * user is asked — with a single `.td` in the workspace that question is skipped
 * too.
 */
export async function previewFileCommand(
	context: vscode.ExtensionContext,
	index: WorkspaceIndex,
	resource?: vscode.Uri,
): Promise<void> {
	const uri = resource ?? activeTableUri() ?? (await pickTable(index));
	if (!uri) {
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
		void vscode.window.showWarningMessage(
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
		void vscode.window.showWarningMessage(
			vscode.l10n.t('"{0}" writes a binary file, which cannot be previewed as text.', format.toUpperCase()),
		);
		return;
	}

	// A virtual, read-only document rather than an untitled one: a preview is
	// throwaway, and an untitled editor would ask whether to save it on closing
	// (see table/previewDocument.ts).
	const table = parseTableText(document.getText());
	const previewUri = setPreviewContent(await previewFileName(table, format, index), result.text);
	const preview = await vscode.workspace.openTextDocument(previewUri);
	await vscode.languages.setTextDocumentLanguage(preview, previewLanguage(format));
	await vscode.window.showTextDocument(preview, { preview: false });
}

/**
 * Name of the preview tab: the table's logical name plus the extension the run
 * would really write (`.txt` for fixed length, the declared one for a custom
 * file generator) — so the preview announces what it is a preview *of*.
 */
async function previewFileName(table: Table, format: string, index: WorkspaceIndex): Promise<string> {
	const name = (table.schema.trim() ? `${table.schema.trim()}.` : '') + (table.name.trim() || 'preview');
	let extension = outputExtension(format);
	if (isCustomFormat(format)) {
		const options = toFileGeneratorOptions((await index.snapshot()).fileGenerators);
		extension = options.find((option) => option.name === customFormatName(format))?.extension ?? '';
	}
	return `${name}.${extension || 'txt'}`;
}

/** One entry of the table quick pick — carries the `.td` file it stands for. */
interface TablePickItem extends vscode.QuickPickItem {
	uri: vscode.Uri;
}

/**
 * Asks which `.td` of the workspace to preview — used when the command is
 * invoked without a table in front (typically from the Command Palette).
 * Returns `undefined` when there is nothing to pick or the user cancelled.
 */
async function pickTable(index: WorkspaceIndex): Promise<vscode.Uri | undefined> {
	// Read from the shared workspace index rather than scanning again — it
	// already holds every .td including its parsed model.
	const tables = (await index.snapshot()).tables;
	if (tables.length === 0) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('No table definition (.td) was found in this workspace.'),
		);
		return undefined;
	}
	if (tables.length === 1) {
		return tables[0].uri;
	}

	const items: TablePickItem[] = tables.map((entry) => ({
		// A broken table still needs to be pickable — its path is the fallback
		// label, and previewing it reports the real problem.
		label: entry.table ? tableLabel(entry.table, entry.relativePath) : entry.relativePath,
		description: entry.relativePath,
		detail: entry.error
			? vscode.l10n.t('This .td file contains invalid TOML.')
			: // The file type decides what the preview produces, so it is worth
				// seeing before picking.
				vscode.l10n.t('File type: {0}', (entry.table?.output.format || 'csv').toUpperCase()),
		uri: entry.uri,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Preview File'),
		placeHolder: vscode.l10n.t('Select the table to preview'),
		matchOnDescription: true,
	});
	return picked?.uri;
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
