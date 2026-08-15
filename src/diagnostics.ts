import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ParseError } from './tomlUtil';
import { createStreamDecoder, pythonEnv } from './encoding';
import { resolveAnyInterpreter } from './project/python';
import { ColumnLineInfo, findColumnLineInfo, findOutputLine } from './table/toml';
import { validateTable, findTableCycle, findColumnCycle, Issue, OUTPUT_ISSUE_INDEX } from './table/validation';
import { TableEntry, buildTableRefEdges, toTableOptions } from './table/repository';
import { findTableLineInfo } from './project/toml';
import { buildTableRows } from './project/editorProvider';
import { ProjectIssue, validateProjectRecords } from './project/validation';
import { findLookupLineInfo } from './lookup/csv';
import { parseWeight } from './lookup/model';
import { LookupEntry, toLookupRefs } from './lookup/repository';
import { GeneratorEntry, toGeneratorList } from './generator/repository';
import { findParameterLineInfo, isKnownParameterType } from './generator/toml';
import { customGeneratorName, isCustomGeneratorId } from './generator/custom';
import { parametersFromBody } from './generator/notebookCells';
import { ProjectEntry, WorkspaceIndex } from './workspaceIndex';

/** A checked `.td` file: the index entry plus derived line info and the (still growing) diagnostics list. */
interface TableCheck {
	entry: TableEntry;
	lines: string[];
	/** Line positions of the `[[columns]]` blocks — computed once per file, shared by the basic and the Python checks. */
	columnLines: ColumnLineInfo[];
	diagnostics: vscode.Diagnostic[];
}

/** A checked `.tdgen` file — the counterpart to TableCheck. */
interface GeneratorCheck {
	entry: GeneratorEntry;
	lines: string[];
	diagnostics: vscode.Diagnostic[];
}

/** Result of the batched Python check (see runPythonCodeChecks). */
interface PythonCheckResult {
	syntax: { id: number; cell: string; line: number; message: string }[];
	validations: { id: number; messages: string[] }[];
}

/**
 * Workspace-wide background validation: validates *all* `.td`, `.tdproject`,
 * `.lkp` and `.tdgen` files of the workspace and reports problems in the
 * Problems view — including files that are not open in any editor. The
 * diagnostics logic that used to be scattered across the four editor providers
 * now lives here exclusively (one source, no duplicate messages); the webviews
 * still surface the same rules inline on the respective field.
 *
 * Nothing is read here directly: the shared workspace index
 * (src/workspaceIndex.ts) supplies raw text and parsed models for all files and
 * reports (debounced) every change — from file changes on disk through typing
 * in open editors to closing an editor.
 */
export class WorkspaceDiagnostics implements vscode.Disposable {
	public static register(_context: vscode.ExtensionContext, index: WorkspaceIndex): vscode.Disposable {
		return new WorkspaceDiagnostics(index);
	}

	private readonly collection = vscode.languages.createDiagnosticCollection('datenschmiede');
	private readonly changeSub: vscode.Disposable;
	/** Reentrancy guard: while a scan is running, at most one further scan is queued. */
	private refreshing = false;
	private refreshQueued = false;

	constructor(private readonly index: WorkspaceIndex) {
		this.changeSub = index.onDidChange(() => void this.refreshAll());
		// Initial scan right on activation.
		void this.refreshAll();
	}

	public dispose(): void {
		this.collection.dispose();
		this.changeSub.dispose();
	}

	/** Re-validates the entire workspace and replaces the diagnostic collection wholesale. */
	private async refreshAll(): Promise<void> {
		if (this.refreshing) {
			this.refreshQueued = true;
			return;
		}
		this.refreshing = true;
		try {
			const snapshot = await this.index.snapshot();
			const generators = toGeneratorList(snapshot.generators);
			const lookups = toLookupRefs(snapshot.lookups);
			const tableOptions = toTableOptions(snapshot.tables);
			const edges = buildTableRefEdges(snapshot.tables, generators);

			const tableChecks: TableCheck[] = snapshot.tables.map((entry) => ({
				entry,
				lines: entry.text.split('\n'),
				columnLines: entry.table ? findColumnLineInfo(entry.text) : [],
				diagnostics: [],
			}));
			for (const check of tableChecks) {
				this.checkTable(check, { tableOptions, generators, lookups, edges });
			}

			const generatorChecks: GeneratorCheck[] = snapshot.generators.map((entry) => ({
				entry,
				lines: entry.text.split('\n'),
				diagnostics: [],
			}));
			for (const check of generatorChecks) {
				this.checkGenerator(check);
			}

			// Python checks of the code cells (batched into a single Python
			// invocation): syntax errors per .tdgen plus each generator's own
			// validate check for every column that uses it — appends warnings to
			// the diagnostics already collected for the respective file.
			await this.runPythonCodeChecks(generatorChecks, tableChecks);

			const results: [vscode.Uri, vscode.Diagnostic[]][] = [];
			for (const check of tableChecks) {
				results.push([check.entry.uri, check.diagnostics]);
			}
			for (const check of generatorChecks) {
				results.push([check.entry.uri, check.diagnostics]);
			}
			for (const entry of snapshot.lookups) {
				results.push([entry.uri, this.checkLookup(entry)]);
			}
			for (const entry of snapshot.projects) {
				results.push([entry.uri, this.checkProject(entry, snapshot.tables)]);
			}

			// Full replacement: also drops entries for files that were deleted.
			this.collection.clear();
			this.collection.set(results);
		} finally {
			this.refreshing = false;
			if (this.refreshQueued) {
				this.refreshQueued = false;
				void this.refreshAll();
			}
		}
	}

	// ------------------------------------------------------------------
	// Building blocks
	// ------------------------------------------------------------------

	/** Range of a 0-based line in the raw text (clamped to valid lines). */
	private lineRange(lines: string[], line: number): vscode.Range {
		const index = Math.min(Math.max(0, line), Math.max(0, lines.length - 1));
		return new vscode.Range(index, 0, index, lines[index]?.length ?? 0);
	}

	/** Creates a diagnostic tagged with this extension's source and the given rule code. */
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

	/** Syntax error (broken TOML/CSV) at its position — derived from the parse error recorded in the index entry. */
	private parseErrorDiagnostics(err: ParseError, lines: string[]): vscode.Diagnostic[] {
		if (err.line !== undefined && err.column !== undefined) {
			const lineIndex = Math.min(Math.max(0, err.line - 1), Math.max(0, lines.length - 1));
			const lineText = lines[lineIndex] ?? '';
			const startCol = Math.min(Math.max(0, err.column - 1), lineText.length);
			const range = new vscode.Range(lineIndex, startCol, lineIndex, lineText.length);
			return [this.diagnostic(range, err.rawMessage, 'parse-error', false)];
		}
		return [];
	}

	// ------------------------------------------------------------------
	// .td — table definitions
	// ------------------------------------------------------------------

	/** Validates one table file and appends its diagnostics to {@link TableCheck.diagnostics}. */
	private checkTable(
		check: TableCheck,
		ctx: {
			tableOptions: ReturnType<typeof toTableOptions>;
			generators: ReturnType<typeof toGeneratorList>;
			lookups: ReturnType<typeof toLookupRefs>;
			edges: Map<string, string[]>;
		},
	): void {
		const { entry, lines, columnLines, diagnostics } = check;
		if (entry.error) {
			diagnostics.push(...this.parseErrorDiagnostics(entry.error, lines));
			return;
		}
		const table = entry.table;
		if (!table) {
			// Unreadable file — there is no meaningful position in the text to report.
			return;
		}

		const issues = validateTable(table, ctx.tableOptions, ctx.generators, ctx.lookups);
		// Only computed when an output problem actually turns up — scanning for
		// the `[output]` line is pointless for the common column-only case.
		let outputLine: number | null = null;
		for (const issue of issues) {
			let line: number;
			if (issue.columnIndex === OUTPUT_ISSUE_INDEX) {
				outputLine ??= findOutputLine(entry.text);
				line = outputLine;
			} else {
				const info = columnLines[issue.columnIndex];
				line = info ? info.nameLine ?? info.columnsLine : 0;
			}
			diagnostics.push(
				this.diagnostic(this.lineRange(lines, line), this.formatTableIssueMessage(issue), issue.kind, !!issue.warning),
			);
		}

		// Circular references: via FK/generator chains between tables, or between
		// the columns of this table — in either case no generation order can be
		// resolved.
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
	}

	/** Turns a validation {@link Issue} into the localized message shown in the Problems view. */
	private formatTableIssueMessage(issue: Issue): string {
		if (issue.columnIndex === OUTPUT_ISSUE_INDEX) {
			return this.formatOutputIssueMessage(issue);
		}
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

	/** Message of a problem in the JSON/XML target structure (schema/mapping tabs). */
	private formatOutputIssueMessage(issue: Issue): string {
		const path = issue.nodePath?.trim() || vscode.l10n.t('(unnamed)');
		switch (issue.kind) {
			case 'output-node-unnamed':
				return vscode.l10n.t('Structure node "{0}" has no name — it cannot be written without one.', path);
			case 'output-mapping-missing':
				return vscode.l10n.t('Structure node "{0}" has no column mapped to it.', path);
			case 'output-mapping-column-not-found':
				return vscode.l10n.t(
					'Structure node "{0}" is mapped to column "{1}", which does not exist in this table. It may have been renamed or removed.',
					path,
					issue.detail ?? '',
				);
			case 'output-field-width':
				return vscode.l10n.t('Fixed-length field "{0}" has no width — every field needs at least one character.', path);
			case 'output-field-column-missing':
				return vscode.l10n.t('Fixed-length field "{0}" has no column selected.', path);
			case 'output-field-column-not-found':
				return vscode.l10n.t(
					'Fixed-length field "{0}" uses column "{1}", which does not exist in this table. It may have been renamed or removed.',
					path,
					issue.detail ?? '',
				);
			default:
				return issue.kind;
		}
	}

	// ------------------------------------------------------------------
	// .tdproject — test data projects
	// ------------------------------------------------------------------

	/** Validates one project file (record counts, missing table files). */
	private checkProject(entry: ProjectEntry, tableEntries: TableEntry[]): vscode.Diagnostic[] {
		const lines = entry.text.split('\n');
		if (entry.error) {
			return this.parseErrorDiagnostics(entry.error, lines);
		}
		if (!entry.project) {
			return [];
		}

		const rows = buildTableRows(entry.project, tableEntries);
		const issues = validateProjectRecords(rows);
		const lineInfoByPath = findTableLineInfo(entry.text);

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

	/** Turns a {@link ProjectIssue} into the localized message shown in the Problems view. */
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
	// .lkp — lookup lists
	// ------------------------------------------------------------------

	/** Validates one lookup list: every row needs a parseable weight. */
	private checkLookup(entry: LookupEntry): vscode.Diagnostic[] {
		const lines = entry.text.split('\n');
		if (entry.error) {
			return this.parseErrorDiagnostics(entry.error, lines);
		}
		if (!entry.lookup) {
			return [];
		}

		const info = findLookupLineInfo(entry.text);
		const diagnostics: vscode.Diagnostic[] = [];
		entry.lookup.rows.forEach((row, index) => {
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
	// .tdgen — Python syntax check of the code cells
	// ------------------------------------------------------------------

	/**
	 * Resolved interpreter for the syntax check. A failure is deliberately NOT
	 * cached forever: as long as no interpreter has been found, every scan asks
	 * again (cheap, via the Python extension API) — so installing or selecting
	 * Python after startup enables the checks without a reload.
	 */
	private pythonPath: string | null = null;
	private resolvingPython: Promise<string | null> | null = null;

	/** Returns the interpreter path, resolving it at most once concurrently. */
	private getPythonPath(): Promise<string | null> {
		if (this.pythonPath) {
			return Promise.resolve(this.pythonPath);
		}
		if (!this.resolvingPython) {
			this.resolvingPython = resolveAnyInterpreter().then((status) => {
				this.resolvingPython = null;
				this.pythonPath = status?.path ?? null;
				return this.pythonPath;
			});
		}
		return this.resolvingPython;
	}

	/**
	 * Input (defs + checks as JSON) and result of the last successful Python
	 * run: if a scan changes neither the generator code nor the checked column
	 * parameters (the common case while typing in `.td` descriptions and the
	 * like), the previous result is reused instead of starting another Python
	 * process. Line positions are recomputed against the current text on every
	 * scan anyway.
	 */
	private lastPythonPayload = '';
	private lastPythonFindings: PythonCheckResult = { syntax: [], validations: [] };

	/**
	 * Batched Python check of the code cells (ONE Python invocation for the
	 * whole workspace):
	 *
	 * 1. **Syntax**: every cell body of every `.tdgen` file is compiled (using
	 *    the same signature wrapper as python/generate.py); syntax errors show
	 *    up as a warning on the matching line.
	 * 2. **Custom validate check**: if a generator has a `validate` cell, it is
	 *    executed for EVERY column that uses the generator (with that column's
	 *    raw parameter values) — the returned warning texts are reported on the
	 *    column in the `.td` file. The code comes from the user's own workspace
	 *    (the same trust level as an actual generator run).
	 */
	private async runPythonCodeChecks(generatorChecks: GeneratorCheck[], tableChecks: TableCheck[]): Promise<void> {
		interface CodeDef {
			id: number;
			parameters: string;
			generate: string;
			parse_params: string;
			display_value: string;
			validate: string;
		}
		const defs: CodeDef[] = [];
		const defOwner: GeneratorCheck[] = [];
		const defIndexByName = new Map<string, number>();
		for (const check of generatorChecks) {
			const generator = check.entry.file;
			if (!generator) {
				// Broken TOML is already reported elsewhere.
				continue;
			}
			if (generator.name.trim() && !defIndexByName.has(generator.name.trim())) {
				defIndexByName.set(generator.name.trim(), defs.length);
			}
			defs.push({
				id: defs.length,
				parameters: generator.code.parameters,
				generate: generator.code.generate,
				parse_params: generator.code.parseParams,
				display_value: generator.code.displayValue,
				validate: generator.code.validate,
			});
			defOwner.push(check);
		}
		if (defs.length === 0) {
			return;
		}

		// Collect the columns whose custom generator provides a validate cell.
		interface ValidationCheck {
			id: number;
			def_id: number;
			params: Record<string, string>;
			tableCheck: TableCheck;
			columnIndex: number;
			columnName: string;
		}
		const validationChecks: ValidationCheck[] = [];
		for (const tableCheck of tableChecks) {
			const table = tableCheck.entry.table;
			if (!table) {
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

		const payloadJson = JSON.stringify({
			defs,
			checks: validationChecks.map(({ id, def_id, params }) => ({ id, def_id, params })),
		});

		let findings: PythonCheckResult;
		if (payloadJson === this.lastPythonPayload) {
			// Unchanged input -> reuse the previous run's result (no Python
			// process required).
			findings = this.lastPythonFindings;
		} else {
			const pythonPath = await this.getPythonPath();
			if (!pythonPath) {
				return;
			}
			const outcome = await this.spawnPythonCheck(pythonPath, payloadJson);
			if (outcome.spawnFailed) {
				// Interpreter can no longer be started -> re-resolve on the next scan.
				this.pythonPath = null;
			}
			if (!outcome.result) {
				return;
			}
			findings = outcome.result;
			this.lastPythonPayload = payloadJson;
			this.lastPythonFindings = findings;
		}

		for (const finding of findings.syntax) {
			const target = defOwner[finding.id];
			if (!target) {
				continue;
			}
			// Line of the `<cell> = """` key; the body starts on the line below
			// it (multi-line TOML string, see serializeGenerator).
			const keyLine = target.lines.findIndex((line) => new RegExp(`^\\s*${finding.cell}\\s*=`).test(line));
			const bodyLine = keyLine >= 0 ? keyLine + Math.max(1, finding.line) : 0;
			target.diagnostics.push(
				this.diagnostic(
					this.lineRange(target.lines, bodyLine),
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
			const { lines, columnLines } = target.tableCheck;
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

	/** Runs the batched Python check; `result: null` on any failure (spawn, crash, unparseable output). */
	private spawnPythonCheck(
		pythonPath: string,
		payloadJson: string,
	): Promise<{ result: PythonCheckResult | null; spawnFailed: boolean }> {
		const script = [
			'import sys, json',
			// The payload and the answer are UTF-8 in both directions — without
			// this the interpreter would use the Windows code page for its
			// standard streams and mangle umlauts in generator code and
			// validation messages.
			'for _s in (sys.stdin, sys.stdout): _s.reconfigure(encoding="utf-8")',
			'data = json.load(sys.stdin)',
			'out = {"syntax": [], "validations": []}',
			'validators = {}',
			'for d in data.get("defs", []):',
			'    for cell in ("parameters", "generate", "parse_params", "display_value", "validate"):',
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

		return new Promise((resolve) => {
			const child = spawn(pythonPath, ['-c', script], { env: pythonEnv() });
			const decodeStdout = createStreamDecoder();
			let stdout = '';
			let spawnFailed = false;
			child.stdout.on('data', (chunk: Buffer) => {
				stdout += decodeStdout(chunk);
			});
			child.on('error', () => {
				spawnFailed = true;
			});
			child.on('close', () => {
				try {
					const result = JSON.parse(stdout.trim());
					resolve({
						result: {
							syntax: Array.isArray(result.syntax) ? result.syntax : [],
							validations: Array.isArray(result.validations) ? result.validations : [],
						},
						spawnFailed,
					});
				} catch {
					resolve({ result: null, spawnFailed });
				}
			});
			child.stdin.on('error', () => undefined);
			child.stdin.write(payloadJson);
			child.stdin.end();
		});
	}

	// ------------------------------------------------------------------
	// .tdgen — custom generators
	// ------------------------------------------------------------------

	/** Validates one generator file: name, parameter list and the code cells' contract. */
	private checkGenerator(check: GeneratorCheck): void {
		const { entry, lines, diagnostics } = check;
		if (entry.error) {
			diagnostics.push(...this.parseErrorDiagnostics(entry.error, lines));
			return;
		}
		const generator = entry.file;
		if (!generator) {
			return;
		}

		if (!generator.name.trim()) {
			// Without a name the generator cannot be referenced (see generator/custom.ts).
			diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, 0),
					vscode.l10n.t('This generator has no name — it cannot be selected in the table editor without one.'),
					'gen-file-missing-name',
					false,
				),
			);
		}

		const parameterLines = findParameterLineInfo(entry.text);
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

		// The parameters() cell must return a *literal* so the notebook
		// serializer can derive the [[parameters]] blocks from it (see
		// generator/notebookCells.ts) — otherwise the derived list stays at its
		// last valid state.
		if (generator.code.parameters.trim() && parametersFromBody(generator.code.parameters) === null) {
			const keyLine = lines.findIndex((line) => /^\s*parameters\s*=/.test(line));
			diagnostics.push(
				this.diagnostic(
					this.lineRange(lines, Math.max(0, keyLine)),
					vscode.l10n.t(
						'parameters() does not return a literal list of dicts — the derived parameter list cannot be updated.',
					),
					'gen-file-parameters-literal',
					true,
				),
			);
		}
	}
}
