import * as vscode from 'vscode';

/**
 * Remembers, per project, the result of the last generator run — the *real*
 * record count per table (with cardinality ranges such as "1..3" the run rolls
 * the dice, so the actual count is only known afterwards). Stored in the
 * workspaceState (machine/workspace-local, not part of the `.tdproject` file —
 * a run artifact, not configuration); displayed in the project editor's ER
 * diagram (see project/diagram.ts). The event connects the run command
 * (project/run.ts) with the open project webviews
 * (project/editorProvider.ts) without either knowing about the other.
 */

/** The stored outcome of one generator run. */
export interface RunResult {
	/** Time the run finished (epoch milliseconds). */
	finishedAt: number;
	/** Real record count per logical table identity (`schema.name`). */
	counts: Record<string, number>;
}

const STATE_KEY = 'datenschmiede.lastRunResults';

const emitter = new vscode.EventEmitter<vscode.Uri>();
/** Fires with the project URI after every stored run result. */
export const onDidSaveRunResult = emitter.event;

/** Stores the result of a successful run and notifies open project webviews. */
export async function saveRunResult(
	context: vscode.ExtensionContext,
	projectUri: vscode.Uri,
	files: { table: string; records: number }[],
): Promise<void> {
	const all = { ...context.workspaceState.get<Record<string, RunResult>>(STATE_KEY, {}) };
	const counts: Record<string, number> = {};
	for (const file of files) {
		counts[file.table] = file.records;
	}
	all[projectUri.toString()] = { finishedAt: Date.now(), counts };
	await context.workspaceState.update(STATE_KEY, all);
	emitter.fire(projectUri);
}

/** The stored result of a project's last run, or `null` if it has never run. */
export function getRunResult(context: vscode.ExtensionContext, projectUri: vscode.Uri): RunResult | null {
	const all = context.workspaceState.get<Record<string, RunResult>>(STATE_KEY, {});
	return all[projectUri.toString()] ?? null;
}
