import * as vscode from 'vscode';
import * as path from 'path';
import { LookupEntry } from '../lookup/repository';
import { Project, ProjectTable } from './model';
import { buildProjectDiagram } from './diagram';
import { getRunResult, onDidSaveRunResult, RunResult } from './runResults';
import { parseProjectText, serializeProject } from './toml';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getProjectWebviewStrings } from './webviewStrings';
import { tableLabel, computeRequiredClosure, buildRequiredEdges, closureOf, TableEntry } from '../table/repository';
import { parseCardinality } from '../table/cardinality';
import { ResolvedPythonStatus, ensurePythonLinked, pickPythonInterpreter, resolveLinkedInterpreter } from './python';
import { GeneratorBase } from '../generator/base';
import { toGeneratorList } from '../generator/repository';
import { WorkspaceIndex } from '../workspaceIndex';
import { PythonLink } from './model';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; project: Project }
	| { type: 'changePython' }
	| { type: 'openTable'; path: string }
	| { type: 'toggleTable'; path: string; checked: boolean }
	| { type: 'selectTables'; paths: string[] }
	| { type: 'deselectTables'; paths: string[] }
	| { type: 'runGeneration' }
	| { type: 'pickOutputFolder' }
	| { type: 'pickRequirementsFile' }
	| { type: 'columnWidths'; columnWidths: Record<string, number> };
type ParsedDocument = { project: Project } | { error: unknown };

/** Key of the per-machine column widths of the tables tab's picker tree (see table/editorProvider.ts for the table editor counterpart). */
const COLUMN_WIDTHS_STATE_KEY = 'datenschmiede.projectColumnWidths';

/** An icon pair (light/dark theme) as webview URIs — see buildTableIcons. */
interface IconPair {
	dark: string;
	light: string;
}

/** Icons for the tables tab's picker tree: the same SVGs as the file icon in the explorer (icons/), chosen per row state. */
interface ProjectTreeIcons {
	normal: IconPair;
	required: IconPair;
	invalid: IconPair;
	namespace: IconPair;
}

/** Resolves the icon files (icons/) into webview URIs once per webview panel (see getHtml for the same pattern with media/). */
function buildTableIcons(webview: vscode.Webview, extensionUri: vscode.Uri): ProjectTreeIcons {
	const iconUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'icons', name)).toString();
	return {
		normal: { dark: iconUri('td-dark.svg'), light: iconUri('td-light.svg') },
		required: { dark: iconUri('td-required-dark.svg'), light: iconUri('td-required-light.svg') },
		invalid: { dark: iconUri('td-invalid-dark.svg'), light: iconUri('td-invalid-light.svg') },
		namespace: { dark: iconUri('schema-dark.svg'), light: iconUri('schema-light.svg') },
	};
}

/**
 * A row in the project webview's tables tab: derived display info about a
 * selected table (see buildTableRows) — not part of the persisted model
 * (project/model.ts) but recomputed on every render from the current state of
 * the referenced `.td` files. Nowadays only used for the Problems diagnostics
 * (see buildRecordsDiagnostics) — the webview itself uses the richer
 * ProjectPickerNode tree.
 */
interface ProjectTableRow {
	path: string;
	label: string;
	found: boolean;
	secondary: boolean;
	/** `true` when a lookup list leads the table — its record count follows from the list. */
	lookupDriven?: boolean;
	records?: string;
}

/** A namespace node in the tables tab, formed from the dot-separated segments of the `schema` field (e.g. `ag.cor.sapbp` -> three levels). */
export interface ProjectPickerGroupNode {
	kind: 'group';
	segment: string;
	children: ProjectPickerNode[];
}

/** A table row in the tables tab — display and selection info for a `.td` file of the workspace, whether or not it already belongs to the project. */
export interface ProjectPickerTableNode {
	kind: 'table';
	path: string;
	/** `schema.name`, or the path as a fallback when no name is set or the TOML is broken. */
	label: string;
	/** `false` if the file is not valid TOML — it then cannot be selected. */
	found: boolean;
	/** Part of the project (selected explicitly, or pulled in automatically via an FK chain). */
	checked: boolean;
	/** `true` if `checked` came about only automatically, so the table cannot be deselected. */
	locked: boolean;
	/**
	 * `true` for a referenced (secondary) table — it has a valid outgoing
	 * foreign key (`fk_table` other than itself); its `records` value then
	 * applies per record of `referencedTable` and may also be a range ("1..3").
	 * `false` for a primary table, whose `records` value is a fixed total.
	 */
	secondary: boolean;
	/** Logical identity of the table referenced via the outgoing FK (only set when `secondary`). */
	referencedTable?: string;
	/** Only relevant when `checked` — mandatory for both kinds of table (see `secondary` for the meaning). */
	records?: string;
}

export type ProjectPickerNode = ProjectPickerGroupNode | ProjectPickerTableNode;

/**
 * A row of the output files overview on the overview tab: which file the
 * generator run will produce for a selected table (td file, table name, file
 * name template, record count) — read-only here; the file name is edited in the
 * table editor and the record count on the tables tab.
 */
export interface OutputFileRow {
	/** Workspace-relative path of the `.td` file. */
	path: string;
	/** Logical identity (`schema.name`), or the path as a fallback. */
	label: string;
	/** File name template with `{…}` variables (default `{schema}_{table}` when nothing is configured). */
	fileName: string;
	/** File extension including the dot, from the configured file type (".csv" for now). */
	ext: string;
	/** Configured record count ("100", or "5"/"1..3" per referenced record). */
	records?: string;
	/**
	 * Record count estimated from the configuration: for referenced tables the
	 * cardinality multiplied along the FK chain up to the primary table (as
	 * min/max for ranges) — rather than merely showing the configured range.
	 * Absent when the chain is not (yet) computable (missing or invalid values).
	 */
	estimatedMin?: number;
	estimatedMax?: number;
	/** Real record count of the last generator run, if this table was part of it. */
	lastRunRecords?: number;
	/** `false` if the `.td` file is no longer readable. */
	found: boolean;
	/** `true` for a referenced (secondary) table — `records` then applies per record of `referencedTable`. */
	secondary: boolean;
	referencedTable?: string;
}

/** Builds the overview tab's output files list (one row per selected table). */
function buildOutputFiles(
	project: Project,
	entries: TableEntry[],
	lookups: LookupEntry[] = [],
	lastRun?: RunResult | null,
): OutputFileRow[] {
	// Row count per referenceable list name — a leading lookup list decides the
	// record count of the table it leads (see Table.drivingLookup).
	const lookupRows = new Map<string, number>();
	for (const lookup of lookups) {
		if (lookup.lookup) {
			lookupRows.set(lookup.name, lookup.lookup.rows.length);
		}
	}
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));

	// Selected tables keyed by logical identity, so a referenced table's FK
	// chain can be traced back to the primary table.
	const byLabel = new Map<string, { entry: TableEntry; records?: string }>();
	for (const projectTable of project.tables) {
		const entry = byPath.get(projectTable.path);
		if (entry?.table) {
			byLabel.set(tableLabel(entry.table, entry.relativePath), { entry, records: projectTable.records });
		}
	}

	/** First outgoing FK reference (the same rule as the run's driving FK column, see project/run.ts). */
	function outgoingLabel(entry: TableEntry): string | undefined {
		if (!entry.table) {
			return undefined;
		}
		const label = tableLabel(entry.table, entry.relativePath);
		const outgoing = entry.table.columns.find(
			(column) => column.fk && column.fkTable.trim() !== '' && column.fkTable.trim() !== label,
		);
		return outgoing?.fkTable.trim();
	}

	/**
	 * Estimated record count of a table as a min/max range: primary tables
	 * straight from their fixed count, referenced ones from the cardinality
	 * multiplied by the (recursively estimated) count of the referenced table.
	 * `null` as soon as a link in the chain is missing or invalid; `visiting`
	 * breaks cycles (which hand-written TOML can produce).
	 */
	function effectiveRange(label: string, visiting: Set<string>): { min: number; max: number } | null {
		const selected = byLabel.get(label);
		if (!selected || visiting.has(label)) {
			return null;
		}
		// A leading lookup list wins over everything else: the table gets exactly
		// one record per list row, so neither the configured count nor an
		// outgoing FK has any say (see run_table in python/generate.py).
		const driving = selected.entry.table?.drivingLookup.trim();
		if (driving) {
			const rows = lookupRows.get(driving);
			return rows === undefined ? null : { min: rows, max: rows };
		}
		const raw = (selected.records ?? '').trim();
		const parentLabel = outgoingLabel(selected.entry);
		if (!parentLabel || !byLabel.has(parentLabel)) {
			return /^\d+$/.test(raw) ? { min: Number(raw), max: Number(raw) } : null;
		}
		const cardinality = parseCardinality(raw);
		if (!cardinality) {
			return null;
		}
		visiting.add(label);
		const parent = effectiveRange(parentLabel, visiting);
		visiting.delete(label);
		if (!parent) {
			return null;
		}
		return { min: parent.min * cardinality.min, max: parent.max * cardinality.max };
	}

	return project.tables.map((table): OutputFileRow => {
		const entry = byPath.get(table.path);
		if (!entry?.table) {
			return {
				path: table.path,
				label: table.path,
				fileName: '',
				ext: '.csv',
				records: table.records,
				found: false,
				secondary: false,
			};
		}
		const label = tableLabel(entry.table, entry.relativePath);
		const referencedTable = outgoingLabel(entry);
		const estimated = effectiveRange(label, new Set());
		return {
			path: table.path,
			label,
			// Without a configured file name the default `{schema}_{table}`
			// applies (see python/generate.py) — shown as a template so the
			// overview displays the same variable tags as the table editor.
			fileName: entry.table.output.fileName.trim() || '{schema}_{table}',
			ext: `.${(entry.table.output.format || 'csv').toLowerCase()}`,
			records: table.records,
			estimatedMin: estimated?.min,
			estimatedMax: estimated?.max,
			...(lastRun?.counts[label] !== undefined ? { lastRunRecords: lastRun.counts[label] } : {}),
			found: true,
			secondary: !!referencedTable,
			referencedTable,
		};
	});
}

/**
 * Custom text editor for .tdproject files.
 *
 * As in table/editorProvider.ts the file on disk stays plain TOML text (see
 * project/toml.ts); this class keeps the webview and the VS Code text document
 * in sync. The tables tab hosts the complete table picker (see
 * ProjectPickerNode/buildPickerTree) directly in the webview — unlike before,
 * no separate view in the explorer sidebar is needed.
 */
export class ProjectEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	public static readonly viewType = 'datenschmiede.projectEditor';

	public static register(context: vscode.ExtensionContext, index: WorkspaceIndex): vscode.Disposable {
		const provider = new ProjectEditorProvider(context, index);
		const providerRegistration = vscode.window.registerCustomEditorProvider(ProjectEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	/** Open project webviews together with their document, so they can be refreshed when .td files change in the workspace (tables tab). */
	private readonly panelDocuments = new Map<vscode.WebviewPanel, vscode.TextDocument>();
	private cachedEntries: TableEntry[] = [];
	/** Most recently determined generator list (built-in + `.tdgen` files), used by computeRequiredClosure. */
	private cachedGenerators: GeneratorBase[] = [];
	private cachedLookups: LookupEntry[] = [];
	private readonly indexSub: vscode.Disposable;
	private readonly runResultSub: vscode.Disposable;
	/**
	 * Resolved interpreter status per linked interpreter (`path|id`): postState
	 * runs on every keystroke in the project (onDidChangeTextDocument) — the
	 * resolution via the Python extension API should not be repeated each time.
	 * Opening a project ('ready') resolves fresh and refreshes the cache.
	 */
	private readonly pythonStatusCache = new Map<string, ResolvedPythonStatus>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly index: WorkspaceIndex,
	) {
		// The shared workspace index already reports changes debounced; the
		// relevant kinds are .td (the tables themselves) and .tdgen (automatic
		// table inclusion also accounts for generator references, see
		// computeRequiredClosure).
		this.indexSub = index.onDidChange((kinds) => {
			if (kinds.has('td') || kinds.has('tdgen')) {
				void this.broadcastPickerTree();
			}
		});
		// After every generator run the diagrams show that run's real record
		// counts (see runResults.ts) — refresh the display.
		this.runResultSub = onDidSaveRunResult(() => {
			void this.broadcastPickerTree();
		});
	}

	public dispose(): void {
		this.indexSub.dispose();
		this.runResultSub.dispose();
	}

	/** Resolves the linked interpreter — from the cache, unless `fresh` forces a re-resolution. */
	private async resolvePythonStatus(link: PythonLink, fresh: boolean): Promise<ResolvedPythonStatus> {
		const key = `${link.path}|${link.id ?? ''}`;
		const cached = this.pythonStatusCache.get(key);
		if (cached && !fresh) {
			return cached;
		}
		const status = await resolveLinkedInterpreter(link);
		this.pythonStatusCache.set(key, status);
		return status;
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const strings = getProjectWebviewStrings(vscode.env.language);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
				vscode.Uri.joinPath(this.context.extensionUri, 'icons'),
			],
		};
		webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
		const icons = buildTableIcons(webviewPanel.webview, this.context.extensionUri);

		this.panelDocuments.set(webviewPanel, document);

		// A counter rather than a simple flag for self-initiated WorkspaceEdits —
		// see table/editorProvider.ts for the detailed rationale (overlapping
		// edits would otherwise replace the webview state mid-edit).
		let selfEditsPending = 0;
		/** Most recent self-initiated document text — the comparison base while edits are in flight. */
		let lastQueuedText: string | null = null;
		const queueSelfEdit = async (newText: string): Promise<boolean> => {
			if (newText === (lastQueuedText ?? document.getText())) {
				return true;
			}
			lastQueuedText = newText;
			selfEditsPending++;
			const applied = await this.applyText(document, newText);
			if (!applied) {
				selfEditsPending = Math.max(0, selfEditsPending - 1);
				lastQueuedText = null;
			}
			return applied;
		};

		const postState = async () => {
			const state = this.readState(document);
			if ('project' in state) {
				const pickerTree = buildPickerTree(state.project, this.cachedEntries, this.cachedGenerators);
				const lastRun = getRunResult(this.context, document.uri);
				const outputFiles = buildOutputFiles(state.project, this.cachedEntries, this.cachedLookups, lastRun);
				const diagram = buildProjectDiagram(state.project, this.cachedEntries, outputFiles, lastRun);
				const pythonStatus = state.project.python ? await this.resolvePythonStatus(state.project.python, false) : null;
				void webviewPanel.webview.postMessage({
					type: 'update',
					project: state.project,
					pickerTree,
					outputFiles,
					diagram,
					lastRunAt: lastRun?.finishedAt,
					pythonStatus,
				});
			} else {
				void webviewPanel.webview.postMessage({ type: 'parseError', message: state.parseError });
			}
		};

		const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (selfEditsPending > 0) {
				selfEditsPending--;
				if (selfEditsPending === 0) {
					lastQueuedText = null;
				}
				return;
			}
			void postState();
		});

		webviewPanel.onDidDispose(() => {
			changeDocSub.dispose();
			this.panelDocuments.delete(webviewPanel);
		});

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
			switch (message.type) {
				case 'ready': {
					await this.refreshEntriesCache();
					const state = this.readState(document);
					const pickerTree =
						'project' in state ? buildPickerTree(state.project, this.cachedEntries, this.cachedGenerators) : [];
					const lastRun = getRunResult(this.context, document.uri);
					const outputFiles =
						'project' in state ? buildOutputFiles(state.project, this.cachedEntries, this.cachedLookups, lastRun) : [];
					const diagram =
						'project' in state ? buildProjectDiagram(state.project, this.cachedEntries, outputFiles, lastRun) : null;
					const pythonStatus =
						'project' in state && state.project.python ? await this.resolvePythonStatus(state.project.python, true) : null;
					const columnWidths = this.context.globalState.get<Record<string, number>>(COLUMN_WIDTHS_STATE_KEY, {});
					void webviewPanel.webview.postMessage({
						type: 'init',
						strings,
						pickerTree,
						outputFiles,
						diagram,
						lastRunAt: lastRun?.finishedAt,
						pythonStatus,
						icons,
						columnWidths,
						...state,
					});
					if ('project' in state) {
						void this.maybePromptForPython(document, state.project);
					}
					break;
				}
				case 'edit': {
					await queueSelfEdit(serializeProject(message.project));
					break;
				}
				case 'changePython': {
					const link = await pickPythonInterpreter();
					if (!link) {
						break;
					}
					const current = this.readState(document);
					if (!('project' in current)) {
						break;
					}
					// Triggers an updated display through the regular
					// onDidChangeTextDocument -> postState() path (including a freshly
					// resolved pythonStatus) — no dedicated reply message needed.
					await this.applyText(document, serializeProject({ ...current.project, python: link }));
					break;
				}
				case 'openTable': {
					await this.openTableFile(message.path);
					break;
				}
				case 'toggleTable': {
					const applied = await this.setTableChecked(document, message.path, message.checked);
					if (!applied) {
						// Deselection refused (the table is still needed via an FK): the
						// webview's checkbox has already flipped visually — resend the
						// tree so it snaps back to the real state.
						const state = this.readState(document);
						if ('project' in state) {
							void webviewPanel.webview.postMessage({
								type: 'pickerTree',
								pickerTree: buildPickerTree(state.project, this.cachedEntries, this.cachedGenerators),
							});
						}
					}
					break;
				}
				case 'runGeneration': {
					// The run itself lives in the command (see project/run.ts) — the
					// same one the run button in the editor title bar triggers.
					await vscode.commands.executeCommand('datenschmiede.runGeneration', document.uri);
					break;
				}
				case 'pickOutputFolder': {
					// Folder picker for the output folder; the result is inserted into
					// the tag field as constant text (variables can still be added
					// afterwards).
					const projectDir = vscode.Uri.joinPath(document.uri, '..');
					const picked = await vscode.window.showOpenDialog({
						canSelectFiles: false,
						canSelectFolders: true,
						canSelectMany: false,
						defaultUri: projectDir,
						title: vscode.l10n.t('Select Output Folder'),
						openLabel: vscode.l10n.t('Select'),
					});
					if (!picked || picked.length === 0) {
						break;
					}
					const current = this.readState(document);
					if (!('project' in current)) {
						break;
					}
					// Store paths inside the project folder relatively (portable, with
					// forward slashes), anything else absolutely.
					const relative = path.relative(projectDir.fsPath, picked[0].fsPath);
					const outputPath =
						relative && !relative.startsWith('..') && !path.isAbsolute(relative)
							? relative.replace(/\\/g, '/')
							: picked[0].fsPath;
					// Triggers an updated display through the regular
					// onDidChangeTextDocument -> postState() path (as changePython does).
					await this.applyText(document, serializeProject({ ...current.project, outputPath }));
					break;
				}
				case 'pickRequirementsFile': {
					// File picker for the requirements.txt; stored relative to the
					// project folder where possible, so the project stays portable.
					const projectDir = vscode.Uri.joinPath(document.uri, '..');
					const picked = await vscode.window.showOpenDialog({
						canSelectFiles: true,
						canSelectFolders: false,
						canSelectMany: false,
						defaultUri: projectDir,
						filters: { 'requirements.txt': ['txt'], 'All files': ['*'] },
						title: vscode.l10n.t('Select Requirements File'),
						openLabel: vscode.l10n.t('Select'),
					});
					if (!picked || picked.length === 0) {
						break;
					}
					const current = this.readState(document);
					if (!('project' in current)) {
						break;
					}
					const relative = path.relative(projectDir.fsPath, picked[0].fsPath);
					const requirements =
						relative && !relative.startsWith('..') && !path.isAbsolute(relative)
							? relative.replace(/\\/g, '/')
							: picked[0].fsPath;
					await this.applyText(document, serializeProject({ ...current.project, requirements }));
					break;
				}
				case 'selectTables': {
					// "Select all" in a namespace node's context menu (see
					// showGroupContextMenu in media/project.js).
					await this.addTables(document, message.paths);
					break;
				}
				case 'deselectTables': {
					// "Deselect all" in a namespace node's context menu.
					await this.removeTables(document, message.paths);
					break;
				}
				case 'columnWidths': {
					// Remembered per machine across all projects (a personal display
					// preference), analogous to table/editorProvider.ts.
					await this.context.globalState.update(COLUMN_WIDTHS_STATE_KEY, message.columnWidths);
					break;
				}
			}
		});
	}

	/** Opens a table's `.td` file (button on the tables tab, see media/project.js). */
	private async openTableFile(relativePath: string): Promise<void> {
		let entry = this.cachedEntries.find((e) => e.relativePath === relativePath);
		if (!entry) {
			// The cache may be stale (e.g. the file was only just added) -> re-read once.
			entry = (await this.refreshEntriesCache()).find((e) => e.relativePath === relativePath);
		}
		if (!entry) {
			void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" was not found.', relativePath));
			return;
		}
		await vscode.commands.executeCommand('vscode.open', entry.uri);
	}

	/**
	 * Sets whether a table is part of the project (per-row checkbox on the
	 * tables tab, see media/project.js). Checking it automatically pulls in
	 * every table referenced (recursively) through foreign keys; unchecking is
	 * refused as long as another selected table still needs it — the same rule
	 * that shows an automatically included table as locked in the first place
	 * (see buildPickerTree).
	 *
	 * @returns `false` exactly when unchecking was refused — the caller then
	 * resends the unchanged tree to the webview so the already-flipped checkbox
	 * snaps back.
	 */
	private async setTableChecked(document: vscode.TextDocument, relativePath: string, checked: boolean): Promise<boolean> {
		const state = this.readState(document);
		if (!('project' in state)) {
			return true;
		}
		const project = state.project;

		if (checked) {
			await this.addTables(document, [relativePath]);
			return true;
		}

		const remaining = project.tables.filter((t) => t.path !== relativePath);
		const others = new Set(remaining.map((t) => t.path));
		if (computeRequiredClosure(others, this.cachedEntries, this.cachedGenerators).has(relativePath)) {
			const entry = this.cachedEntries.find((e) => e.relativePath === relativePath);
			const label = entry?.table ? tableLabel(entry.table, entry.relativePath) : relativePath;
			void vscode.window.showWarningMessage(
				vscode.l10n.t('"{0}" is required by another selected table’s foreign key and cannot be removed.', label),
			);
			return false;
		}

		await this.applyText(document, serializeProject({ ...project, tables: remaining }));
		return true;
	}

	/**
	 * Adds one or more tables to the project — the shared basis for checking a
	 * single checkbox (setTableChecked) and for "Select all" in a namespace
	 * node's context menu. As with a single check, every table referenced
	 * (recursively) through foreign keys is pulled in automatically.
	 */
	private async addTables(document: vscode.TextDocument, relativePaths: string[]): Promise<void> {
		const state = this.readState(document);
		if (!('project' in state)) {
			return;
		}
		const project = state.project;

		const knownPaths = new Set(this.cachedEntries.filter((e) => e.table).map((e) => e.relativePath));
		const nextExplicit = new Set(project.tables.map((t) => t.path));
		for (const path of relativePaths) {
			if (knownPaths.has(path)) {
				nextExplicit.add(path);
			}
		}
		const required = computeRequiredClosure(nextExplicit, this.cachedEntries, this.cachedGenerators);
		const allPaths = new Set([...nextExplicit, ...required]);
		const existingRecords = new Map(project.tables.map((t) => [t.path, t.records] as const));
		const tables: ProjectTable[] = [...allPaths].sort().map((path) => {
			const records = existingRecords.get(path);
			return records !== undefined ? { path, records } : { path };
		});

		const newText = serializeProject({ ...project, tables });
		if (newText === document.getText()) {
			return;
		}
		await this.applyText(document, newText);
	}

	/**
	 * Removes several tables from the project at once ("Deselect all" in a
	 * namespace node's context menu) — the counterpart to addTables. The removed
	 * tables may freely reference each other; only those still needed by a
	 * *remaining* table via its FK chain stay silently selected (the same rule
	 * that refuses deselection of a single checkbox, see setTableChecked).
	 */
	private async removeTables(document: vscode.TextDocument, relativePaths: string[]): Promise<void> {
		const state = this.readState(document);
		if (!('project' in state)) {
			return;
		}
		const project = state.project;
		const toRemove = new Set(relativePaths);

		let keep = project.tables.filter((t) => !toRemove.has(t.path));
		// Fixed point: every table kept back may in turn need further tables
		// slated for removal via its own FK chain.
		for (;;) {
			const keepPaths = new Set(keep.map((t) => t.path));
			const required = computeRequiredClosure(keepPaths, this.cachedEntries, this.cachedGenerators);
			const addBack = project.tables.filter((t) => !keepPaths.has(t.path) && required.has(t.path));
			if (addBack.length === 0) {
				break;
			}
			keep = [...keep, ...addBack];
		}
		// Same ordering as addTables (sorted by path), so keeping individual
		// tables back does not reorder the TOML.
		keep.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

		const newText = serializeProject({ ...project, tables: keep });
		if (newText === document.getText()) {
			return;
		}
		await this.applyText(document, newText);
	}

	/** Asks for a Python interpreter if the project has none linked yet (see project/python.ts#ensurePythonLinked). */
	private async maybePromptForPython(document: vscode.TextDocument, project: Project): Promise<void> {
		await ensurePythonLinked(project.python, async (link) => {
			const current = this.readState(document);
			if (!('project' in current)) {
				return;
			}
			await this.applyText(document, serializeProject({ ...current.project, python: link }));
		});
	}

	private parseDocument(document: vscode.TextDocument): ParsedDocument {
		try {
			return { project: parseProjectText(document.getText()) };
		} catch (err) {
			return { error: err };
		}
	}

	/** Reads and parses the document; returns either the project model or a localized error message. */
	private readState(document: vscode.TextDocument): { project: Project } | { parseError: string } {
		const result = this.parseDocument(document);
		if ('project' in result) {
			return result;
		}
		const err = result.error;
		if (err instanceof ParseError) {
			return { parseError: this.formatParseError(err) };
		}
		return { parseError: String(err) };
	}

	private formatParseError(err: ParseError): string {
		if (err.line !== undefined && err.column !== undefined) {
			return vscode.l10n.t('Line {0}, column {1}: {2}', err.line, err.column, err.rawMessage);
		}
		return err.rawMessage;
	}

	private applyText(document: vscode.TextDocument, newText: string): Thenable<boolean> {
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullDocumentRange(document), newText);
		return vscode.workspace.applyEdit(edit);
	}

	private async refreshEntriesCache(): Promise<TableEntry[]> {
		const snapshot = await this.index.snapshot();
		this.cachedEntries = snapshot.tables;
		this.cachedGenerators = toGeneratorList(snapshot.generators);
		this.cachedLookups = snapshot.lookups;
		return this.cachedEntries;
	}

	/**
	 * Pushes the recomputed picker tree to every open project webview (e.g.
	 * after a `.td` file was created, deleted or renamed, or its FK columns
	 * changed) — the selection itself (which paths belong to the project) does
	 * not change, only its presentation. Debouncing is handled by the workspace
	 * index (see the constructor).
	 */
	private async broadcastPickerTree(): Promise<void> {
		await this.refreshEntriesCache();
		for (const [panel, document] of this.panelDocuments) {
			const state = this.readState(document);
			if ('project' in state) {
				const pickerTree = buildPickerTree(state.project, this.cachedEntries, this.cachedGenerators);
				const lastRun = getRunResult(this.context, document.uri);
				const outputFiles = buildOutputFiles(state.project, this.cachedEntries, this.cachedLookups, lastRun);
				const diagram = buildProjectDiagram(state.project, this.cachedEntries, outputFiles, lastRun);
				void panel.webview.postMessage({
					type: 'pickerTree',
					pickerTree,
					outputFiles,
					diagram,
					lastRunAt: lastRun?.finishedAt,
				});
			}
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const mediaUri = (...segments: string[]) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...segments));

		const commonScriptUri = mediaUri('common.js');
		const diagramScriptUri = mediaUri('diagram.js');
		const scriptUri = mediaUri('project.js');
		const styleUri = mediaUri('main.css');
		const codiconCssUri = mediaUri('codicon.css');

		const htmlLang = vscode.env.language.toLowerCase().startsWith('de') ? 'de' : 'en';

		return /* html */ `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
	<meta charset="UTF-8" />
	<meta
		http-equiv="Content-Security-Policy"
		content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
	/>
	<link href="${styleUri}" rel="stylesheet" />
	<link href="${codiconCssUri}" rel="stylesheet" />
	<title>Project Editor</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}" src="${commonScriptUri}"></script>
	<script nonce="${nonce}" src="${diagramScriptUri}"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

/**
 * Computes, for every table belonging to the project, the display info the
 * Problems diagnostics need (see buildRecordsDiagnostics): whether the file was
 * still found, and whether it is a referenced (secondary) table — i.e. one with
 * a valid `fk_table` column not pointing at itself, whose record count applies
 * per referenced record and may also be a range.
 */
export function buildTableRows(project: Project, entries: TableEntry[]): ProjectTableRow[] {
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));

	return project.tables.map((table): ProjectTableRow => {
		const entry = byPath.get(table.path);
		if (!entry || !entry.table) {
			return {
				path: table.path,
				label: table.path,
				found: false,
				secondary: false,
				lookupDriven: false,
				records: table.records,
			};
		}

		const label = tableLabel(entry.table, entry.relativePath);
		const outgoing = entry.table.columns.find(
			(column) => column.fk && column.fkTable.trim() !== '' && column.fkTable.trim() !== label,
		);
		const lookupDriven = entry.table.drivingLookup.trim() !== '';
		// A table led by a lookup list has neither a fixed count nor a
		// cardinality — the list length decides (see Table.drivingLookup).
		return {
			path: table.path,
			label,
			found: true,
			secondary: !lookupDriven && !!outgoing,
			lookupDriven,
			records: table.records,
		};
	});
}

/**
 * Builds the complete picker tree for the tables tab: all `.td` tables of the
 * workspace, grouped by the dot-separated segments of their `schema` field
 * (e.g. `ag.cor.sapbp` -> three levels deep) rather than by folder structure,
 * including per-table selection, lock and record state. Tables without a schema
 * (or with broken TOML) end up at the root level.
 */
function buildPickerTree(project: Project, entries: TableEntry[], generators: GeneratorBase[] = []): ProjectPickerNode[] {
	const explicit = new Set(project.tables.map((t) => t.path));
	// Derive the reference edges from the entries ONCE (resolving FK columns +
	// generator references is the expensive part) — each of the following
	// closure computations (one per selected table, see isLockedSelection) is
	// then pure graph traversal.
	const edges = buildRequiredEdges(entries, generators);
	const required = closureOf(explicit, edges);
	const existingRecords = new Map(project.tables.map((t) => [t.path, t.records] as const));

	/**
	 * A table is locked (cannot be deselected) when the *remaining* selected
	 * tables still need it via their FK chains (or generator references) — the
	 * same rule with which setTableChecked refuses deselection. The earlier test
	 * "included automatically, not explicitly" fell short: on checking,
	 * setTableChecked writes the complete closure into project.tables, which made
	 * every automatically included table count as explicit and wrongly left its
	 * checkbox enabled.
	 */
	function isLockedSelection(path: string): boolean {
		if (!explicit.has(path)) {
			return required.has(path);
		}
		const others = new Set(explicit);
		others.delete(path);
		return closureOf(others, edges).has(path);
	}

	function toTableNode(entry: TableEntry): ProjectPickerTableNode {
		if (!entry.table) {
			return {
				kind: 'table',
				path: entry.relativePath,
				label: entry.relativePath,
				found: false,
				checked: false,
				locked: false,
				secondary: false,
			};
		}

		const checked = explicit.has(entry.relativePath) || required.has(entry.relativePath);
		const label = tableLabel(entry.table, entry.relativePath);
		const outgoing = entry.table.columns.find(
			(column) => column.fk && column.fkTable.trim() !== '' && column.fkTable.trim() !== label,
		);

		const base = {
			kind: 'table' as const,
			path: entry.relativePath,
			label,
			found: true,
			checked,
			locked: checked && isLockedSelection(entry.relativePath),
			records: existingRecords.get(entry.relativePath),
		};

		if (outgoing) {
			return { ...base, secondary: true, referencedTable: outgoing.fkTable.trim() };
		}
		return { ...base, secondary: false };
	}

	interface MutableGroup {
		segment: string;
		children: Map<string, MutableGroup>;
		entries: TableEntry[];
	}
	const root: MutableGroup = { segment: '', children: new Map(), entries: [] };
	for (const entry of entries) {
		const schema = entry.table?.schema.trim() ?? '';
		const segments = schema
			? schema
					.split('.')
					.map((s) => s.trim())
					.filter((s) => s.length > 0)
			: [];
		let node = root;
		for (const segment of segments) {
			let child = node.children.get(segment);
			if (!child) {
				child = { segment, children: new Map(), entries: [] };
				node.children.set(segment, child);
			}
			node = child;
		}
		node.entries.push(entry);
	}

	function toNodes(group: MutableGroup): ProjectPickerNode[] {
		const groups = [...group.children.values()]
			.sort((a, b) => a.segment.localeCompare(b.segment))
			.map((child): ProjectPickerNode => ({ kind: 'group', segment: child.segment, children: toNodes(child) }));
		const tables = [...group.entries]
			.sort((a, b) => (a.table?.name.trim() || a.relativePath).localeCompare(b.table?.name.trim() || b.relativePath))
			.map((entry) => toTableNode(entry));
		return [...groups, ...tables];
	}

	return toNodes(root);
}
