import * as vscode from 'vscode';
import { TableEditorProvider } from './table/editorProvider';
import { ProjectEditorProvider } from './project/editorProvider';
import { LookupEditorProvider } from './lookup/editorProvider';
import { GeneratorNotebook } from './generator/notebook';
import { FileGeneratorNotebook } from './filegen/notebook';
import { WorkspaceDiagnostics } from './diagnostics';
import { newTableCommand } from './table/commands/newTable';
import { newProjectCommand } from './project/commands/newProject';
import { newLookupCommand } from './lookup/commands/newLookup';
import { newGeneratorCommand } from './generator/commands/newGenerator';
import { newFileGeneratorCommand } from './filegen/commands/newFileGenerator';
import { selectPythonInterpreterCommand } from './project/commands/selectPythonInterpreter';
import { generateWithProjectPickCommand } from './project/commands/generateWithProjectPick';
import { runGenerationCommand } from './project/run';
import { checkPython310Available } from './project/python';
import { disposeOutputChannel } from './outputChannel';
import { WorkspaceIndex } from './workspaceIndex';

/**
 * Extension entry point: wires up the three custom editors (.td, .tdproject,
 * .lkp), the generator notebook (.tdgen), workspace-wide diagnostics and the
 * `datenschmiede.*` commands. Everything registered here is pushed onto
 * `context.subscriptions` so VS Code disposes it on deactivation.
 */
export function activate(context: vscode.ExtensionContext): void {
	// Shared workspace index (ONE set of file watchers, ONE parse cache) used by
	// diagnostics, the table editor and the project editor — see workspaceIndex.ts.
	const index = new WorkspaceIndex();
	context.subscriptions.push(index);

	context.subscriptions.push(TableEditorProvider.register(context, index));
	context.subscriptions.push(ProjectEditorProvider.register(context, index));
	context.subscriptions.push(LookupEditorProvider.register(context));
	context.subscriptions.push(GeneratorNotebook.register(context));
	context.subscriptions.push(FileGeneratorNotebook.register(context));
	// Background validation of every file in the workspace, opened or not.
	context.subscriptions.push(WorkspaceDiagnostics.register(context, index));
	// The shared "Datenschmiede" output channel (run logs, Python tracebacks).
	context.subscriptions.push({ dispose: disposeOutputChannel });

	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newTable', newTableCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newProject', newProjectCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newLookup', newLookupCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newGenerator', newGeneratorCommand));
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.newFileGenerator', newFileGeneratorCommand),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.selectPythonInterpreter', selectPythonInterpreterCommand),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.runGeneration', (resource?: vscode.Uri) =>
			runGenerationCommand(context, resource),
		),
	);
	// Command Palette variant: works without an open project editor by asking
	// which .tdproject to run first.
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.generateTestData', () =>
			generateWithProjectPickCommand(context, index),
		),
	);

	// Best-effort, fire-and-forget — see project/python.ts#checkPython310Available.
	void checkPython310Available();
}

export function deactivate(): void {}
