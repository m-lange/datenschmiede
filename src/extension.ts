import * as vscode from 'vscode';
import { TableEditorProvider } from './table/editorProvider';
import { ProjectEditorProvider } from './project/editorProvider';
import { LookupEditorProvider } from './lookup/editorProvider';
import { GeneratorNotebook } from './generator/notebook';
import { WorkspaceDiagnostics } from './diagnostics';
import { newTableCommand } from './table/commands/newTable';
import { newProjectCommand } from './project/commands/newProject';
import { newLookupCommand } from './lookup/commands/newLookup';
import { newGeneratorCommand } from './generator/commands/newGenerator';
import { selectPythonInterpreterCommand } from './project/commands/selectPythonInterpreter';
import { runGenerationCommand } from './project/run';
import { checkPython310Available } from './project/python';
import { disposeOutputChannel } from './outputChannel';
import { WorkspaceIndex } from './workspaceIndex';

export function activate(context: vscode.ExtensionContext): void {
	// Gemeinsamer Workspace-Index (EIN Watcher-Satz, EIN Einlese-Cache) für
	// Diagnostics, Table Editor und Projekt-Editor — siehe workspaceIndex.ts.
	const index = new WorkspaceIndex();
	context.subscriptions.push(index);

	context.subscriptions.push(TableEditorProvider.register(context, index));
	context.subscriptions.push(ProjectEditorProvider.register(context, index));
	context.subscriptions.push(LookupEditorProvider.register(context));
	context.subscriptions.push(GeneratorNotebook.register(context));
	// Workspace-weite Hintergrund-Prüfung aller Dateien (auch nicht geöffneter).
	context.subscriptions.push(WorkspaceDiagnostics.register(context, index));
	// Output-Channel „Datenschmiede“ (Lauf-Protokolle, Python-Tracebacks).
	context.subscriptions.push({ dispose: disposeOutputChannel });

	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newTable', newTableCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newProject', newProjectCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newLookup', newLookupCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newGenerator', newGeneratorCommand));
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.selectPythonInterpreter', selectPythonInterpreterCommand),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.runGeneration', (resource?: vscode.Uri) =>
			runGenerationCommand(context, resource),
		),
	);

	// Best-effort, im Hintergrund — siehe project/python.ts#checkPython310Available.
	void checkPython310Available();
}

export function deactivate(): void {}
