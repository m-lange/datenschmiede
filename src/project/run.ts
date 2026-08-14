import * as vscode from 'vscode';
import { Project } from './model';
import { parseProjectText } from './toml';
import { resolveLinkedInterpreter } from './python';
import { parseCardinality } from '../table/cardinality';
import { Table } from '../table/model';
import { TableEntry, generatorsById, listTables, readFileText, tableLabel } from '../table/repository';
import { GeneratorConfig } from '../generator/types';
import { GeneratorBase } from '../generator/base';
import { listGenerators, toGeneratorList } from '../generator/repository';
import { CustomGenerator } from '../generator/custom';
import { listLookups } from '../lookup/repository';
import { runPlanProcess, toPlanOutput, writePlanFile } from './planRunner';
import { getOutputChannel, log, showErrorWithDetails } from '../outputChannel';

/**
 * Befehl "Testdaten generieren" (Run-Knopf in der Editor-Titelleiste des
 * Projekt-Editors bzw. Start-Knopf im Übersicht-Tab der Webview).
 *
 * Baut aus dem Projekt (.tdproject), seinen Tabellen (.td), den
 * Nachschlagelisten (.lkp) und den benutzerdefinierten Generatoren (.tdgen)
 * einen Plan (JSON) und übergibt ihn dem Python-Läufer
 * (python/generate.py) mit dem verknüpften Interpreter. Der Läufer bestimmt
 * zuerst die Generier-Reihenfolge (Tabellen topologisch, darin Spalte für
 * Spalte) und erzeugt dann die Daten vektorisiert mit pandas/numpy; sein
 * Fortschritt (JSON-Zeilen auf stdout) wird als VS-Code-Fortschritt
 * angezeigt. Ausgabe landet im Ordner `output/` neben der Projektdatei.
 */
export async function runGenerationCommand(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
	const uri = resource ?? activeProjectUri();
	if (!uri) {
		void vscode.window.showErrorMessage(vscode.l10n.t('Open a test data project (.tdproject) first.'));
		return;
	}

	let project: Project;
	try {
		project = parseProjectText(await readFileText(uri));
	} catch {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('This project file contains invalid TOML and cannot be updated. Fix it as text first.'),
		);
		return;
	}

	if (project.tables.length === 0) {
		void vscode.window.showErrorMessage(vscode.l10n.t('This project has no tables selected yet.'));
		return;
	}

	// Verknüpften Interpreter auflösen (Python 3.10+, siehe project/python.ts).
	if (!project.python) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('This test data project has no linked Python interpreter yet. Select one now?'),
		);
		return;
	}
	const pythonStatus = await resolveLinkedInterpreter(project.python);
	if (!pythonStatus.resolved || !pythonStatus.ok) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('The linked Python interpreter is not usable (missing or older than 3.10): {0}', pythonStatus.path),
		);
		return;
	}

	const [entries, generatorEntries, lookupEntries] = await Promise.all([listTables(), listGenerators(), listLookups()]);
	const generators = toGeneratorList(generatorEntries);

	const plan = buildPlan(uri, project, entries, generators, lookupEntries);
	if ('errors' in plan) {
		void vscode.window.showErrorMessage(
			vscode.l10n.t('Cannot generate test data: {0}', plan.errors[0]) +
				(plan.errors.length > 1 ? ` (+${plan.errors.length - 1})` : ''),
		);
		return;
	}

	// Plan als JSON in den globalen Extension-Speicher schreiben (kein Teil
	// des Workspace) und den Python-Läufer damit starten.
	const planUri = await writePlanFile(context, plan.plan, 'plan');

	const projectName = project.name.trim() || vscode.workspace.asRelativePath(uri, false);
	const channel = getOutputChannel();
	// Lauf-Protokoll sichtbar machen (ohne den Fokus zu stehlen) und mit
	// einer Plan-Zusammenfassung beginnen — der Fortschritt (Tabellen und
	// Spalten) wird darunter live mitgeschrieben.
	channel.show(true);
	log(`Run "${projectName}" — ${pythonStatus.path}`);
	for (const table of plan.plan.tables) {
		channel.appendLine(
			`    ${table.label}: ${
				typeof table.records === 'number' ? `${table.records} records` : `${table.records.min}..${table.records.max} per ${table.driving_fk?.table ?? '?'}`
			}`,
		);
	}
	const startedAt = Date.now();

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Generating test data — {0}', projectName),
			cancellable: true,
		},
		async (progress, token) => {
			let doneFiles: { table: string; file: string; records: number }[] | null = null;
			/** Vom Läufer aufgelöster Ausgabeordner (Variablen ersetzt), aus dem done-Event. */
			let doneOutputDir = '';

			// Prozess-Start, Protokoll-Parsing und die gemeinsame `log`-/
			// `error`-Behandlung liegen im geteilten Läufer (planRunner.ts) —
			// hier nur die lauf-spezifischen Events (Fortschritt + Ergebnis).
			const result = await runPlanProcess({
				pythonPath: pythonStatus.path,
				context,
				planUri,
				cwd: vscode.Uri.joinPath(uri, '..').fsPath,
				token,
				onCancel: () => log(`Run "${projectName}" cancelled.`),
				errorMessage: (message) => vscode.l10n.t('Test data generation failed: {0}', message),
				onEvent: (event) => {
					switch (event.event) {
						case 'table_start': {
							progress.report({ message: String(event.table ?? '') });
							const total = Number(event.total) || plan.plan.tables.length;
							log(`Table ${String(event.table ?? '')} (${Number(event.index) + 1}/${total}) …`);
							break;
						}
						case 'column_done': {
							// Spalte-für-Spalte-Fortschritt im Protokoll (ohne Zeitstempel-Präfix).
							channel.appendLine(`    ✓ ${String(event.column ?? '')} (${Number(event.records)} values)`);
							break;
						}
						case 'table_done': {
							const total = Number(event.total) || plan.plan.tables.length;
							progress.report({
								increment: 100 / total,
								message: `${String(event.table ?? '')} (${Number(event.index) + 1}/${total})`,
							});
							log(`  ${String(event.table ?? '')}: ${Number(event.records)} records -> ${String(event.file ?? '')}`);
							break;
						}
						case 'done': {
							doneFiles = Array.isArray(event.files) ? (event.files as typeof doneFiles) : [];
							doneOutputDir = typeof event.output_dir === 'string' ? event.output_dir : '';
							break;
						}
					}
				},
			});

			if (result.cancelled) {
				return;
			}
			if (doneFiles) {
				const files: { table: string; file: string; records: number }[] = doneFiles;
				const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
				log(`Run "${projectName}" finished in ${seconds}s: ${files.length} file(s) in ${doneOutputDir || plan.plan.project_dir}`);
				const openLabel = vscode.l10n.t('Open Output Folder');
				void vscode.window
					.showInformationMessage(
						vscode.l10n.t(
							'Test data generated: {0} file(s) in "{1}".',
							files.length,
							doneOutputDir || plan.plan.project_dir,
						),
						openLabel,
					)
					.then((choice) => {
						if (choice === openLabel && files.length > 0) {
							void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(files[0].file));
						}
					});
			} else if (!result.reportedError) {
				log(`ERROR: run exited with code ${String(result.code)} without a result.`);
				void showErrorWithDetails(
					vscode.l10n.t(
						'Test data generation failed (exit code {0}). {1}',
						String(result.code),
						result.stderrText.slice(-400),
					),
				);
			}
		},
	);
}

/** Projekt-URI des aktiven Editor-Tabs, falls dort gerade ein .tdproject offen ist (Aufruf über die Command Palette). */
function activeProjectUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputCustom && input.uri.path.endsWith('.tdproject')) {
		return input.uri;
	}
	if (input instanceof vscode.TabInputText && input.uri.path.endsWith('.tdproject')) {
		return input.uri;
	}
	return undefined;
}

export interface PlanColumn {
	name: string;
	type: string;
	pk: boolean;
	fk: boolean;
	fk_table: string;
	fk_column: string;
	generator: (GeneratorConfig & { table_refs: string[]; own_column_refs: string[] }) | null;
}

export interface PlanTable {
	path: string;
	schema: string;
	name: string;
	label: string;
	records: number | { min: number; max: number };
	driving_fk: { table: string; column: string } | null;
	driving_fk_column: string | null;
	columns: PlanColumn[];
	output: {
		file_name: string;
		format: string;
		csv: {
			delimiter: string;
			quote_all: boolean;
			decimal: string;
			date_format: string;
			datetime_format: string;
			include_header: boolean;
			encoding: string;
		};
	};
}

export interface Plan {
	/** Ordner der Projekt- bzw. Tabellendatei — Bezugspunkt für den (relativen) Ausgabeordner. */
	project_dir: string;
	/** Ausgabeordner-Vorlage mit `{…}`-Variablen (leer -> `output`), aufgelöst in python/generate.py. */
	output_path: string;
	/** Projektname für die `{project}`-Variable. */
	project_name: string;
	tables: PlanTable[];
	lookups: { name: string; columns: string[]; rows: { values: string[]; weight: string }[] }[];
	custom_generators: {
		name: string;
		parameters: { name: string; type: string }[];
		generate: string;
		parse_params: string;
		display_value: string;
		validate: string;
	}[];
	/** Vorschau-Modus (siehe table/preview.ts): nichts schreiben, stattdessen die Zeilen dieser Tabelle zurückmelden. */
	preview?: { table: string; limit: number };
}

/**
 * Baut die Plan-Spalten einer Tabelle inkl. der aufgelösten Generator-
 * Referenzen (table_refs/own_column_refs, für die Generier-Reihenfolge in
 * python/generate.py). Nicht auflösbare Generatoren landen als Meldung in
 * `errors`; verwendete benutzerdefinierte Generatoren werden in
 * `usedCustomGenerators` gesammelt. Gemeinsame Grundlage für den vollen
 * Lauf (buildPlan) und die Tabellen-Vorschau (table/preview.ts).
 */
export function buildPlanColumns(
	table: Table,
	label: string,
	generators: GeneratorBase[],
	errors: string[],
	usedCustomGenerators: Map<string, CustomGenerator>,
): PlanColumn[] {
	const ownColumns = table.columns.map((c) => c.name.trim()).filter((c) => c.length > 0);
	const byId = generatorsById(generators);
	return table.columns.map((column): PlanColumn => {
		let generator: PlanColumn['generator'] = null;
		const config = column.generator;
		if (config?.id.trim()) {
			const resolved = byId.get(config.id);
			if (!resolved) {
				errors.push(vscode.l10n.t('Column "{0}.{1}": generator "{2}" was not found.', label, column.name, config.id));
			} else {
				if (resolved instanceof CustomGenerator) {
					usedCustomGenerators.set(resolved.name, resolved);
				}
				const refs = resolved.requiredRefs(config, {
					ownColumnName: column.name.trim(),
					ownColumns,
					fkTable: column.fkTable,
					fkColumn: column.fkColumn,
					tables: [],
					lookups: [],
				});
				generator = { ...config, table_refs: refs.tables, own_column_refs: refs.ownColumns };
			}
		}
		return {
			name: column.name,
			type: column.type,
			pk: column.pk,
			fk: column.fk,
			fk_table: column.fkTable.trim(),
			fk_column: column.fkColumn.trim(),
			generator,
		};
	});
}

/** Verdichtet die verwendeten benutzerdefinierten Generatoren zum Plan-Format. */
export function toPlanCustomGenerators(usedCustomGenerators: Map<string, CustomGenerator>): Plan['custom_generators'] {
	return [...usedCustomGenerators.values()].map((generator) => ({
		name: generator.name,
		parameters: generator.file.parameters.map((p) => ({ name: p.name, type: p.type })),
		generate: generator.file.code.generate,
		parse_params: generator.file.code.parseParams,
		display_value: generator.file.code.displayValue,
		validate: generator.file.code.validate,
	}));
}

/** Alle lesbaren Nachschlagelisten im Plan-Format — auch Custom-Code kann per ctx.lookup(...) beliebige Listen ansprechen. */
export function toPlanLookups(lookupEntries: Awaited<ReturnType<typeof listLookups>>): Plan['lookups'] {
	return lookupEntries
		.filter((entry) => entry.lookup)
		.map((entry) => ({
			name: entry.name,
			columns: entry.lookup?.columns ?? [],
			rows: (entry.lookup?.rows ?? []).map((row) => ({ values: row.values, weight: row.weight })),
		}));
}

/**
 * Baut den Plan für python/generate.py — oder eine Fehlerliste, wenn das
 * Projekt (noch) nicht lauffähig ist (fehlende Dateien, fehlende/ungültige
 * Datensatzanzahl, nicht auflösbare Generatoren). Die Fehler entsprechen den
 * Diagnostics der Editoren; hier werden sie nur für die Lauf-Meldung knapp
 * zusammengefasst.
 */
function buildPlan(
	projectUri: vscode.Uri,
	project: Project,
	entries: TableEntry[],
	generators: GeneratorBase[],
	lookupEntries: Awaited<ReturnType<typeof listLookups>>,
): { plan: Plan } | { errors: string[] } {
	const errors: string[] = [];
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));
	const selectedLabels = new Set<string>();
	for (const projectTable of project.tables) {
		const entry = byPath.get(projectTable.path);
		if (entry?.table) {
			selectedLabels.add(tableLabel(entry.table, entry.relativePath));
		}
	}

	const usedCustomGenerators = new Map<string, CustomGenerator>();
	const tables: PlanTable[] = [];

	for (const projectTable of project.tables) {
		const entry = byPath.get(projectTable.path);
		if (!entry?.table) {
			errors.push(vscode.l10n.t('"{0}" was not found.', projectTable.path));
			continue;
		}
		const table = entry.table;
		const label = tableLabel(table, entry.relativePath);

		// Treibende FK-Spalte: die erste FK-Spalte mit gültigem Ziel — sie
		// bestimmt zusammen mit der Kardinalität die Zeilenanzahl (siehe
		// python/generate.py#run_table).
		const driving = table.columns.find(
			(column) =>
				column.fk &&
				column.fkTable.trim() !== '' &&
				column.fkTable.trim() !== label &&
				selectedLabels.has(column.fkTable.trim()),
		);

		const rawRecords = (projectTable.records ?? '').trim();
		let records: number | { min: number; max: number };
		if (driving) {
			const cardinality = parseCardinality(rawRecords);
			if (!cardinality) {
				errors.push(vscode.l10n.t('Table "{0}": invalid number of related records (use e.g. "5" or "1..3").', label));
				continue;
			}
			records = cardinality;
		} else {
			if (!/^\d+$/.test(rawRecords)) {
				errors.push(vscode.l10n.t('Table "{0}": invalid number of records (use e.g. "100").', label));
				continue;
			}
			records = Number(rawRecords);
		}

		const columns = buildPlanColumns(table, label, generators, errors, usedCustomGenerators);

		tables.push({
			path: entry.relativePath,
			schema: table.schema.trim(),
			name: table.name.trim() || entry.relativePath,
			label,
			records,
			driving_fk: driving ? { table: driving.fkTable.trim(), column: driving.fkColumn.trim() } : null,
			driving_fk_column: driving ? driving.name : null,
			columns,
			output: toPlanOutput(table),
		});
	}

	if (errors.length > 0) {
		return { errors };
	}

	return {
		plan: {
			project_dir: vscode.Uri.joinPath(projectUri, '..').fsPath,
			output_path: project.outputPath,
			project_name: project.name.trim(),
			tables,
			lookups: toPlanLookups(lookupEntries),
			custom_generators: toPlanCustomGenerators(usedCustomGenerators),
		},
	};
}
