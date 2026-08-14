import * as vscode from 'vscode';
import * as path from 'path';
import { Project, ProjectTable } from './model';
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
	/**
	 * Aus der Konfiguration berechnete Datensatzanzahl: bei referenzierten
	 * Tabellen die Kardinalität multipliziert entlang der FK-Kette bis zur
	 * primären Tabelle (bei Bereichen als Von/Bis) — statt nur den
	 * konfigurierten Bereich anzuzeigen. Fehlt, wenn die Kette (noch) nicht
	 * berechenbar ist (fehlende/ungültige Angaben).
	 */
	estimatedMin?: number;
	estimatedMax?: number;
	/** `false`, wenn die `.td`-Datei nicht (mehr) lesbar ist. */
	found: boolean;
	/** `true` bei einer referenzierten (sekundären) Tabelle — `records` gilt je Datensatz von `referencedTable`. */
	secondary: boolean;
	referencedTable?: string;
}

/** Baut die Ausgabedateien-Übersicht des Übersicht-Tabs (eine Zeile je ausgewählter Tabelle). */
function buildOutputFiles(project: Project, entries: TableEntry[]): OutputFileRow[] {
	const byPath = new Map(entries.map((entry) => [entry.relativePath, entry] as const));

	// Ausgewählte Tabellen nach ihrer logischen Identität, um die FK-Kette
	// einer referenzierten Tabelle bis zur primären zurückzuverfolgen.
	const byLabel = new Map<string, { entry: TableEntry; records?: string }>();
	for (const projectTable of project.tables) {
		const entry = byPath.get(projectTable.path);
		if (entry?.table) {
			byLabel.set(tableLabel(entry.table, entry.relativePath), { entry, records: projectTable.records });
		}
	}

	/** Erste ausgehende FK-Referenz (dieselbe Regel wie die treibende FK-Spalte des Laufs, siehe project/run.ts). */
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
	 * Berechnete Datensatzanzahl einer Tabelle als Von/Bis-Bereich: primäre
	 * Tabellen direkt aus ihrer festen Anzahl, referenzierte über die
	 * Kardinalität multipliziert mit der (rekursiv berechneten) Anzahl der
	 * referenzierten Tabelle. `null`, sobald ein Glied der Kette fehlt oder
	 * ungültig ist; `visiting` bricht (über von Hand gebaute TOML mögliche)
	 * Zyklen ab.
	 */
	function effectiveRange(label: string, visiting: Set<string>): { min: number; max: number } | null {
		const selected = byLabel.get(label);
		if (!selected || visiting.has(label)) {
			return null;
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
			// Ohne konfigurierten Dateinamen greift der Standard `{schema}_{table}`
			// (siehe python/generate.py) — als Vorlage angezeigt, damit die
			// Übersicht dieselben Variablen-Tags zeigt wie der Table Editor.
			fileName: entry.table.output.fileName.trim() || '{schema}_{table}',
			ext: `.${(entry.table.output.format || 'csv').toLowerCase()}`,
			records: table.records,
			estimatedMin: estimated?.min,
			estimatedMax: estimated?.max,
			found: true,
			secondary: !!referencedTable,
			referencedTable,
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

	public static register(context: vscode.ExtensionContext, index: WorkspaceIndex): vscode.Disposable {
		const provider = new ProjectEditorProvider(context, index);
		const providerRegistration = vscode.window.registerCustomEditorProvider(ProjectEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	/** Offene Projekt-Webviews samt ihrem Dokument, um sie bei Änderungen an .td-Dateien im Workspace (Tabellen-Tab) neu zu versorgen. */
	private readonly panelDocuments = new Map<vscode.WebviewPanel, vscode.TextDocument>();
	private cachedEntries: TableEntry[] = [];
	/** Zuletzt ermittelte Generator-Liste (eingebaute + `.tdgen`-Dateien), für computeRequiredClosure. */
	private cachedGenerators: GeneratorBase[] = [];
	private readonly indexSub: vscode.Disposable;
	/**
	 * Aufgelöster Interpreter-Status je verknüpftem Interpreter (`pfad|id`):
	 * postState läuft bei jedem Tastendruck im Projekt (onDidChangeTextDocument)
	 * — die Auflösung über die Python-Extension-API soll dabei nicht jedes Mal
	 * neu passieren. Beim Öffnen eines Projekts ('ready') wird frisch
	 * aufgelöst und der Cache aktualisiert.
	 */
	private readonly pythonStatusCache = new Map<string, ResolvedPythonStatus>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly index: WorkspaceIndex,
	) {
		// Der gemeinsame Workspace-Index meldet Änderungen bereits debounced;
		// relevant sind .td (Tabellen selbst) und .tdgen (die automatische
		// Tabellen-Mitnahme berücksichtigt auch Generator-Referenzen, siehe
		// computeRequiredClosure).
		this.indexSub = index.onDidChange((kinds) => {
			if (kinds.has('td') || kinds.has('tdgen')) {
				void this.broadcastPickerTree();
			}
		});
	}

	public dispose(): void {
		this.indexSub.dispose();
	}

	/** Löst den verknüpften Interpreter auf — aus dem Cache, außer `fresh` erzwingt eine Neuauflösung. */
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

		// Zähler statt einfachem Flag für selbst angestoßene WorkspaceEdits —
		// siehe table/editorProvider.ts für die ausführliche Begründung
		// (überlappende Edits würden sonst den Webview-Zustand mitten in der
		// Bearbeitung ersetzen).
		let selfEditsPending = 0;
		/** Zuletzt selbst angestoßener Dokumenttext — Vergleichsbasis, solange Edits unterwegs sind. */
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
				const outputFiles = buildOutputFiles(state.project, this.cachedEntries);
				const pythonStatus = state.project.python ? await this.resolvePythonStatus(state.project.python, false) : null;
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
					const outputFiles = 'project' in state ? buildOutputFiles(state.project, this.cachedEntries) : [];
					const pythonStatus =
						'project' in state && state.project.python ? await this.resolvePythonStatus(state.project.python, true) : null;
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
				case 'pickOutputFolder': {
					// Ordner-Auswahldialog für den Ausgabeordner; das Ergebnis wird
					// als fester Text ins Tag-Feld übernommen (Variablen lassen sich
					// danach weiterhin ergänzen).
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
					// Innerhalb des Projektordners relativ speichern (portabel,
					// mit Vorwärts-Schrägstrichen), sonst absolut.
					const relative = path.relative(projectDir.fsPath, picked[0].fsPath);
					const outputPath =
						relative && !relative.startsWith('..') && !path.isAbsolute(relative)
							? relative.replace(/\\/g, '/')
							: picked[0].fsPath;
					// Löst über das normale onDidChangeTextDocument -> postState()
					// eine aktualisierte Anzeige aus (wie changePython).
					await this.applyText(document, serializeProject({ ...current.project, outputPath }));
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
		return this.cachedEntries;
	}

	/**
	 * Schickt allen offenen Projekt-Webviews den neu berechneten Auswahlbaum
	 * (z. B. nach Anlegen/Löschen/Umbenennen einer `.td`-Datei oder Änderung
	 * ihrer FK-Spalten) — die Auswahl selbst (welche Pfade zum Projekt
	 * gehören) ändert sich dadurch nicht, nur ihre Anzeige. Debouncing
	 * übernimmt der Workspace-Index (siehe Konstruktor).
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
export function buildTableRows(project: Project, entries: TableEntry[]): ProjectTableRow[] {
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
	// Referenz-Kanten EINMAL aus den Einträgen ableiten (FK-Spalten +
	// Generator-Referenzen auflösen ist der teure Teil) — jede der folgenden
	// Hüllen-Berechnungen (eine je ausgewählter Tabelle, siehe
	// isLockedSelection) ist dann reine Graph-Traversierung.
	const edges = buildRequiredEdges(entries, generators);
	const required = closureOf(explicit, edges);
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
