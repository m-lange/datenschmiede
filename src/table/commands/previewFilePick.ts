import * as vscode from 'vscode';
import { previewFileCommand } from './previewFile';
import { tableLabel } from '../repository';
import { WorkspaceIndex } from '../../workspaceIndex';

/** One entry of the table quick pick — carries the `.td` file it stands for. */
interface TablePickItem extends vscode.QuickPickItem {
	uri: vscode.Uri;
}

/**
 * "Preview File (Select Table)…" command.
 *
 * The plain "Preview File" command works on the table editor that is currently
 * open, which makes it unreachable from the Command Palette while something
 * else is focused. This variant asks which `.td` of the workspace to preview
 * first and then hands over to exactly the same preview (see previewFile.ts) —
 * with a single table in the workspace it skips the question.
 *
 * The counterpart to "Generate Test Data (Select Project)…" for projects.
 */
export async function previewFilePickCommand(
	context: vscode.ExtensionContext,
	index: WorkspaceIndex,
): Promise<void> {
	// Read from the shared workspace index rather than scanning again — it
	// already holds every .td including its parsed model.
	const snapshot = await index.snapshot();
	const tables = snapshot.tables;

	if (tables.length === 0) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('No table definition (.td) was found in this workspace.'),
		);
		return;
	}

	if (tables.length === 1) {
		await previewFileCommand(context, tables[0].uri);
		return;
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
	if (!picked) {
		return;
	}

	await previewFileCommand(context, picked.uri);
}
