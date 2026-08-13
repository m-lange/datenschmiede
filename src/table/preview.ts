import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { parseTableText } from './toml';
import { computeRequiredClosure, listTables, tableLabel } from './repository';
import { listGenerators, toGeneratorList } from '../generator/repository';
import { listLookups } from '../lookup/repository';
import { CustomGenerator } from '../generator/custom';
import { resolveAnyInterpreter } from '../project/python';
import { Plan, PlanTable, buildPlanColumns, toPlanCustomGenerators, toPlanLookups } from '../project/run';

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
			output: {
				file_name: table.output.fileName,
				format: table.output.format || 'csv',
				csv: {
					delimiter: table.output.csv.delimiter,
					quote_all: table.output.csv.quoteAll,
					decimal: table.output.csv.decimal,
					date_format: table.output.csv.dateFormat,
					datetime_format: table.output.csv.datetimeFormat,
					include_header: table.output.csv.includeHeader,
					encoding: table.output.csv.encoding,
				},
			},
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

	await vscode.workspace.fs.createDirectory(context.globalStorageUri);
	const planUri = vscode.Uri.joinPath(context.globalStorageUri, `preview-${Date.now()}.json`);
	await vscode.workspace.fs.writeFile(planUri, Buffer.from(JSON.stringify(plan), 'utf8'));
	const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'python', 'generate.py').fsPath;

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Generating preview…') },
		() =>
			new Promise<PreviewResult | null>((resolve) => {
				const child = spawn(interpreter.path, [scriptPath, planUri.fsPath], {
					cwd: vscode.Uri.joinPath(document.uri, '..').fsPath,
				});

				let stdoutRest = '';
				let stderrText = '';
				let result: PreviewResult | null = null;
				let reportedError = false;

				const handleEvent = (line: string) => {
					const trimmed = line.trim();
					if (!trimmed) {
						return;
					}
					let event: Record<string, unknown>;
					try {
						event = JSON.parse(trimmed);
					} catch {
						return;
					}
					if (event.event === 'preview') {
						result = {
							columns: Array.isArray(event.columns) ? (event.columns as string[]) : [],
							rows: Array.isArray(event.rows) ? (event.rows as string[][]) : [],
						};
					} else if (event.event === 'error') {
						reportedError = true;
						if (event.code === 'missing-packages') {
							const packages = Array.isArray(event.packages) ? event.packages.join(' ') : 'pandas numpy';
							void vscode.window.showErrorMessage(
								vscode.l10n.t('Python packages are missing for test data generation: {0}', packages),
							);
						} else {
							void vscode.window.showErrorMessage(
								vscode.l10n.t('Preview failed: {0}', String(event.message ?? '')),
							);
						}
					}
				};

				child.stdout.on('data', (chunk: Buffer) => {
					stdoutRest += chunk.toString('utf8');
					const lines = stdoutRest.split('\n');
					stdoutRest = lines.pop() ?? '';
					for (const line of lines) {
						handleEvent(line);
					}
				});
				child.stderr.on('data', (chunk: Buffer) => {
					stderrText += chunk.toString('utf8');
				});
				child.on('error', (err) => {
					void vscode.window.showErrorMessage(vscode.l10n.t('Unable to start Python: {0}', String(err.message)));
					resolve(null);
				});
				child.on('close', (code) => {
					handleEvent(stdoutRest);
					void vscode.workspace.fs.delete(planUri).then(undefined, () => undefined);
					if (!result && !reportedError) {
						void vscode.window.showErrorMessage(
							vscode.l10n.t('Preview failed (exit code {0}). {1}', String(code), stderrText.slice(-400)),
						);
					}
					resolve(result);
				});
			}),
	);
}
