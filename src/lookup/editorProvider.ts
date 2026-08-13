import * as vscode from 'vscode';
import { LookupList, parseWeight } from './model';
import { parseLookupText, serializeLookup, findLookupLineInfo } from './csv';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getLookupWebviewStrings } from './webviewStrings';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; lookup: LookupList }
	| { type: 'columnWidths'; columnWidths: Record<string, number> };
type ParsedDocument = { lookup: LookupList } | { error: unknown };

/** Schlüssel für die geräteweit (über alle .lkp-Dateien hinweg) gemerkten Grid-Spaltenbreiten. */
const COLUMN_WIDTHS_STATE_KEY = 'datenschmiede.lookupColumnWidths';

/**
 * Custom-Text-Editor für .lkp-Dateien (Nachschlagelisten des Testdaten-Generators).
 *
 * Die Datei auf der Festplatte bleibt normaler CSV-Text (siehe lookup/csv.ts);
 * wie in table/editorProvider.ts hält diese Klasse Webview und
 * VS-Code-Textdokument synchron. Inhaltliche Probleme (fehlende/ungültige
 * Gewichte, Gewichtssumme ungleich 100 %) landen zusätzlich als Diagnostics
 * in VS Codes Problems-Ansicht.
 */
export class LookupEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	public static readonly viewType = 'datenschmiede.lookupEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new LookupEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(LookupEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	private readonly diagnostics: vscode.DiagnosticCollection;
	private readonly closeDocSub: vscode.Disposable;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.diagnostics = vscode.languages.createDiagnosticCollection('lkp');
		this.closeDocSub = vscode.workspace.onDidCloseTextDocument((doc) => {
			if (doc.fileName.endsWith('.lkp')) {
				this.diagnostics.delete(doc.uri);
			}
		});
	}

	public dispose(): void {
		this.diagnostics.dispose();
		this.closeDocSub.dispose();
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const strings = getLookupWebviewStrings(vscode.env.language);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

		this.updateDiagnostics(document);

		// Zähler statt einfachem Flag für selbst angestoßene WorkspaceEdits —
		// siehe table/editorProvider.ts für die ausführliche Begründung
		// (überlappende Edits würden sonst den Webview-Zustand mitten in der
		// Bearbeitung ersetzen und Folge-Eingaben verlieren).
		let selfEditsPending = 0;
		/** Zuletzt selbst angestoßener Dokumenttext — Vergleichsbasis, solange Edits unterwegs sind. */
		let lastQueuedText: string | null = null;

		const postState = () => {
			const state = this.readState(document);
			if ('lookup' in state) {
				void webviewPanel.webview.postMessage({ type: 'update', lookup: state.lookup });
			} else {
				void webviewPanel.webview.postMessage({ type: 'parseError', message: state.parseError });
			}
		};

		const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			this.updateDiagnostics(document);
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
		});

		webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
			switch (message.type) {
				case 'ready': {
					const state = this.readState(document);
					const columnWidths = this.context.globalState.get<Record<string, number>>(COLUMN_WIDTHS_STATE_KEY, {});
					void webviewPanel.webview.postMessage({ type: 'init', strings, columnWidths, ...state });
					break;
				}
				case 'edit': {
					const newText = serializeLookup(message.lookup);
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
				case 'columnWidths': {
					// Geräteweit über alle .lkp-Dateien hinweg gemerkt (persönliche
					// Anzeige-Präferenz, kein Teil der Liste selbst).
					await this.context.globalState.update(COLUMN_WIDTHS_STATE_KEY, message.columnWidths);
					break;
				}
			}
		});
	}

	private parseDocument(document: vscode.TextDocument): ParsedDocument {
		try {
			return { lookup: parseLookupText(document.getText()) };
		} catch (err) {
			return { error: err };
		}
	}

	/** Liest und parst das Dokument; liefert entweder das Listen-Modell oder eine lokalisierte Fehlermeldung. */
	private readState(document: vscode.TextDocument): { lookup: LookupList } | { parseError: string } {
		const result = this.parseDocument(document);
		if ('lookup' in result) {
			return result;
		}
		const err = result.error;
		if (err instanceof ParseError) {
			return { parseError: this.formatParseError(err) };
		}
		return { parseError: String(err) };
	}

	/**
	 * Aktualisiert die Problems-Ansicht für dieses Dokument: bei kaputtem CSV
	 * der Syntaxfehler an seiner Position, sonst die Gewichts-Prüfungen —
	 * dieselben Regeln, die in der Webview das Gewichtsfeld bzw. die
	 * Summenzeile rot markieren.
	 */
	private updateDiagnostics(document: vscode.TextDocument): void {
		const result = this.parseDocument(document);

		if ('lookup' in result) {
			this.diagnostics.set(document.uri, this.buildWeightDiagnostics(document, result.lookup));
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
	 * Jede Wertezeile braucht ein lesbares Gewicht in Prozent; fehlende oder
	 * ungültige Gewichte werden einzeln an ihrer Zeile gemeldet. Die
	 * Gewichtssumme wird bewusst nicht geprüft: was eingegeben wurde, gilt —
	 * auch deutlich über 100 % in Summe; die Summenzeile der Webview zeigt
	 * den Gesamtwert rein informativ.
	 */
	private buildWeightDiagnostics(document: vscode.TextDocument, lookup: LookupList): vscode.Diagnostic[] {
		const info = findLookupLineInfo(document.getText());
		const diagnostics: vscode.Diagnostic[] = [];

		const lineRange = (line: number) => document.lineAt(Math.min(line, Math.max(0, document.lineCount - 1))).range;

		lookup.rows.forEach((row, index) => {
			if (parseWeight(row.weight) !== null) {
				return;
			}
			const missing = row.weight.trim() === '';
			const message = missing
				? vscode.l10n.t('Row {0} has no weight.', index + 1)
				: vscode.l10n.t('Row {0}: invalid weight (use e.g. "25" or "12.5").', index + 1);
			const diagnostic = new vscode.Diagnostic(
				lineRange(info.rowLines[index] ?? 0),
				message,
				vscode.DiagnosticSeverity.Error,
			);
			diagnostic.source = 'Datenschmiede';
			diagnostic.code = missing ? 'missing-weight' : 'invalid-weight';
			diagnostics.push(diagnostic);
		});

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

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const mediaUri = (...segments: string[]) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...segments));

		const commonScriptUri = mediaUri('common.js');
		const scriptUri = mediaUri('lookup.js');
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
	<title>Lookup List Editor</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}" src="${commonScriptUri}"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
