import * as vscode from 'vscode';

/**
 * Merkt sich je Projekt das Ergebnis des letzten Generator-Laufs — die
 * *echte* Datensatzanzahl je Tabelle (bei Kardinalitäts-Bereichen wie "1..3"
 * würfelt der Lauf, die tatsächliche Anzahl steht erst hinterher fest).
 * Gespeichert im workspaceState (geräte-/workspace-lokal, kein Teil der
 * `.tdproject`-Datei — ein Lauf-Artefakt, keine Konfiguration); angezeigt im
 * ER-Diagramm des Projekt-Editors (siehe project/diagram.ts). Das Event
 * verbindet den Lauf-Befehl (project/run.ts) mit den offenen
 * Projekt-Webviews (project/editorProvider.ts), ohne dass beide sich kennen.
 */

export interface RunResult {
	/** Zeitpunkt des Laufendes (Epoch-Millisekunden). */
	finishedAt: number;
	/** Echte Datensatzanzahl je logischer Tabellen-Identität (`schema.name`). */
	counts: Record<string, number>;
}

const STATE_KEY = 'datenschmiede.lastRunResults';

const emitter = new vscode.EventEmitter<vscode.Uri>();
/** Feuert nach jedem gespeicherten Lauf-Ergebnis mit der Projekt-URI. */
export const onDidSaveRunResult = emitter.event;

/** Speichert das Ergebnis eines erfolgreichen Laufs und benachrichtigt offene Projekt-Webviews. */
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

/** Das gespeicherte Ergebnis des letzten Laufs eines Projekts, oder `null` ohne bisherigen Lauf. */
export function getRunResult(context: vscode.ExtensionContext, projectUri: vscode.Uri): RunResult | null {
	const all = context.workspaceState.get<Record<string, RunResult>>(STATE_KEY, {});
	return all[projectUri.toString()] ?? null;
}
