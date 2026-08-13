import * as vscode from 'vscode';
import { TableEditorProvider } from './table/editorProvider';
import { ProjectEditorProvider } from './project/editorProvider';
import { LookupEditorProvider } from './lookup/editorProvider';
import { newTableCommand } from './table/commands/newTable';
import { newProjectCommand } from './project/commands/newProject';
import { newLookupCommand } from './lookup/commands/newLookup';
import { selectPythonInterpreterCommand } from './project/commands/selectPythonInterpreter';
import { checkPython310Available } from './project/python';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(TableEditorProvider.register(context));
	context.subscriptions.push(ProjectEditorProvider.register(context));
	context.subscriptions.push(LookupEditorProvider.register(context));

	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newTable', newTableCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newProject', newProjectCommand));
	context.subscriptions.push(vscode.commands.registerCommand('datenschmiede.newLookup', newLookupCommand));
	context.subscriptions.push(
		vscode.commands.registerCommand('datenschmiede.selectPythonInterpreter', selectPythonInterpreterCommand),
	);

	// Best-effort, im Hintergrund — siehe project/python.ts#checkPython310Available.
	void checkPython310Available();
}

export function deactivate(): void {}
