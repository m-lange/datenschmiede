import * as vscode from 'vscode';
import { runGenerationCommand } from '../run';
import { WorkspaceIndex } from '../../workspaceIndex';

/** One entry of the project quick pick — carries the project file it stands for. */
interface ProjectPickItem extends vscode.QuickPickItem {
	uri: vscode.Uri;
}

/**
 * "Generate Test Data (Select Project)…" command.
 *
 * The plain "Generate Test Data" command works on the project of the active
 * editor tab (or an Explorer selection), which makes it useless from the
 * Command Palette while something else is focused. This variant asks which
 * `.tdproject` of the workspace to run first and then hands over to exactly the
 * same generation as the run button (see project/run.ts) — with a single
 * project in the workspace it skips the question and starts right away.
 */
export async function generateWithProjectPickCommand(
	context: vscode.ExtensionContext,
	index: WorkspaceIndex,
): Promise<void> {
	// Read from the shared workspace index rather than scanning again — it
	// already holds every .tdproject including its parsed name.
	const snapshot = await index.snapshot();
	const projects = snapshot.projects;

	if (projects.length === 0) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('No test data project (.tdproject) was found in this workspace.'),
		);
		return;
	}

	if (projects.length === 1) {
		await runGenerationCommand(context, projects[0].uri);
		return;
	}

	const items: ProjectPickItem[] = projects.map((entry) => ({
		// A broken or unnamed project file still needs to be pickable — its
		// path is the fallback label, and running it reports the real problem.
		label: entry.project?.name.trim() || entry.relativePath,
		description: entry.relativePath,
		detail: entry.error ? vscode.l10n.t('This project file contains invalid TOML.') : undefined,
		uri: entry.uri,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Generate Test Data'),
		placeHolder: vscode.l10n.t('Select the test data project to generate'),
		matchOnDescription: true,
	});
	if (!picked) {
		return;
	}

	await runGenerationCommand(context, picked.uri);
}
