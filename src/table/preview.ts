import * as vscode from 'vscode';
import { parseTableText } from './toml';
import { computeRequiredClosure, listTables, tableLabel } from './repository';
import { listGenerators, toGeneratorList } from '../generator/repository';
import { listLookups } from '../lookup/repository';
import { CustomGenerator } from '../generator/custom';
import { resolveAnyInterpreter } from '../project/python';
import { Plan, PlanTable, buildPlanColumns, toPlanCustomGenerators, toPlanLookups } from '../project/run';
import { runPlanProcess, toPlanOutput, writePlanFile } from '../project/planRunner';
import { log, showErrorWithDetails } from '../outputChannel';

/** Anzahl der Datensätze einer Tabellen-Vorschau. */
const PREVIEW_LIMIT = 20;

export interface PreviewResult {
	columns: string[];
	rows: string[][];
}

/**
 * Vorschau für den Table Editor: erzeugt PREVIEW_LIMIT Datensätze der
 * geöffneten Tabelle mit der aktuellen Konfiguration — inklusive aller
 * Spalten — über denselben Python-Läufer wie der volle Generator-Lauf
 * (python/generate.py, Vorschau-Modus: nichts wird geschrieben).
 *
 * Referenzierte Tabellen (FK-/Generator-Ketten) werden mit generiert, jede
 * mit fester Anzahl PREVIEW_LIMIT statt der Projekt-Kardinalitäten — die
 * Vorschau braucht kein Projekt und keinen verknüpften Interpreter, sondern
 * nutzt die in VS Code aktive Python-Umgebung (3.10+).
 *
 * @returns Das Ergebnis, oder `null` bei Fehlern (die Meldung zeigt diese
 * Funktion selbst an).
 */
export async function runTablePreview(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
): Promise<PreviewResult | null> {
	try {
		parseTableText(document.getText());
	} catch {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('This .td file contains invalid TOML — fix it before generating a preview.'),
		);
		return null;
	}

	const interpreter = await resolveAnyInterpreter();
	if (!interpreter) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('No Python 3.10+ interpreter available for the preview. Install one, then try again.'),
		);
		return null;
	}

	const [entries, generatorEntries, lookupEntries] = await Promise.all([listTables(), listGenerators(), listLookups()]);
	const generators = toGeneratorList(generatorEntries);

	const targetPath = vscode.workspace.asRelativePath(document.uri, false);
	const target = entries.find((entry) => entry.relativePath === targetPath);
	if (!target?.table) {
		void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" was not found.', targetPath));
		return null;
	}
	const targetLabel = tableLabel(target.table, target.relativePath);

	// FK-/Generator-Hülle mit generieren, jede Tabelle mit fester Anzahl —
	// die Kardinalitäten des Projekts spielen für die Vorschau keine Rolle.
	const closure = computeRequiredClosure(new Set([targetPath]), entries, generators);
	const errors: string[] = [];
	const usedCustomGenerators = new Map<string, CustomGenerator>();
	const tables: PlanTable[] = [];
	for (const path of [targetPath, ...closure]) {
		const entry = entries.find((e) => e.relativePath === path);
		if (!entry?.table) {
			continue;
		}
		const table = entry.table;
		const label = tableLabel(table, entry.relativePath);
		tables.push({
			path: entry.relativePath,
			schema: table.schema.trim(),
			name: table.name.trim() || entry.relativePath,
			label,
			records: PREVIEW_LIMIT,
			driving_fk: null,
			driving_fk_column: null,
			columns: buildPlanColumns(table, label, generators, errors, usedCustomGenerators),
			output: toPlanOutput(table),
		});
	}

	if (errors.length > 0) {
		void vscode.window.showErrorMessage(vscode.l10n.t('Cannot generate test data: {0}', errors[0]));
		return null;
	}

	const plan: Plan = {
		project_dir: vscode.Uri.joinPath(document.uri, '..').fsPath,
		output_path: '',
		project_name: '',
		tables,
		lookups: toPlanLookups(lookupEntries),
		custom_generators: toPlanCustomGenerators(usedCustomGenerators),
		preview: { table: targetLabel, limit: PREVIEW_LIMIT },
	};

	const planUri = await writePlanFile(context, plan, 'preview');

	log(`Preview "${targetLabel}" — ${interpreter.path}`);

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Generating preview…') },
		async () => {
			let result: PreviewResult | null = null;

			// Prozess-Start, Protokoll-Parsing und die gemeinsame `log`-/
			// `error`-Behandlung liegen im geteilten Läufer (planRunner.ts).
			const run = await runPlanProcess({
				pythonPath: interpreter.path,
				context,
				planUri,
				cwd: vscode.Uri.joinPath(document.uri, '..').fsPath,
				errorMessage: (message) => vscode.l10n.t('Preview failed: {0}', message),
				onEvent: (event) => {
					if (event.event === 'preview') {
						result = {
							columns: Array.isArray(event.columns) ? (event.columns as string[]) : [],
							rows: Array.isArray(event.rows) ? (event.rows as string[][]) : [],
						};
					}
				},
			});

			if (result) {
				log(`Preview "${targetLabel}" finished: ${(result as PreviewResult).rows.length} rows.`);
			} else if (!run.reportedError) {
				log(`ERROR: preview exited with code ${String(run.code)} without a result.`);
				void showErrorWithDetails(
					vscode.l10n.t('Preview failed (exit code {0}). {1}', String(run.code), run.stderrText.slice(-400)),
				);
			}
			return result;
		},
	);
}
