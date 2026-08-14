import * as vscode from 'vscode';
import { Table } from './model';
import { parseTableText, serializeTable } from './toml';
import { ParseError } from '../tomlUtil';
import { fullDocumentRange, getNonce } from '../util';
import { getWebviewStrings } from './webviewStrings';
import { TableOption, toTableOptions } from './repository';
import { GeneratorBase } from '../generator/base';
import { toGeneratorList } from '../generator/repository';
import { toLookupRefs } from '../lookup/repository';
import { GeneratorParameter, KnownLookupRef } from '../generator/types';
import { isCustomGeneratorId } from '../generator/custom';
import { runTablePreview } from './preview';
import { WorkspaceIndex } from '../workspaceIndex';

export type { TableOption } from './repository';

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'edit'; table: Table }
	| { type: 'preview' }
	| { type: 'columnWidths'; columnWidths: Record<string, number> };
type ParsedDocument = { table: Table } | { error: unknown };

/** Key of the grid column widths remembered per machine (across all .td files). */
const COLUMN_WIDTHS_STATE_KEY = 'datenschmiede.columnWidths';

/**
 * A generator as the webview needs it (a serializable description instead of
 * the GeneratorBase instance): the picker list, the parameter dialog and the
 * display text are built from it on the client side (see media/table.js).
 */
export interface GeneratorOption {
	id: string;
	label: string;
	description: string;
	parameters: GeneratorParameter[];
	/** Display template with `{param}` placeholders (see fillDisplayTemplate in generator/types.ts). */
	displayTemplate?: string;
	/** `true` for custom generators coming from `.tdgen` files. */
	custom: boolean;
	/** `true` for the foreign key generator — selectable on FK columns only. */
	fkOnly: boolean;
}

/** Maps generator instances to their serializable webview description. */
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
 * Custom text editor for .td files.
 *
 * The file on disk stays plain TOML text (see toml.ts). This class keeps the
 * webview (the form) and the VS Code text document in sync: changes made in the
 * form are written back as TOML, while external changes to the text (undo, git,
 * manual editing) are re-parsed and pushed to the webview. Content problems
 * (e.g. a foreign key column without a referenced table) are reported in the
 * Problems view by the workspace-wide background validation (see
 * src/diagnostics.ts) — for unopened files as well; the webview surfaces the
 * same rules inline on the field.
 */
export class TableEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	public static readonly viewType = 'datenschmiede.tableEditor';

	public static register(context: vscode.ExtensionContext, index: WorkspaceIndex): vscode.Disposable {
		const provider = new TableEditorProvider(context, index);
		const providerRegistration = vscode.window.registerCustomEditorProvider(TableEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
		return vscode.Disposable.from(providerRegistration, provider);
	}

	/** All currently open .td webviews, so they can be notified about file changes in the workspace. */
	private readonly panels = new Set<vscode.WebviewPanel>();
	/**
	 * Most recently determined table list of the workspace, used to validate FK
	 * references (see validateTable). It is refreshed on every broadcast (file
	 * changes in the workspace, reported by the shared workspace index), so by
	 * construction it is at most a few hundred milliseconds stale — which the
	 * fast, synchronous validation on every keystroke (onDidChangeTextDocument)
	 * requires, as re-reading all .td files there would be far too expensive.
	 */
	private cachedTableOptions: TableOption[] = [];
	/** Most recently determined generator list (built-in + `.tdgen` files), analogous to cachedTableOptions. */
	private cachedGenerators: GeneratorBase[] = [];
	/** Most recently determined lookup lists (.lkp), analogous to cachedTableOptions. */
	private cachedLookups: KnownLookupRef[] = [];
	private readonly indexSub: vscode.Disposable;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly index: WorkspaceIndex,
	) {
		// The shared workspace index watches all Datenschmiede files (no own
		// watchers needed) and already reports changes debounced — .td/.tdgen/.lkp
		// are the ones affecting the three picker lists.
		this.indexSub = index.onDidChange((kinds) => {
			if (kinds.has('td') || kinds.has('tdgen') || kinds.has('lkp')) {
				void this.broadcastOptions();
			}
		});
	}

	public dispose(): void {
		this.indexSub.dispose();
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
		// Read fresh instead of using the (possibly still empty or stale) cache,
		// so that opening the editor does not briefly flash a wrong "table not
		// found" before the first broadcast has run.
		void this.refreshOptionsCache();

		// A counter rather than a simple flag: how many self-initiated
		// WorkspaceEdits are still "in flight", so their onDidChangeTextDocument
		// is not echoed back to the webview (which already knows that state ->
		// otherwise the form would be rebuilt and cursor/focus lost). A flag was
		// not enough: when two edits overlap (e.g. the immediate commit of a
		// select while a debounced commit is still running) it swallowed only
		// the first event — the second replaced the webview state mid-edit, and
		// follow-up input (in the parameter dialog, say) wrote into an orphaned
		// object and was lost.
		let selfEditsPending = 0;
		/** Most recent self-initiated document text — the comparison base while edits are in flight. */
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
			// The workspace index keeps the picker lists current (it also watches
			// typing in open editors) — only our own state is handled here.
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
					// Compare against the most recent self-initiated text while edits
					// are in flight — document.getText() lags behind in that case.
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
					// Generates 20 records with the current configuration through
					// the Python runner (see table/preview.ts); runTablePreview
					// shows any error message itself.
					const result = await runTablePreview(this.context, document);
					if (result) {
						void webviewPanel.webview.postMessage({ type: 'previewResult', ...result });
					} else {
						void webviewPanel.webview.postMessage({ type: 'previewDone' });
					}
					break;
				}
				case 'columnWidths': {
					// Remembered per machine across all .td files (a personal display
					// preference, not part of the table definition itself).
					await this.context.globalState.update(COLUMN_WIDTHS_STATE_KEY, message.columnWidths);
					break;
				}
			}
		});
	}

	/** Parses the document text, returning either the model or the raw parse error. */
	private parseDocument(document: vscode.TextDocument): ParsedDocument {
		try {
			return { table: parseTableText(document.getText()) };
		} catch (err) {
			return { error: err };
		}
	}

	/** Reads and parses the document; returns either the table model or a localized error message. */
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

	/** Pulls the current index snapshot and keeps the three picker lists ready for the webviews. */
	private async refreshOptionsCache(): Promise<void> {
		const snapshot = await this.index.snapshot();
		this.cachedTableOptions = toTableOptions(snapshot.tables);
		this.cachedGenerators = toGeneratorList(snapshot.generators);
		this.cachedLookups = toLookupRefs(snapshot.lookups);
	}

	/**
	 * Pushes the current picker lists to every open .td webview (e.g. after a
	 * table, generator or lookup list was created, deleted or renamed); the
	 * Problems view is kept up to date by the workspace-wide background
	 * validation (see src/diagnostics.ts). Debouncing is handled by the
	 * workspace index (see the constructor).
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

	/** Localized "Line x, column y: message" text for a TOML parse error. */
	private formatParseError(err: ParseError): string {
		if (err.line !== undefined && err.column !== undefined) {
			return vscode.l10n.t('Line {0}, column {1}: {2}', err.line, err.column, err.rawMessage);
		}
		return err.rawMessage;
	}

	/** Replaces the whole document with `newText` via a workspace edit (keeps undo working). */
	private applyText(document: vscode.TextDocument, newText: string): Thenable<boolean> {
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullDocumentRange(document), newText);
		return vscode.workspace.applyEdit(edit);
	}

	/** Builds the webview HTML shell (CSP with a per-load nonce, stylesheets and the unbundled scripts). */
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
