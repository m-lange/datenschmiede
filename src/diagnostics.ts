import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ParseError } from './tomlUtil';
import { resolveAnyInterpreter } from './project/python';
import { parseTableText, findColumnLineInfo } from './table/toml';
import { validateTable, findTableCycle, findColumnCycle, Issue } from './table/validation';
import { buildTableRefEdges, listTables, readFileText, toTableOptions } from './table/repository';
import { parseProjectText, findTableLineInfo } from './project/toml';
import { buildTableRows } from './project/editorProvider';
import { ProjectIssue, validateProjectRecords } from './project/validation';
import { parseLookupText, findLookupLineInfo } from './lookup/csv';
import { parseWeight } from './lookup/model';
import { listLookups, toLookupRefs } from './lookup/repository';
import { parseGeneratorText, findParameterLineInfo, isKnownParameterType } from './generator/toml';
import { listGenerators, toGeneratorList } from './generator/repository';
import { customGeneratorName, isCustomGeneratorId } from './generator/custom';

/** Alle Dateitypen dieser Extension, die im Hintergrund geprüft werden. */
const WATCH_PATTERN = '**/*.{td,tdproject,lkp,tdgen}';
const OUR_EXTENSIONS = ['.td', '.tdproject', '.lkp', '.tdgen'];

function isOurs(uri: vscode.Uri): boolean {
	return OUR_EXTENSIONS.some((ext) => uri.path.endsWith(ext));
}

/** Eine geprüfte Datei: Rohtext plus die (noch erweiterbare) Diagnostics-Liste, die in die Collection wandert. */
interface FileCheck {
	uri: vscode.Uri;
	text: string;
	diagnostics: vscode.Diagnostic[];
}

/**
 * Workspace-weite Hintergrund-Prüfung: validiert *alle* `.td`-, `.tdproject`-,
 * `.lkp`- und `.tdgen`-Dateien des Workspace und trägt Probleme in die
 * Problems-Ansicht ein — auch für Dateien, die in keinem Editor geöffnet
 * sind. Die früher in den vier Editor-Providern verstreute Diagnostics-Logik
 * lebt jetzt ausschließlich hier (eine Quelle, keine doppelten Meldungen);
 * die Webviews zeigen dieselben Regeln weiterhin direkt am Feld an.
 *
 * Getriggert wird die (gebündelte, debouncte) Neubewertung von
 * Datei-Änderungen auf der Festplatte (Watcher), von Eingaben in offenen
 * Editoren (onDidChangeTextDocument — gelesen wird immer der aktuelle
 * Buffer-Stand, siehe readFileText) und vom Schließen eines Editors
 * (zurück zum Festplatten-Stand).
 */
export class WorkspaceDiagnostics implements vscode.Disposable {
	public static register(_context: vscode.ExtensionContext): vscode.Disposable {
		return new WorkspaceDiagnostics();
	}

	private readonly collection = vscode.languages.createDiagnosticCollection('datenschmiede');
	private readonly disposables: vscode.Disposable[] = [];
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	/** Reentranz-Schutz: läuft bereits ein Scan, wird höchstens ein weiterer vorgemerkt. */
	private refreshing = false;
	private refreshQueued = false;

	constructor() {
		const watcher = vscode.workspace.createFileSystemWatcher(WATCH_PATTERN);
		const schedule = () => this.scheduleRefresh();
		watcher.onDidCreate(schedule);
		watcher.onDidDelete(schedule);
		watcher.onDidChange(schedule);
		this.disposables.push(watcher);
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (isOurs(e.document.uri)) {
					this.scheduleRefresh();
				}
			}),
		);
		this.disposables.push(
			vscode.workspace.onDidCloseTextDocument((doc) => {
				if (isOurs(doc.uri)) {
					this.scheduleRefresh();
				}
			}),
		);
		// Initialer Scan direkt beim Aktivieren.
		this.scheduleRefresh(0);
	}

	public dispose(): void {
		this.collection.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
	}

	/** Debounced, damit z. B. Tippen in einem offenen Editor nicht bei jedem Anschlag den ganzen Workspace neu liest. */
	private scheduleRefresh(delay = 500): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refreshAll();
		}, delay);
	}

	private async refreshAll(): Promise<void> {
		if (this.refreshing) {
			this.refreshQueued = true;
			return;
		}
		this.refreshing = true;
		try {
			const [tableEntries, generatorEntries, lookupEntries, projectUris] = await Promise.all([
				listTables(),
				listGenerators(),
				listLookups(),
				vscode.workspace.findFiles('**/*.tdproject', '**/node_modules/**'),
			]);
			const generators = toGeneratorList(generatorEntries);
			const lookups = toLookupRefs(lookupEntries);
			const tableOptions = toTableOptions(tableEntries);
			const edges = buildTableRefEdges(tableEntries, generators);

			const results: [vscode.Uri, vscode.Diagnostic[]][] = [];

			const tableChecks: FileCheck[] = [];
			for (const entry of tableEntries) {
				const text = await readFileText(entry.uri).catch(() => '');
				const diagnostics = this.checkTable(text, { tableOptions, generators, lookups, edges });
				tableChecks.push({ uri: entry.uri, text, diagnostics });
				results.push([entry.uri, diagnostics]);
			}
			const generatorChecks: FileCheck[] = [];
			for (const entry of generatorEntries) {
				const text = await readFileText(entry.uri).catch(() => '');
				const diagnostics = this.checkGenerator(text);
				generatorChecks.push({ uri: entry.uri, text, diagnostics });
				results.push([entry.uri, diagnostics]);
			}
			// Python-Prüfungen der Code-Zellen (gebündelt in einem einzigen
			// Python-Aufruf): Syntaxfehler je .tdgen plus die eigene
			// validate-Prüfung jedes Generators für jede Spalte, die ihn
			// verwendet — hängt Warnungen an die bereits gesammelten
			// Diagnostics der jeweiligen Datei an.
			await this.runPythonCodeChecks(generatorChecks, tableChecks);
			for (const entry of lookupEntries) {
				const text = await readFileText(entry.uri).catch(() => '');
				results.push([entry.uri, this.checkLookup(text)]);
			}
			for (const uri of projectUris) {
				const text = await readFileText(uri).catch(() => '');
				results.push([uri, this.checkProject(text, tableEntries)]);
			}

			// Kompletter Austausch: entfernt auch Einträge gelöschter Dateien.
			this.collection.clear();
			this.collection.set(results);
		} finally {
			this.refreshing = false;
			if (this.refreshQueued) {
				this.refreshQueued = false;
				this.scheduleRefresh(0);
			}
		}
	}

	// ------------------------------------------------------------------
	// Bausteine
	// ------------------------------------------------------------------

	/** Range einer 0-basierten Zeile im Rohtext (geklemmt auf gültige Zeilen). */
	private lineRange(lines: string[], line: number): vscode.Range {
		const index = Math.min(Math.max(0, line), Math.max(0, lines.length - 1));
		return new vscode.Range(index, 0, index, lines[index]?.length ?? 0);
	}

	private diagnostic(range: vscode.Range, message: string, code: string, warning: boolean): vscode.Diagnostic {
		const diagnostic = new vscode.Diagnostic(
			range,
			message,
			warning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
		);
		diagnostic.source = 'Datenschmiede';
		diagnostic.code = code;
		return diagnostic;
	}

	/** Syntaxfehler (kaputtes TOML/CSV) an seiner Position. */
	private parseErrorDiagnostics(err: unknown, lines: string[]): vscode.Diagnostic[] {
		if (err instanceof ParseError && err.line !== undefined && err.column !== undefined) {
			const lineIndex = Math.min(Math.max(0, err.line - 1), Math.max(0, lines.length - 1));
			const lineText = lines[lineIndex] ?? '';
			const startCol = Math.min(Math.max(0, err.column - 1), lineText.length);
			const range = new vscode.Range(lineIndex, startCol, lineIndex, lineText.length);
			return [this.diagnostic(range, err.rawMessage, 'parse-error', false)];
		}
		return [];
	}

	// ------------------------------------------------------------------
	// .td — Tabellendefinitionen
	// ------------------------------------------------------------------

	private checkTable(
		text: string,
		ctx: {
			tableOptions: ReturnType<typeof toTableOptions>;
			generators: ReturnType<typeof toGeneratorList>;
			lookups: ReturnType<typeof toLookupRefs>;
			edges: Map<string, string[]>;
		},
	): vscode.Diagnostic[] {
		const lines = text.split('\n');
		let table;
		try {
			table = parseTableText(text);
		} catch (err) {
			return this.parseErrorDiagnostics(err, lines);
		}

		const issues = validateTable(table, ctx.tableOptions, ctx.generators, ctx.lookups);
		const columnLines = findColumnLineInfo(text);
		const diagnostics = issues.map((issue) => {
			const info = columnLines[issue.columnIndex];
			const line = info ? info.nameLine ?? info.columnsLine : 0;
			return this.diagnostic(this.lineRange(lines, line), this.formatTableIssueMessage(issue), issue.kind, !!issue.warning);
		});

		// Zyklische Referenzen: über FK-/Generator-Ketten zwischen Tabellen
		// bzw. zwischen den Spalten dieser Tabelle — dann lässt sich keine
		// Generier-Reihenfolge auflösen.
		const ownLabel = `${table.schema.trim() ? `${table.schema.trim()}.` : ''}${table.name.trim()}`;
		if (table.name.trim()) {
			const cycle = findTableCycle(ownLabel, ctx.edges);
			if (cycle) {
				diagnostics.push(
					this.diagnostic(
						this.lineRange(lines, 0),
						vscode.l10n.t(
							'Circular reference between tables ({0}) — the generation order cannot be resolved.',
							cycle.join(' → '),
						),
						'cycle-tables',
						true,
					),
				);
			}
		}
		const columnCycle = findColumnCycle(table, ctx.generators);
		if (columnCycle) {
			const firstIndex = table.columns.findIndex((c) => c.name.trim() === columnCycle[0]);
			const info = firstIndex >= 0 ? columnLines[firstIndex] : undefined;
			diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, info ? info.nameLine ?? info.columnsLine : 0),
					vscode.l10n.t(
						'Circular reference between columns ({0}) — the generation order cannot be resolved.',
						columnCycle.join(' → '),
					),
					'cycle-columns',
					true,
				),
			);
		}

		return diagnostics;
	}

	private formatTableIssueMessage(issue: Issue): string {
		const label = issue.columnName.trim() || vscode.l10n.t('column {0}', issue.columnIndex + 1);
		switch (issue.kind) {
			case 'fk-missing-table':
				return vscode.l10n.t('Foreign key column "{0}" has no referenced table selected.', label);
			case 'fk-table-not-found':
				return vscode.l10n.t(
					'Foreign key column "{0}" references table "{1}", which was not found. It may have been deleted, renamed, or moved.',
					label,
					issue.detail ?? '',
				);
			case 'fk-self-reference':
				return vscode.l10n.t('Foreign key column "{0}" cannot reference its own table.', label);
			case 'fk-missing-column':
				return vscode.l10n.t('Foreign key column "{0}" has no referenced column selected.', label);
			case 'fk-column-not-found':
				return vscode.l10n.t(
					'Foreign key column "{0}" references column "{1}", which was not found in the referenced table. It may have been renamed or removed.',
					label,
					issue.detail ?? '',
				);
			case 'gen-missing':
				return vscode.l10n.t('Column "{0}" has no generator selected — select and configure one.', label);
			case 'gen-not-found':
				return vscode.l10n.t(
					'Column "{0}": generator "{1}" was not found. Its .tdgen file may have been deleted, or the generator was renamed.',
					label,
					issue.detail ?? '',
				);
			case 'gen-fk-only':
				return vscode.l10n.t('Column "{0}": the Foreign Key generator can only be used on foreign key columns.', label);
			case 'gen-fk-mismatch':
				return vscode.l10n.t('Column "{0}": foreign key columns always use the Foreign Key generator.', label);
			case 'gen-param-missing':
				return vscode.l10n.t('Column "{0}": generator parameter "{1}" has no value.', label, issue.paramName ?? '');
			case 'gen-param-invalid':
				return vscode.l10n.t(
					'Column "{0}": generator parameter "{1}" has an invalid value ("{2}").',
					label,
					issue.paramName ?? '',
					issue.detail ?? '',
				);
			case 'gen-table-not-found':
				return vscode.l10n.t(
					'Column "{0}": generator parameter "{1}" references table "{2}", which was not found. It may have been deleted, renamed, or moved.',
					label,
					issue.paramName ?? '',
					issue.detail ?? '',
				);
			case 'gen-column-not-found':
				return vscode.l10n.t(
					'Column "{0}": generator parameter "{1}" references column "{2}", which was not found in the referenced table.',
					label,
					issue.paramName ?? '',
					issue.detail ?? '',
				);
			case 'gen-lookup-not-found':
				return vscode.l10n.t(
					'Column "{0}": generator parameter "{1}" references lookup list "{2}", which was not found. It may have been deleted or renamed.',
					label,
					issue.paramName ?? '',
					issue.detail ?? '',
				);
			case 'gen-lookup-column-not-found':
				return vscode.l10n.t(
					'Column "{0}": generator parameter "{1}" references column "{2}", which was not found in the lookup list.',
					label,
					issue.paramName ?? '',
					issue.detail ?? '',
				);
			case 'gen-own-column-not-found':
				return vscode.l10n.t(
					'Column "{0}": parameter "{1}" references column "{2}" of this table, which does not exist (or is the column itself).',
					label,
					issue.paramName ?? '',
					issue.detail ?? '',
				);
			default:
				return issue.kind;
		}
	}

	// ------------------------------------------------------------------
	// .tdproject — Testdatenprojekte
	// ------------------------------------------------------------------

	private checkProject(text: string, tableEntries: Awaited<ReturnType<typeof listTables>>): vscode.Diagnostic[] {
		const lines = text.split('\n');
		let project;
		try {
			project = parseProjectText(text);
		} catch (err) {
			return this.parseErrorDiagnostics(err, lines);
		}

		const rows = buildTableRows(project, tableEntries);
		const issues = validateProjectRecords(rows);
		const lineInfoByPath = findTableLineInfo(text);

		return issues.map((issue) => {
			const info = lineInfoByPath.get(issue.path);
			return this.diagnostic(
				this.lineRange(lines, info ? info.pathLine : 0),
				this.formatProjectIssueMessage(issue),
				issue.kind,
				!!issue.warning,
			);
		});
	}

	private formatProjectIssueMessage(issue: ProjectIssue): string {
		switch (issue.kind) {
			case 'missing-records':
				return vscode.l10n.t('Table "{0}" has no number of records to generate.', issue.label);
			case 'invalid-records-range-separator':
				return vscode.l10n.t(
					'Table "{0}": invalid range "{1}" — write ranges with two dots, e.g. "1..3".',
					issue.label,
					issue.detail ?? '',
				);
			case 'invalid-records':
				return vscode.l10n.t(
					'Table "{0}": invalid number of records "{1}" (use e.g. "100", or "5"/"1..3" for referenced tables).',
					issue.label,
					issue.detail ?? '',
				);
			case 'table-missing':
				return vscode.l10n.t('Table file "{0}" was not found. It may have been deleted, renamed, or moved.', issue.path);
			default:
				return issue.kind;
		}
	}

	// ------------------------------------------------------------------
	// .lkp — Nachschlagelisten
	// ------------------------------------------------------------------

	private checkLookup(text: string): vscode.Diagnostic[] {
		const lines = text.split('\n');
		let lookup;
		try {
			lookup = parseLookupText(text);
		} catch (err) {
			return this.parseErrorDiagnostics(err, lines);
		}

		const info = findLookupLineInfo(text);
		const diagnostics: vscode.Diagnostic[] = [];
		lookup.rows.forEach((row, index) => {
			if (parseWeight(row.weight) !== null) {
				return;
			}
			const missing = row.weight.trim() === '';
			diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, info.rowLines[index] ?? 0),
					missing
						? vscode.l10n.t('Row {0} has no weight.', index + 1)
						: vscode.l10n.t('Row {0}: invalid weight (use e.g. "25" or "12.5").', index + 1),
					missing ? 'missing-weight' : 'invalid-weight',
					false,
				),
			);
		});
		return diagnostics;
	}

	// ------------------------------------------------------------------
	// .tdgen — Python-Syntaxprüfung der Code-Zellen
	// ------------------------------------------------------------------

	/** Einmal aufgelöster Interpreter für die Syntaxprüfung (kein Interpreter -> Prüfung entfällt still). */
	private pythonPathPromise: Promise<string | null> | undefined;

	private getPythonPath(): Promise<string | null> {
		if (!this.pythonPathPromise) {
			this.pythonPathPromise = resolveAnyInterpreter().then((status) => status?.path ?? null);
		}
		return this.pythonPathPromise;
	}

	/**
	 * Gebündelte Python-Prüfung der Code-Zellen (EIN Python-Aufruf für den
	 * ganzen Workspace):
	 *
	 * 1. **Syntax**: jeder Zellen-Rumpf jeder `.tdgen`-Datei wird kompiliert
	 *    (mit derselben Signatur-Umhüllung wie python/generate.py);
	 *    Syntaxfehler erscheinen als Warnung an der passenden Zeile.
	 * 2. **Eigene validate-Prüfung**: hat ein Generator eine `validate`-Zelle,
	 *    wird sie für JEDE Spalte ausgeführt, die den Generator verwendet
	 *    (mit deren rohen Parameterwerten) — zurückgegebene Warnungs-Texte
	 *    erscheinen an der Spalte in der `.td`-Datei. Der Code stammt aus dem
	 *    eigenen Workspace (dieselbe Vertrauensstufe wie der Generator-Lauf).
	 */
	private async runPythonCodeChecks(generatorChecks: FileCheck[], tableChecks: FileCheck[]): Promise<void> {
		interface CodeDef {
			id: number;
			generate: string;
			parse_params: string;
			display_value: string;
			validate: string;
		}
		const defs: CodeDef[] = [];
		const defOwner: FileCheck[] = [];
		const defIndexByName = new Map<string, number>();
		for (const check of generatorChecks) {
			try {
				const generator = parseGeneratorText(check.text);
				if (generator.name.trim() && !defIndexByName.has(generator.name.trim())) {
					defIndexByName.set(generator.name.trim(), defs.length);
				}
				defs.push({
					id: defs.length,
					generate: generator.code.generate,
					parse_params: generator.code.parseParams,
					display_value: generator.code.displayValue,
					validate: generator.code.validate,
				});
				defOwner.push(check);
			} catch {
				// Kaputtes TOML wird bereits gemeldet.
			}
		}
		if (defs.length === 0) {
			return;
		}

		// Spalten einsammeln, deren benutzerdefinierter Generator eine
		// validate-Zelle hat.
		interface ValidationCheck {
			id: number;
			def_id: number;
			params: Record<string, string>;
			tableCheck: FileCheck;
			columnIndex: number;
			columnName: string;
		}
		const validationChecks: ValidationCheck[] = [];
		for (const tableCheck of tableChecks) {
			let table;
			try {
				table = parseTableText(tableCheck.text);
			} catch {
				continue;
			}
			table.columns.forEach((column, columnIndex) => {
				const id = column.generator?.id ?? '';
				if (!isCustomGeneratorId(id)) {
					return;
				}
				const defIndex = defIndexByName.get(customGeneratorName(id).trim());
				if (defIndex === undefined || !defs[defIndex].validate.trim()) {
					return;
				}
				validationChecks.push({
					id: validationChecks.length,
					def_id: defIndex,
					params: column.generator?.params ?? {},
					tableCheck,
					columnIndex,
					columnName: column.name,
				});
			});
		}

		const pythonPath = await this.getPythonPath();
		if (!pythonPath) {
			return;
		}

		const script = [
			'import sys, json',
			'data = json.load(sys.stdin)',
			'out = {"syntax": [], "validations": []}',
			'validators = {}',
			'for d in data.get("defs", []):',
			'    for cell in ("generate", "parse_params", "display_value", "validate"):',
			'        body = d.get(cell) or ""',
			'        if not body.strip():',
			'            continue',
			'        src = "def _f(params, n=None, ctx=None):\\n" + "\\n".join("    " + l for l in body.split("\\n")) + "\\n"',
			'        try:',
			'            code = compile(src, cell, "exec")',
			'        except SyntaxError as e:',
			'            out["syntax"].append({"id": d["id"], "cell": cell, "line": (e.lineno or 2) - 1, "message": e.msg or "syntax error"})',
			'            continue',
			'        if cell == "validate":',
			'            ns = {}',
			'            try:',
			'                exec(code, ns)',
			'                validators[d["id"]] = ns["_f"]',
			'            except Exception:',
			'                pass',
			'for c in data.get("checks", []):',
			'    fn = validators.get(c.get("def_id"))',
			'    if fn is None:',
			'        continue',
			'    try:',
			'        raw = fn(dict(c.get("params") or {}))',
			'        messages = [str(m).strip() for m in (raw or []) if str(m).strip()]',
			'    except Exception as e:',
			'        messages = [f"validate raised {type(e).__name__}: {e}"]',
			'    if messages:',
			'        out["validations"].append({"id": c["id"], "messages": messages})',
			'print(json.dumps(out))',
		].join('\n');

		interface CheckResult {
			syntax: { id: number; cell: string; line: number; message: string }[];
			validations: { id: number; messages: string[] }[];
		}
		const findings = await new Promise<CheckResult>((resolve) => {
			const empty: CheckResult = { syntax: [], validations: [] };
			const child = spawn(pythonPath, ['-c', script]);
			let stdout = '';
			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString('utf8');
			});
			child.on('error', () => resolve(empty));
			child.on('close', () => {
				try {
					const result = JSON.parse(stdout.trim());
					resolve({
						syntax: Array.isArray(result.syntax) ? result.syntax : [],
						validations: Array.isArray(result.validations) ? result.validations : [],
					});
				} catch {
					resolve(empty);
				}
			});
			child.stdin.write(
				JSON.stringify({
					defs,
					checks: validationChecks.map(({ id, def_id, params }) => ({ id, def_id, params })),
				}),
			);
			child.stdin.end();
		});

		for (const finding of findings.syntax) {
			const target = defOwner[finding.id];
			if (!target) {
				continue;
			}
			const lines = target.text.split('\n');
			// Zeile des `<zelle> = """`-Schlüssels; der Rumpf beginnt in der
			// Zeile darunter (mehrzeiliger TOML-String, siehe serializeGenerator).
			const keyLine = lines.findIndex((line) => new RegExp(`^\\s*${finding.cell}\\s*=`).test(line));
			const bodyLine = keyLine >= 0 ? keyLine + Math.max(1, finding.line) : 0;
			target.diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, bodyLine),
					vscode.l10n.t('Python syntax error in "{0}": {1}', finding.cell, finding.message),
					'gen-file-python-syntax',
					true,
				),
			);
		}

		for (const validation of findings.validations) {
			const target = validationChecks[validation.id];
			if (!target) {
				continue;
			}
			const lines = target.tableCheck.text.split('\n');
			const columnLines = findColumnLineInfo(target.tableCheck.text);
			const info = columnLines[target.columnIndex];
			const line = info ? info.nameLine ?? info.columnsLine : 0;
			const label = target.columnName.trim() || vscode.l10n.t('column {0}', target.columnIndex + 1);
			for (const message of validation.messages) {
				target.tableCheck.diagnostics.push(
					this.diagnostic(
						this.lineRange(lines, line),
						vscode.l10n.t('Column "{0}": {1}', label, message),
						'gen-custom-validate',
						true,
					),
				);
			}
		}
	}

	// ------------------------------------------------------------------
	// .tdgen — benutzerdefinierte Generatoren
	// ------------------------------------------------------------------

	private checkGenerator(text: string): vscode.Diagnostic[] {
		const lines = text.split('\n');
		let generator;
		try {
			generator = parseGeneratorText(text);
		} catch (err) {
			return this.parseErrorDiagnostics(err, lines);
		}

		const diagnostics: vscode.Diagnostic[] = [];

		if (!generator.name.trim()) {
			// Ohne Name ist der Generator nicht referenzierbar (siehe generator/custom.ts).
			diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, 0),
					vscode.l10n.t('This generator has no name — it cannot be selected in the table editor without one.'),
					'gen-file-missing-name',
					false,
				),
			);
		}

		const parameterLines = findParameterLineInfo(text);
		const seen = new Set<string>();
		generator.parameters.forEach((parameter, index) => {
			const info = parameterLines[index];
			const range = this.lineRange(lines, info ? info.nameLine ?? info.parametersLine : 0);
			const name = parameter.name.trim();
			const label = name || vscode.l10n.t('parameter {0}', index + 1);
			if (!name) {
				diagnostics.push(
					this.diagnostic(range, vscode.l10n.t('Parameter {0} has no name.', index + 1), 'gen-file-param-unnamed', true),
				);
			} else if (seen.has(name)) {
				diagnostics.push(
					this.diagnostic(
						range,
						vscode.l10n.t('Parameter name "{0}" is used more than once.', name),
						'gen-file-param-duplicate',
						true,
					),
				);
			}
			seen.add(name);
			if (!isKnownParameterType(parameter.type)) {
				diagnostics.push(
					this.diagnostic(
						range,
						vscode.l10n.t('Parameter "{0}" has an unknown data type "{1}".', label, parameter.type),
						'gen-file-param-type',
						true,
					),
				);
			}
		});

		if (!generator.code.generate.trim()) {
			diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, 0),
					vscode.l10n.t('The generate method has no code — this generator will not produce any values.'),
					'gen-file-empty-generate',
					true,
				),
			);
		}

		return diagnostics;
	}
}
