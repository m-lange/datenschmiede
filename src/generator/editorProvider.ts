import * as vscode from 'vscode';
import { GeneratorFile } from './model';
import { parseGeneratorText, serializeGenerator, findParameterLineInfo, isKnownParameterType } from './toml';
import { PARAMETER_TYPES } from './types';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getGeneratorWebviewStrings } from './webviewStrings';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; generator: GeneratorFile }
	| { type: 'columnWidths'; columnWidths: Record<string, number> };
type ParsedDocument = { generator: GeneratorFile } | { error: unknown };

/** Schlüssel für die geräteweit (über alle .tdgen-Dateien hinweg) gemerkten Grid-Spaltenbreiten. */
const COLUMN_WIDTHS_STATE_KEY = 'datenschmiede.generatorColumnWidths';

/**
 * Custom-Text-Editor für .tdgen-Dateien (benutzerdefinierte Generatoren).
 *
 * Die Datei auf der Festplatte bleibt normaler TOML-Text (siehe
 * generator/toml.ts); wie in table/editorProvider.ts hält diese Klasse
 * Webview und VS-Code-Textdokument synchron. Die Oberfläche ist einem
 * Jupyter-Notebook nachempfunden: Name/Beschreibung als Markdown oben,
 * darunter die Parameter-Tabelle und die Python-Code-Zellen mit fest
 * vorgegebener (nicht änderbarer) Signatur und editierbarem Rumpf.
 */
export class GeneratorEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	public static readonly viewType = 'datenschmiede.generatorEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new GeneratorEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(GeneratorEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	private readonly diagnostics: vscode.DiagnosticCollection;
	private readonly closeDocSub: vscode.Disposable;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.diagnostics = vscode.languages.createDiagnosticCollection('tdgen');
		this.closeDocSub = vscode.workspace.onDidCloseTextDocument((doc) => {
			if (doc.fileName.endsWith('.tdgen')) {
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
		const strings = getGeneratorWebviewStrings(vscode.env.language);

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
			if ('generator' in state) {
				void webviewPanel.webview.postMessage({ type: 'update', generator: state.generator });
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
					void webviewPanel.webview.postMessage({
						type: 'init',
						strings,
						parameterTypes: [...PARAMETER_TYPES],
						columnWidths,
						...state,
					});
					break;
				}
				case 'edit': {
					const newText = serializeGenerator(message.generator);
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
					// Geräteweit über alle .tdgen-Dateien hinweg gemerkt (persönliche
					// Anzeige-Präferenz, kein Teil des Generators selbst).
					await this.context.globalState.update(COLUMN_WIDTHS_STATE_KEY, message.columnWidths);
					break;
				}
			}
		});
	}

	private parseDocument(document: vscode.TextDocument): ParsedDocument {
		try {
			return { generator: parseGeneratorText(document.getText()) };
		} catch (err) {
			return { error: err };
		}
	}

	/** Liest und parst das Dokument; liefert entweder das Generator-Modell oder eine lokalisierte Fehlermeldung. */
	private readState(document: vscode.TextDocument): { generator: GeneratorFile } | { parseError: string } {
		const result = this.parseDocument(document);
		if ('generator' in result) {
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
	 * der Syntaxfehler an seiner Position, sonst die inhaltlichen Prüfungen
	 * (fehlender Name, leere/doppelte Parameternamen, unbekannte
	 * Parametertypen, leerer generate-Rumpf).
	 */
	private updateDiagnostics(document: vscode.TextDocument): void {
		const result = this.parseDocument(document);

		if ('generator' in result) {
			this.diagnostics.set(document.uri, this.buildValidationDiagnostics(document, result.generator));
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

	private buildValidationDiagnostics(document: vscode.TextDocument, generator: GeneratorFile): vscode.Diagnostic[] {
		const diagnostics: vscode.Diagnostic[] = [];
		const lineRange = (line: number) => document.lineAt(Math.min(line, Math.max(0, document.lineCount - 1))).range;
		const push = (range: vscode.Range, message: string, code: string, severity: vscode.DiagnosticSeverity) => {
			const diagnostic = new vscode.Diagnostic(range, message, severity);
			diagnostic.source = 'Datenschmiede';
			diagnostic.code = code;
			diagnostics.push(diagnostic);
		};

		if (!generator.name.trim()) {
			// Ohne Name ist der Generator nicht referenzierbar (siehe generator/custom.ts).
			push(
				lineRange(0),
				vscode.l10n.t('This generator has no name — it cannot be selected in the table editor without one.'),
				'gen-file-missing-name',
				vscode.DiagnosticSeverity.Error,
			);
		}

		const parameterLines = findParameterLineInfo(document.getText());
		const seen = new Set<string>();
		generator.parameters.forEach((parameter, index) => {
			const info = parameterLines[index];
			const range = lineRange(info ? info.nameLine ?? info.parametersLine : 0);
			const name = parameter.name.trim();
			const label = name || vscode.l10n.t('parameter {0}', index + 1);
			if (!name) {
				push(range, vscode.l10n.t('Parameter {0} has no name.', index + 1), 'gen-file-param-unnamed', vscode.DiagnosticSeverity.Warning);
			} else if (seen.has(name)) {
				push(
					range,
					vscode.l10n.t('Parameter name "{0}" is used more than once.', name),
					'gen-file-param-duplicate',
					vscode.DiagnosticSeverity.Warning,
				);
			}
			seen.add(name);
			if (!isKnownParameterType(parameter.type)) {
				push(
					range,
					vscode.l10n.t('Parameter "{0}" has an unknown data type "{1}".', label, parameter.type),
					'gen-file-param-type',
					vscode.DiagnosticSeverity.Warning,
				);
			}
		});

		if (!generator.code.generate.trim()) {
			push(
				lineRange(0),
				vscode.l10n.t('The generate method has no code — this generator will not produce any values.'),
				'gen-file-empty-generate',
				vscode.DiagnosticSeverity.Warning,
			);
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

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const mediaUri = (...segments: string[]) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...segments));

		const commonScriptUri = mediaUri('common.js');
		const scriptUri = mediaUri('generator.js');
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
	<title>Generator Editor</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}" src="${commonScriptUri}"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
