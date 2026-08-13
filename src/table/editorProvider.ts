import * as vscode from 'vscode';
import { Table } from './model';
import { parseTableText, serializeTable } from './toml';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getWebviewStrings } from './webviewStrings';
import { TableOption, listTables, toTableOptions } from './repository';
import { GeneratorBase } from '../generator/base';
import { listGenerators, toGeneratorList } from '../generator/repository';
import { listLookups, toLookupRefs } from '../lookup/repository';
import { GeneratorParameter, KnownLookupRef } from '../generator/types';
import { isCustomGeneratorId } from '../generator/custom';
import { runTablePreview } from './preview';

export type { TableOption } from './repository';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; table: Table }
	| { type: 'preview' }
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
 * Fremdschlüssel-Spalte ohne referenzierte Tabelle) meldet die
 * Workspace-weite Hintergrund-Prüfung in der Problems-Ansicht (siehe
 * src/diagnostics.ts) — auch für nicht geöffnete Dateien; die Webview zeigt
 * dieselben Regeln direkt am Feld an.
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
	}

	public dispose(): void {
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
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
		// Frisch einlesen statt den (evtl. noch leeren oder veralteten) Cache zu
		// nehmen, damit beim Öffnen nicht kurz fälschlich "Tabelle nicht
		// gefunden" aufblitzt, bevor der erste Broadcast durchgelaufen ist.
		void this.refreshOptionsCache();

		// Zähler statt einfachem Flag: wie viele selbst angestoßene
		// WorkspaceEdits noch "unterwegs" sind, damit deren
		// onDidChangeTextDocument nicht an die Webview zurückgesendet wird
		// (sie kennt den Stand ja schon -> sonst würde das Formular neu
		// aufgebaut und Cursor/Fokus verloren gehen). Ein Flag reichte nicht:
		// überlappen sich zwei Edits (z. B. Sofort-Commit eines Selects
		// während ein debounce-Commit noch läuft), schluckte es nur das erste
		// Ereignis — das zweite ersetzte den Webview-Zustand mitten in der
		// Bearbeitung, und Folge-Eingaben (etwa im Parameter-Dialog)
		// schrieben in ein verwaistes Objekt und gingen verloren.
		let selfEditsPending = 0;
		/** Zuletzt selbst angestoßener Dokumenttext — Vergleichsbasis, solange Edits unterwegs sind. */
		let lastQueuedText: string | null = null;

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
			this.scheduleOptionsBroadcast();
			if (selfEditsPending > 0) {
				selfEditsPending--;
				if (selfEditsPending === 0) {
					lastQueuedText = null;
				}
				return;
			}
			postState();
		});

		webviewPanel.onDidDispose(() => {
			changeDocSub.dispose();
			this.panels.delete(webviewPanel);
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
					// Gegen den zuletzt selbst angestoßenen Text vergleichen, solange
					// noch Edits unterwegs sind — document.getText() hinkt dann hinterher.
					if (newText === (lastQueuedText ?? document.getText())) {
						break;
					}
					lastQueuedText = newText;
					selfEditsPending++;
					const applied = await this.applyText(document, newText);
					if (!applied) {
						selfEditsPending = Math.max(0, selfEditsPending - 1);
						lastQueuedText = null;
					}
					break;
				}
				case 'preview': {
					// Erzeugt 20 Datensätze mit der aktuellen Konfiguration über
					// den Python-Läufer (siehe table/preview.ts); Fehler zeigt
					// runTablePreview selbst als Meldung an.
					const result = await runTablePreview(this.context, document);
					if (result) {
						void webviewPanel.webview.postMessage({ type: 'previewResult', ...result });
					} else {
						void webviewPanel.webview.postMessage({ type: 'previewDone' });
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

	/** Liest Tabellen-, Generator- und Nachschlagelisten-Liste neu ein und hält sie für die Webview-Auswahllisten vor. */
	private async refreshOptionsCache(): Promise<void> {
		const [tables, generators, lookups] = await Promise.all([listTables(), listGenerators(), listLookups()]);
		this.cachedTableOptions = toTableOptions(tables);
		this.cachedGenerators = toGeneratorList(generators);
		this.cachedLookups = toLookupRefs(lookups);
	}

	/**
	 * Schickt allen offenen .td-Webviews die aktuellen Auswahllisten (z. B.
	 * nach Anlegen/Löschen/Umbenennen einer Tabelle, eines Generators oder
	 * einer Nachschlageliste); die Problems-Ansicht hält die Workspace-weite
	 * Hintergrund-Prüfung aktuell (siehe src/diagnostics.ts).
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
