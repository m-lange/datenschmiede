import * as vscode from 'vscode';
import { Project, ProjectTable } from './model';
import { parseProjectText, serializeProject, findTableLineInfo } from './toml';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getProjectWebviewStrings } from './webviewStrings';
import { listTables, tableLabel, computeRequiredClosure, TableEntry } from '../table/repository';
import { parseCardinality } from '../table/cardinality';
import { ensurePythonLinked, pickPythonInterpreter, resolveLinkedInterpreter } from './python';
import { GeneratorBase } from '../generator/base';
import { listGenerators, toGeneratorList } from '../generator/repository';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; project: Project }
	| { type: 'changePython' }
	| { type: 'openTable'; path: string }
	| { type: 'toggleTable'; path: string; checked: boolean }
	| { type: 'selectTables'; paths: string[] }
	| { type: 'deselectTables'; paths: string[] }
	| { type: 'runGeneration' }
	| { type: 'columnWidths'; columnWidths: Record<string, number> };
type ParsedDocument = { project: Project } | { error: unknown };

/** Schlüssel für die geräteweit gemerkte Spaltenbreite des Tabellen-Tab-Auswahlbaums (siehe table/editorProvider.ts fürs Gegenstück im Table Editor). */
const COLUMN_WIDTHS_STATE_KEY = 'datenschmiede.projectColumnWidths';

/** Ein Icon-Paar (helles/dunkles Theme), als Webview-URI — siehe buildTableIcons. */
interface IconPair {
	dark: string;
	light: string;
}

/** Icons für den Tabellen-Tab-Auswahlbaum: dieselben SVGs wie das Datei-Icon im Explorer (icons/), je nach Zeilen-Status. */
interface ProjectTreeIcons {
	normal: IconPair;
	required: IconPair;
	invalid: IconPair;
	namespace: IconPair;
}

/** Löst die Icon-Dateien (icons/) einmal je Webview-Panel in Webview-URIs auf (siehe getHtml für dasselbe Muster bei media/). */
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
 * Eine Zeile im Tabellen-Tab der Projekt-Webview: abgeleitete Anzeige-Infos
 * zu einer ausgewählten Tabelle (siehe buildTableRows) — nicht Teil des
 * persistierten Modells (project/model.ts), sondern bei jeder Anzeige aus dem
 * aktuellen Stand der referenzierten `.td`-Dateien neu berechnet. Nur noch
 * für die Problems-Diagnostics genutzt (siehe buildRecordsDiagnostics) — die
 * Webview selbst nutzt inzwischen den vollständigeren ProjectPickerNode-Baum.
 */
interface ProjectTableRow {
	path: string;
	label: string;
	found: boolean;
	secondary: boolean;
	records?: string;
}

/** Ein Namensraum-Knoten im Tabellen-Tab, gebildet aus den Punkt-getrennten Segmenten des `schema`-Felds (z. B. `ag.cor.sapbp` -> drei Ebenen). */
export interface ProjectPickerGroupNode {
	kind: 'group';
	segment: string;
	children: ProjectPickerNode[];
}

/** Eine Tabellen-Zeile im Tabellen-Tab — Anzeige- und Auswahl-Info für eine `.td`-Datei des Workspace, unabhängig davon, ob sie schon zum Projekt gehört. */
export interface ProjectPickerTableNode {
	kind: 'table';
	path: string;
	/** `schema.name`, oder der Pfad als Fallback ohne gesetzten Namen bzw. bei kaputtem TOML. */
	label: string;
	/** `false`, wenn die Datei kein gültiges TOML enthält — dann nicht auswählbar. */
	found: boolean;
	/** Teil des Projekts (explizit ausgewählt oder über eine FK-Kette automatisch mitgenommen). */
	checked: boolean;
	/** `true`, wenn `checked` nur automatisch zustande kam und sich die Tabelle deshalb nicht abwählen lässt. */
	locked: boolean;
	/**
	 * `true` bei einer referenzierten (sekundären) Tabelle — sie hat einen
	 * gültigen ausgehenden Fremdschlüssel (`fk_table` außer sich selbst);
	 * ihr `records`-Wert gilt dann je Datensatz von `referencedTable` und
	 * darf auch ein Bereich ("1..3") sein. `false` bei einer primären
	 * Tabelle, deren `records`-Wert eine feste Gesamtanzahl ist.
	 */
	secondary: boolean;
	/** Logische Identität der über den ausgehenden FK referenzierten Tabelle (nur gesetzt, wenn `secondary`). */
	referencedTable?: string;
	/** Nur relevant, wenn `checked` ist — Pflichtangabe für beide Tabellenarten (siehe `secondary` für die Bedeutung). */
	records?: string;
}

export type ProjectPickerNode = ProjectPickerGroupNode | ProjectPickerTableNode;

/**
 * Eine Zeile der Ausgabedateien-Übersicht im Übersicht-Tab: welche Datei der
 * Generator-Lauf für eine ausgewählte Tabelle erzeugen wird (td-Datei,
 * Tabellenname, Dateiname-Vorlage, Datensatzanzahl) — rein lesend, bearbeitet
 * wird der Dateiname im Table Editor, die Datensatzanzahl im Tabellen-Tab.
 */
export interface OutputFileRow {
	/** Workspace-relativer Pfad der `.td`-Datei. */
	path: string;
	/** Logische Identität (`schema.name`), oder der Pfad als Fallback. */
	label: string;
	/** Dateiname-Vorlage mit `{…}`-Variablen (Standard `{schema}_{table}`, wenn nichts konfiguriert). */
	fileName: string;
	/** Dateiendung inkl. Punkt, aus dem konfigurierten Dateityp (vorerst ".csv"). */
	ext: string;
	/** Konfigurierte Datensatzanzahl ("100" bzw. "5"/"1..3" je referenziertem Datensatz). */
	records?: string;
	/** `false`, wenn die `.td`-Datei nicht (mehr) lesbar ist. */
	found: boolean;
	/** `true` bei einer referenzierten (sekundären) Tabelle — `records` gilt je Datensatz von `referencedTable`. */
	secondary: boolean;
	referencedTable?: string;
}

/** Baut die Ausgabedateien-Übersicht des Übersicht-Tabs (eine Zeile je ausgewählter Tabelle). */
function buildOutputFiles(project: Project, entries: TableEntry[]): OutputFileRow[] {
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));
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
		const outgoing = entry.table.columns.find(
			(column) => column.fk && column.fkTable.trim() !== '' && column.fkTable.trim() !== label,
		);
		return {
			path: table.path,
			label,
			// Ohne konfigurierten Dateinamen greift der Standard `{schema}_{table}`
			// (siehe python/generate.py) — als Vorlage angezeigt, damit die
			// Übersicht dieselben Variablen-Tags zeigt wie der Table Editor.
			fileName: entry.table.output.fileName.trim() || '{schema}_{table}',
			ext: `.${(entry.table.output.format || 'csv').toLowerCase()}`,
			records: table.records,
			found: true,
			secondary: !!outgoing,
			referencedTable: outgoing?.fkTable.trim(),
		};
	});
}

/**
 * Custom-Text-Editor für .tdproject-Dateien.
 *
 * Analog zu table/editorProvider.ts bleibt die Datei auf der Festplatte
 * normaler TOML-Text (siehe project/toml.ts); diese Klasse hält Webview und
 * VS-Code-Textdokument synchron. Der Tabellen-Tab enthält die komplette
 * Tabellenauswahl (siehe ProjectPickerNode/buildPickerTree) direkt in der
 * Webview — anders als zuvor keine separate Ansicht in der
 * Explorer-Seitenleiste mehr nötig.
 */
export class ProjectEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	public static readonly viewType = 'datenschmiede.projectEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new ProjectEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(ProjectEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	/** Offene Projekt-Webviews samt ihrem Dokument, um sie bei Änderungen an .td-Dateien im Workspace (Tabellen-Tab) neu zu versorgen. */
	private readonly panelDocuments = new Map<vscode.WebviewPanel, vscode.TextDocument>();
	/**
	 * Beobachtet .td- und .tdgen-Dateien im Workspace, damit Tabellen-Tab und
	 * Ausgabedateien-Übersicht aktuell bleiben — .tdgen zusätzlich, weil die
	 * automatische Tabellen-Mitnahme auch die von Generatoren benötigten
	 * Tabellen berücksichtigt (siehe computeRequiredClosure).
	 */
	private readonly watchers: vscode.FileSystemWatcher[] = [];
	private cachedEntries: TableEntry[] = [];
	/** Zuletzt ermittelte Generator-Liste (eingebaute + `.tdgen`-Dateien), für computeRequiredClosure. */
	private cachedGenerators: GeneratorBase[] = [];
	private entriesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly diagnostics: vscode.DiagnosticCollection;
	private readonly closeDocSub: vscode.Disposable;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.diagnostics = vscode.languages.createDiagnosticCollection('tdproject');
		this.closeDocSub = vscode.workspace.onDidCloseTextDocument((doc) => {
			if (doc.fileName.endsWith('.tdproject')) {
				this.diagnostics.delete(doc.uri);
			}
		});

		const refresh = () => this.scheduleEntriesRefresh();
		for (const pattern of ['**/*.td', '**/*.tdgen']) {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			watcher.onDidCreate(refresh);
			watcher.onDidDelete(refresh);
			watcher.onDidChange(refresh);
			this.watchers.push(watcher);
		}
	}

	public dispose(): void {
		this.diagnostics.dispose();
		this.closeDocSub.dispose();
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
		if (this.entriesRefreshTimer) {
			clearTimeout(this.entriesRefreshTimer);
		}
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

		// Wird gesetzt, bevor wir selbst einen WorkspaceEdit auf das Dokument
		// anwenden — siehe table/editorProvider.ts für die ausführliche Begründung.
		let ignoreNextChange = false;

		const postState = async () => {
			const state = this.readState(document);
			this.updateDiagnostics(document);
			if ('project' in state) {
				const pickerTree = buildPickerTree(state.project, this.cachedEntries, this.cachedGenerators);
				const outputFiles = buildOutputFiles(state.project, this.cachedEntries);
				const pythonStatus = state.project.python ? await resolveLinkedInterpreter(state.project.python) : null;
				void webviewPanel.webview.postMessage({
					type: 'update',
					project: state.project,
					pickerTree,
					outputFiles,
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
			if (ignoreNextChange) {
				ignoreNextChange = false;
				this.updateDiagnostics(document);
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
					const outputFiles = 'project' in state ? buildOutputFiles(state.project, this.cachedEntries) : [];
					const pythonStatus =
						'project' in state && state.project.python ? await resolveLinkedInterpreter(state.project.python) : null;
					const columnWidths = this.context.globalState.get<Record<string, number>>(COLUMN_WIDTHS_STATE_KEY, {});
					void webviewPanel.webview.postMessage({
						type: 'init',
						strings,
						pickerTree,
						outputFiles,
						pythonStatus,
						icons,
						columnWidths,
						...state,
					});
					this.updateDiagnostics(document);
					if ('project' in state) {
						void this.maybePromptForPython(document, state.project);
					}
					break;
				}
				case 'edit': {
					const newText = serializeProject(message.project);
					if (newText === document.getText()) {
						break;
					}
					ignoreNextChange = true;
					const applied = await this.applyText(document, newText);
					if (!applied) {
						ignoreNextChange = false;
					}
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
					// Löst über das normale onDidChangeTextDocument -> postState() eine
					// aktualisierte Anzeige aus (inkl. neu aufgelöstem pythonStatus) —
					// kein eigenes Antwort-Message nötig.
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
						// Abwahl verweigert (Tabelle wird per FK noch benötigt): die
						// Checkbox in der Webview ist optisch schon abgehakt — Baum neu
						// schicken, damit sie auf den echten Zustand zurückspringt.
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
					// Der eigentliche Lauf liegt im Befehl (siehe project/run.ts) —
					// derselbe, den auch der Run-Knopf in der Editor-Titelleiste auslöst.
					await vscode.commands.executeCommand('datenschmiede.runGeneration', document.uri);
					break;
				}
				case 'selectTables': {
					// „Alle auswählen“ im Kontextmenü eines Namensraum-Knotens
					// (siehe showGroupContextMenu in media/project.js).
					await this.addTables(document, message.paths);
					break;
				}
				case 'deselectTables': {
					// „Alle abwählen“ im Kontextmenü eines Namensraum-Knotens.
					await this.removeTables(document, message.paths);
					break;
				}
				case 'columnWidths': {
					// Geräteweit über alle Projekte hinweg gemerkt (persönliche
					// Anzeige-Präferenz), analog zu table/editorProvider.ts.
					await this.context.globalState.update(COLUMN_WIDTHS_STATE_KEY, message.columnWidths);
					break;
				}
			}
		});
	}

	/** Öffnet die `.td`-Datei einer Tabelle (Knopf im Tabellen-Tab, siehe media/project.js). */
	private async openTableFile(relativePath: string): Promise<void> {
		let entry = this.cachedEntries.find((e) => e.relativePath === relativePath);
		if (!entry) {
			// Cache evtl. veraltet (z. B. Datei gerade erst hinzugefügt) -> einmal neu einlesen.
			entry = (await this.refreshEntriesCache()).find((e) => e.relativePath === relativePath);
		}
		if (!entry) {
			void vscode.window.showErrorMessage(vscode.l10n.t('"{0}" was not found.', relativePath));
			return;
		}
		await vscode.commands.executeCommand('vscode.open', entry.uri);
	}

	/**
	 * Setzt, ob eine Tabelle Teil des Projekts ist (Checkbox je Zeile im
	 * Tabellen-Tab, siehe media/project.js). Anhaken nimmt automatisch alle
	 * über Fremdschlüssel (rekursiv) referenzierten Tabellen mit auf;
	 * Abhaken wird verweigert, solange eine andere ausgewählte Tabelle diese
	 * noch benötigt — dieselbe Regel, die eine automatisch mitgenommene
	 * Tabelle von vornherein als gesperrt anzeigt (siehe buildPickerTree).
	 *
	 * @returns `false` genau dann, wenn das Abhaken verweigert wurde — der
	 * Aufrufer schickt der Webview dann den unveränderten Baum erneut, damit
	 * die dort schon abgehakte Checkbox zurückspringt.
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
	 * Nimmt eine oder mehrere Tabellen ins Projekt auf — gemeinsame Grundlage
	 * für das Anhaken einer einzelnen Checkbox (setTableChecked) und „Alle
	 * auswählen“ im Kontextmenü eines Namensraum-Knotens. Wie beim einzelnen
	 * Anhaken werden alle über Fremdschlüssel (rekursiv) referenzierten
	 * Tabellen automatisch mit aufgenommen.
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
	 * Entfernt mehrere Tabellen auf einmal aus dem Projekt („Alle abwählen“
	 * im Kontextmenü eines Namensraum-Knotens) — Gegenstück zu addTables.
	 * Untereinander dürfen die entfernten Tabellen sich ruhig referenzieren;
	 * nur wer von einer *verbleibenden* Tabelle über deren FK-Kette noch
	 * benötigt wird, bleibt stillschweigend ausgewählt (dieselbe Regel, die
	 * beim einzelnen Abhaken die Abwahl verweigert, siehe setTableChecked).
	 */
	private async removeTables(document: vscode.TextDocument, relativePaths: string[]): Promise<void> {
		const state = this.readState(document);
		if (!('project' in state)) {
			return;
		}
		const project = state.project;
		const toRemove = new Set(relativePaths);

		let keep = project.tables.filter((t) => !toRemove.has(t.path));
		// Fixpunkt: jede zurückbehaltene Tabelle kann ihrerseits weitere der
		// zu entfernenden über ihre FK-Kette benötigen.
		for (;;) {
			const keepPaths = new Set(keep.map((t) => t.path));
			const required = computeRequiredClosure(keepPaths, this.cachedEntries, this.cachedGenerators);
			const addBack = project.tables.filter((t) => !keepPaths.has(t.path) && required.has(t.path));
			if (addBack.length === 0) {
				break;
			}
			keep = [...keep, ...addBack];
		}
		// Gleiche Reihenfolge wie addTables (Pfad-sortiert), damit das
		// Zurückbehalten einzelner Tabellen keine Umsortierung im TOML erzeugt.
		keep.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

		const newText = serializeProject({ ...project, tables: keep });
		if (newText === document.getText()) {
			return;
		}
		await this.applyText(document, newText);
	}

	/** Fragt nach einem Python-Interpreter, falls das Projekt noch keinen verknüpft hat (siehe project/python.ts#ensurePythonLinked). */
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

	/** Liest und parst das Dokument; liefert entweder das Projekt-Modell oder eine lokalisierte Fehlermeldung. */
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

	/**
	 * Aktualisiert die Problems-Ansicht für dieses Dokument: bei kaputtem TOML
	 * der Syntaxfehler an seiner Position, sonst eine fehlende oder ungültige
	 * Datensatzanzahl je ausgewählter Tabelle (siehe buildRecordsDiagnostics —
	 * dieselben Regeln, die im Tabellen-Tab die Eingabe rot markieren).
	 */
	private updateDiagnostics(document: vscode.TextDocument): void {
		const result = this.parseDocument(document);
		if ('project' in result) {
			this.diagnostics.set(document.uri, this.buildRecordsDiagnostics(document, result.project));
			return;
		}

		const err = result.error;
		if (err instanceof ParseError && err.line !== undefined && err.column !== undefined) {
			const lineIndex = Math.min(Math.max(0, err.line - 1), Math.max(0, document.lineCount - 1));
			const lineText = document.lineAt(lineIndex).text;
			const startCol = Math.min(Math.max(0, err.column - 1), lineText.length);
			const range = new vscode.Range(lineIndex, startCol, lineIndex, lineText.length);
			const diagnostic = new vscode.Diagnostic(range, err.rawMessage, vscode.DiagnosticSeverity.Error);
			diagnostic.source = 'Datenschmiede';
			this.diagnostics.set(document.uri, [diagnostic]);
		} else {
			this.diagnostics.set(document.uri, []);
		}
	}

	/**
	 * Jede ausgewählte (gefundene) Tabelle braucht eine Datensatzanzahl:
	 * primäre Tabellen eine feste Zahl, referenzierte (sekundäre) eine Zahl
	 * oder einen Bereich ("1..3") je Datensatz der referenzierten Tabelle —
	 * fehlt die Angabe oder ist sie ungültig, landet sie hier als Problem.
	 */
	private buildRecordsDiagnostics(document: vscode.TextDocument, project: Project): vscode.Diagnostic[] {
		const rows = buildTableRows(project, this.cachedEntries);
		const lineInfoByPath = findTableLineInfo(document.getText());
		const diagnostics: vscode.Diagnostic[] = [];

		for (const row of rows) {
			if (!row.found) {
				continue;
			}
			const raw = row.records?.trim() ?? '';
			let message: string;
			let code: string;
			if (raw === '') {
				message = vscode.l10n.t('Table "{0}" has no number of records to generate.', row.label);
				code = 'missing-records';
			} else if (row.secondary ? !parseCardinality(raw) : !/^\d+$/.test(raw)) {
				message = row.secondary
					? vscode.l10n.t('Table "{0}": invalid number of related records (use e.g. "5" or "1..3").', row.label)
					: vscode.l10n.t('Table "{0}": invalid number of records (use e.g. "100").', row.label);
				code = 'invalid-records';
			} else {
				continue;
			}
			const info = lineInfoByPath.get(row.path);
			const line = info ? info.pathLine : 0;
			const lineIndex = Math.min(line, Math.max(0, document.lineCount - 1));
			const range = document.lineAt(lineIndex).range;
			const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
			diagnostic.source = 'Datenschmiede';
			diagnostic.code = code;
			diagnostics.push(diagnostic);
		}

		return diagnostics;
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
		const [entries, generators] = await Promise.all([listTables(), listGenerators()]);
		this.cachedEntries = entries;
		this.cachedGenerators = toGeneratorList(generators);
		return this.cachedEntries;
	}

	/**
	 * Schickt allen offenen Projekt-Webviews den neu berechneten Auswahlbaum
	 * (z. B. nach Anlegen/Löschen/Umbenennen einer `.td`-Datei oder Änderung
	 * ihrer FK-Spalten) — die Auswahl selbst (welche Pfade zum Projekt
	 * gehören) ändert sich dadurch nicht, nur ihre Anzeige.
	 */
	private async broadcastPickerTree(): Promise<void> {
		await this.refreshEntriesCache();
		for (const [panel, document] of this.panelDocuments) {
			const state = this.readState(document);
			if ('project' in state) {
				const pickerTree = buildPickerTree(state.project, this.cachedEntries, this.cachedGenerators);
				const outputFiles = buildOutputFiles(state.project, this.cachedEntries);
				void panel.webview.postMessage({ type: 'pickerTree', pickerTree, outputFiles });
			}
		}
	}

	/** Debounced, analog zu table/editorProvider.ts#scheduleTableOptionsBroadcast. */
	private scheduleEntriesRefresh(): void {
		if (this.entriesRefreshTimer) {
			clearTimeout(this.entriesRefreshTimer);
		}
		this.entriesRefreshTimer = setTimeout(() => {
			this.entriesRefreshTimer = undefined;
			void this.broadcastPickerTree();
		}, 400);
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const mediaUri = (...segments: string[]) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...segments));

		const commonScriptUri = mediaUri('common.js');
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
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

/**
 * Berechnet für jede zum Projekt gehörende Tabelle die Anzeige-Infos für die
 * Problems-Diagnostics (siehe buildRecordsDiagnostics): ob die Datei (noch)
 * gefunden wurde und ob es sich um eine referenzierte (sekundäre) Tabelle
 * handelt — d. h. eine mit gültiger, nicht auf sich selbst zeigender
 * `fk_table`-Spalte, deren Datensatzanzahl je referenziertem Datensatz gilt
 * und auch ein Bereich sein darf.
 */
function buildTableRows(project: Project, entries: TableEntry[]): ProjectTableRow[] {
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));

	return project.tables.map((table): ProjectTableRow => {
		const entry = byPath.get(table.path);
		if (!entry || !entry.table) {
			return { path: table.path, label: table.path, found: false, secondary: false, records: table.records };
		}

		const label = tableLabel(entry.table, entry.relativePath);
		const outgoing = entry.table.columns.find(
			(column) => column.fk && column.fkTable.trim() !== '' && column.fkTable.trim() !== label,
		);
		return { path: table.path, label, found: true, secondary: !!outgoing, records: table.records };
	});
}

/**
 * Baut den vollständigen Auswahlbaum für den Tabellen-Tab: alle `.td`-Tabellen
 * des Workspace, gruppiert nach den Punkt-getrennten Segmenten ihres
 * `schema`-Felds (z. B. `ag.cor.sapbp` -> drei Ebenen tief) statt nach
 * Ordnerstruktur, samt Auswahl-/Sperr-/Datensatz-Status je Tabelle. Tabellen
 * ohne Schema (oder mit kaputtem TOML) landen auf der Wurzelebene.
 */
function buildPickerTree(project: Project, entries: TableEntry[], generators: GeneratorBase[] = []): ProjectPickerNode[] {
	const explicit = new Set(project.tables.map((t) => t.path));
	const required = computeRequiredClosure(explicit, entries, generators);
	const existingRecords = new Map(project.tables.map((t) => [t.path, t.records] as const));

	/**
	 * Gesperrt (nicht abwählbar) ist eine Tabelle, wenn die *übrigen*
	 * ausgewählten Tabellen sie über ihre FK-Ketten (bzw. Generator-
	 * Referenzen) weiterhin benötigen — dieselbe Regel, mit der
	 * setTableChecked das Abwählen verweigert. Der frühere Vergleich „nur
	 * automatisch mitgenommen, nicht explizit“ griff zu kurz: setTableChecked
	 * schreibt beim Anhaken die komplette Hülle mit in project.tables, womit
	 * jede automatisch mitgenommene Tabelle sofort als explizit galt und ihre
	 * Checkbox fälschlich aktiv blieb.
	 */
	function isLockedSelection(path: string): boolean {
		if (!explicit.has(path)) {
			return required.has(path);
		}
		const others = new Set(explicit);
		others.delete(path);
		return computeRequiredClosure(others, entries, generators).has(path);
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
