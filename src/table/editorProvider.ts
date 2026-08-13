import * as vscode from 'vscode';
import { Table } from './model';
import { parseTableText, serializeTable, findColumnLineInfo } from './toml';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getWebviewStrings } from './webviewStrings';
import { validateTable, Issue } from './validation';
import { TableOption, listTables, toTableOptions } from './repository';
import { GeneratorBase } from '../generator/base';
import { listGenerators, toGeneratorList } from '../generator/repository';
import { listLookups, toLookupRefs } from '../lookup/repository';
import { GeneratorParameter, KnownLookupRef } from '../generator/types';
import { isCustomGeneratorId } from '../generator/custom';

export type { TableOption } from './repository';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; table: Table }
	| { type: 'columnWidths'; columnWidths: Record<string, number> };
type ParsedDocument = { table: Table } | { error: unknown };

/** Schlüssel für die geräteweit (über alle .td-Dateien hinweg) gemerkten Grid-Spaltenbreiten. */
const COLUMN_WIDTHS_STATE_KEY = 'datenschmiede.columnWidths';

/**
 * Ein Generator, wie ihn die Webview braucht (serialisierbare Beschreibung
 * statt der GeneratorBase-Instanz): Auswahl-Liste, Parameter-Dialog und
 * Anzeige-Text werden daraus clientseitig aufgebaut (siehe media/table.js).
 */
export interface GeneratorOption {
	id: string;
	label: string;
	description: string;
	parameters: GeneratorParameter[];
	/** Anzeige-Vorlage mit `{param}`-Platzhaltern (siehe fillDisplayTemplate in generator/types.ts). */
	displayTemplate?: string;
	/** `true` für benutzerdefinierte Generatoren aus `.tdgen`-Dateien. */
	custom: boolean;
	/** `true` für den Fremdschlüssel-Generator — nur für FK-Spalten wählbar. */
	fkOnly: boolean;
}

function toGeneratorOptions(generators: GeneratorBase[]): GeneratorOption[] {
	return generators.map((generator) => ({
		id: generator.id,
		label: generator.name,
		description: generator.description,
		parameters: generator.parameters,
		displayTemplate: generator.displayTemplate,
		custom: isCustomGeneratorId(generator.id),
		fkOnly: generator.id === 'foreign-key',
	}));
}

/**
 * Custom-Text-Editor für .td-Dateien.
 *
 * Die Datei auf der Festplatte bleibt normaler TOML-Text (siehe toml.ts).
 * Diese Klasse hält die Webview (das Formular) und das VS-Code-Textdokument
 * synchron: Änderungen im Formular werden als TOML zurückgeschrieben,
 * externe Änderungen am Text (z. B. Undo, Git, manuelles Bearbeiten) werden
 * neu geparst und an die Webview gesendet. Inhaltliche Probleme (z. B. eine
 * Fremdschlüssel-Spalte ohne referenzierte Tabelle, oder eine
 * Generator-Konfiguration, deren Referenzen nicht mehr existieren) landen
 * zusätzlich als Diagnostics in VS Codes Problems-Ansicht.
 */
export class TableEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	public static readonly viewType = 'datenschmiede.tableEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new TableEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(TableEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	/** Alle aktuell offenen .td-Webviews, um sie bei Datei-Änderungen im Workspace zu benachrichtigen. */
	private readonly panels = new Set<vscode.WebviewPanel>();
	/**
	 * Alle aktuell offenen .td-Textdokumente, um bei Änderungen an der
	 * Workspace-weiten Tabellenliste (z. B. eine referenzierte Datei wird
	 * gelöscht) auch für Dokumente neu zu validieren, deren eigener Text
	 * sich dabei gar nicht geändert hat.
	 */
	private readonly openDocuments = new Set<vscode.TextDocument>();
	/**
	 * Beobachtet .td-, .tdgen- und .lkp-Dateien im Workspace, um die
	 * FK-„Referenzierte Tabelle“-Liste, die Generator-Auswahl und die
	 * Nachschlagelisten-Auswahl aktuell zu halten — nicht nur bei
	 * Anlegen/Löschen, sondern auch bei inhaltlichen Änderungen, da alle drei
	 * Listen logische Namen statt Dateipfade anzeigen.
	 */
	private readonly watchers: vscode.FileSystemWatcher[] = [];
	/**
	 * Zuletzt ermittelte Tabellenliste des Workspace, für die Validierung von
	 * FK-Referenzen (siehe validateTable). Wird bei jedem Broadcast
	 * (Datei-Änderungen im Workspace) aktualisiert; per Konstruktion also
	 * höchstens ein paar hundert Millisekunden veraltet — für die schnelle,
	 * synchrone Validierung bei jedem Tastendruck (onDidChangeTextDocument)
	 * ist das nötig, ein erneutes Einlesen aller .td-Dateien wäre dort zu
	 * teuer.
	 */
	private cachedTableOptions: TableOption[] = [];
	/** Zuletzt ermittelte Generator-Liste (eingebaute + `.tdgen`-Dateien), analog zu cachedTableOptions. */
	private cachedGenerators: GeneratorBase[] = [];
	/** Zuletzt ermittelte Nachschlagelisten (.lkp), analog zu cachedTableOptions. */
	private cachedLookups: KnownLookupRef[] = [];
	/** Inhaltliche Probleme (z. B. fehlende FK-Referenz) für die VS-Code-Problems-Ansicht. */
	private readonly diagnostics: vscode.DiagnosticCollection;
	private readonly closeDocSub: vscode.Disposable;
	private optionsBroadcastTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		const refresh = () => this.scheduleOptionsBroadcast();
		for (const pattern of ['**/*.td', '**/*.tdgen', '**/*.lkp']) {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			watcher.onDidCreate(refresh);
			watcher.onDidDelete(refresh);
			watcher.onDidChange(refresh);
			this.watchers.push(watcher);
		}

		this.diagnostics = vscode.languages.createDiagnosticCollection('td');
		this.closeDocSub = vscode.workspace.onDidCloseTextDocument((doc) => {
			if (doc.fileName.endsWith('.td')) {
				this.diagnostics.delete(doc.uri);
			}
		});
	}

	public dispose(): void {
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
		this.diagnostics.dispose();
		this.closeDocSub.dispose();
		if (this.optionsBroadcastTimer) {
			clearTimeout(this.optionsBroadcastTimer);
		}
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const strings = getWebviewStrings(vscode.env.language);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

		this.panels.add(webviewPanel);
		this.openDocuments.add(document);
		// Frisch einlesen statt den (evtl. noch leeren oder veralteten) Cache zu
		// nehmen, damit beim Öffnen nicht kurz fälschlich "Tabelle nicht
		// gefunden" aufblitzt, bevor der erste Broadcast durchgelaufen ist.
		void this.refreshOptionsCache().then(() => this.updateDiagnostics(document));

		// Wird gesetzt, bevor wir selbst einen WorkspaceEdit auf das Dokument
		// anwenden, damit das dadurch ausgelöste onDidChangeTextDocument nicht
		// erneut an die Webview zurückgesendet wird (sie kennt den Stand ja
		// schon -> sonst würde bei jeder Eingabe das Formular neu aufgebaut
		// und der Cursor/Fokus verloren gehen).
		let ignoreNextChange = false;

		const postState = () => {
			const state = this.readState(document);
			if ('table' in state) {
				void webviewPanel.webview.postMessage({ type: 'update', table: state.table });
			} else {
				void webviewPanel.webview.postMessage({ type: 'parseError', message: state.parseError });
			}
		};

		const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			this.updateDiagnostics(document);
			this.scheduleOptionsBroadcast();
			if (ignoreNextChange) {
				ignoreNextChange = false;
				return;
			}
			postState();
		});

		webviewPanel.onDidDispose(() => {
			changeDocSub.dispose();
			this.panels.delete(webviewPanel);
			this.openDocuments.delete(document);
		});

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
			switch (message.type) {
				case 'ready': {
					const state = this.readState(document);
					await this.refreshOptionsCache();
					const columnWidths = this.context.globalState.get<Record<string, number>>(COLUMN_WIDTHS_STATE_KEY, {});
					void webviewPanel.webview.postMessage({
						type: 'init',
						strings,
						tableOptions: this.cachedTableOptions,
						generatorOptions: toGeneratorOptions(this.cachedGenerators),
						lookupOptions: this.cachedLookups,
						columnWidths,
						...state,
					});
					break;
				}
				case 'edit': {
					const newText = serializeTable(message.table);
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
				case 'columnWidths': {
					// Geräteweit über alle .td-Dateien hinweg gemerkt (persönliche
					// Anzeige-Präferenz, kein Teil der Tabellendefinition selbst).
					await this.context.globalState.update(COLUMN_WIDTHS_STATE_KEY, message.columnWidths);
					break;
				}
			}
		});
	}

	private parseDocument(document: vscode.TextDocument): ParsedDocument {
		try {
			return { table: parseTableText(document.getText()) };
		} catch (err) {
			return { error: err };
		}
	}

	/** Liest und parst das Dokument; liefert entweder das Tabellenmodell oder eine lokalisierte Fehlermeldung. */
	private readState(document: vscode.TextDocument): { table: Table } | { parseError: string } {
		const result = this.parseDocument(document);
		if ('table' in result) {
			return result;
		}
		const err = result.error;
		if (err instanceof ParseError) {
			return { parseError: this.formatParseError(err) };
		}
		return { parseError: String(err) };
	}

	/**
	 * Aktualisiert die Problems-Ansicht für dieses Dokument: bei kaputtem
	 * TOML der Syntaxfehler an seiner Position, sonst die inhaltlichen
	 * Prüfungen aus validation.ts — FK-Probleme als Fehler,
	 * Generator-Probleme als Warnungen.
	 */
	private updateDiagnostics(document: vscode.TextDocument): void {
		const result = this.parseDocument(document);

		if ('table' in result) {
			this.diagnostics.set(document.uri, this.buildValidationDiagnostics(document, result.table));
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

	private buildValidationDiagnostics(document: vscode.TextDocument, table: Table): vscode.Diagnostic[] {
		const issues = validateTable(table, this.cachedTableOptions, this.cachedGenerators, this.cachedLookups);
		if (issues.length === 0) {
			return [];
		}

		const columnLines = findColumnLineInfo(document.getText());

		return issues.map((issue) => {
			const info = columnLines[issue.columnIndex];
			const line = info ? info.nameLine ?? info.columnsLine : 0;
			const lineIndex = Math.min(line, Math.max(0, document.lineCount - 1));
			const range = document.lineAt(lineIndex).range;
			const diagnostic = new vscode.Diagnostic(
				range,
				this.formatIssueMessage(issue),
				issue.warning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
			);
			diagnostic.source = 'Datenschmiede';
			diagnostic.code = issue.kind;
			return diagnostic;
		});
	}

	private formatIssueMessage(issue: Issue): string {
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
			case 'gen-not-found':
				return vscode.l10n.t(
					'Column "{0}": generator "{1}" was not found. Its .tdgen file may have been deleted, or the generator was renamed.',
					label,
					issue.detail ?? '',
				);
			case 'gen-fk-only':
				return vscode.l10n.t('Column "{0}": the Foreign Key generator can only be used on foreign key columns.', label);
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
					'Column "{0}": the combine template references column "{1}", which does not exist in this table (or is the column itself).',
					label,
					issue.detail ?? '',
				);
			default:
				return issue.kind;
		}
	}

	/** Liest Tabellen-, Generator- und Nachschlagelisten-Liste neu ein und hält sie für die (synchrone) Validierung vor. */
	private async refreshOptionsCache(): Promise<void> {
		const [tables, generators, lookups] = await Promise.all([listTables(), listGenerators(), listLookups()]);
		this.cachedTableOptions = toTableOptions(tables);
		this.cachedGenerators = toGeneratorList(generators);
		this.cachedLookups = toLookupRefs(lookups);
	}

	/**
	 * Schickt allen offenen .td-Webviews die aktuellen Auswahllisten (z. B.
	 * nach Anlegen/Löschen/Umbenennen einer Tabelle, eines Generators oder
	 * einer Nachschlageliste) und validiert alle offenen Dokumente neu — so
	 * erscheint z. B. ein referenzierter Generator, der inzwischen gelöscht
	 * wurde, sofort als Problem, auch wenn das Dokument mit der Spalte selbst
	 * gerade nicht bearbeitet wird.
	 */
	private async broadcastOptions(): Promise<void> {
		await this.refreshOptionsCache();
		const generatorOptions = toGeneratorOptions(this.cachedGenerators);
		for (const panel of this.panels) {
			void panel.webview.postMessage({
				type: 'options',
				tableOptions: this.cachedTableOptions,
				generatorOptions,
				lookupOptions: this.cachedLookups,
			});
		}
		for (const document of this.openDocuments) {
			this.updateDiagnostics(document);
		}
	}

	/** Debounced, damit z. B. beim Tippen im Namensfeld nicht bei jeder Änderung der ganze Workspace neu gelesen wird. */
	private scheduleOptionsBroadcast(): void {
		if (this.optionsBroadcastTimer) {
			clearTimeout(this.optionsBroadcastTimer);
		}
		this.optionsBroadcastTimer = setTimeout(() => {
			this.optionsBroadcastTimer = undefined;
			void this.broadcastOptions();
		}, 400);
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

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const mediaUri = (...segments: string[]) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...segments));

		const commonScriptUri = mediaUri('common.js');
		const scriptUri = mediaUri('table.js');
		const styleUri = mediaUri('main.css');
		const codiconCssUri = mediaUri('codicon.css');

		const htmlLang = vscode.env.language.toLowerCase().startsWith('de') ? 'de' : 'en';

		return /* html */ `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
	<meta charset="UTF-8" />
	<meta
		http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
	/>
	<link href="${styleUri}" rel="stylesheet" />
	<link href="${codiconCssUri}" rel="stylesheet" />
	<title>Table Editor</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}" src="${commonScriptUri}"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
