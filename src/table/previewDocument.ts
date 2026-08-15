import * as vscode from 'vscode';

/**
 * URI scheme of the file previews (see previewFileCommand). A document under
 * this scheme is virtual: its content comes from the provider below rather than
 * from disk, which makes it **read-only and never dirty** — an untitled editor,
 * the obvious alternative, would count as unsaved and ask "Do you want to save
 * the changes?" every single time such a throwaway preview is closed.
 */
export const PREVIEW_SCHEME = 'datenschmiede-preview';

/**
 * Contents of the open previews, keyed by URI. A preview stays until it is
 * replaced by a newer one for the same table (same URI) or the window is
 * closed — long enough for reading, and nothing that has to be persisted.
 */
const contents = new Map<string, string>();

const emitter = new vscode.EventEmitter<vscode.Uri>();

const provider: vscode.TextDocumentContentProvider = {
	onDidChange: emitter.event,
	provideTextDocumentContent: (uri) => contents.get(uri.toString()) ?? '',
};

/** Registers the preview provider; call once during activation. */
export function registerPreviewDocuments(): vscode.Disposable {
	return vscode.Disposable.from(
		vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, provider),
		emitter,
	);
}

/**
 * Stores the content of a preview and returns its URI.
 *
 * The file name doubles as the identity: previewing the same table twice
 * replaces the first result instead of piling up tabs — and the tab is named
 * after the file the run would write, which is exactly what the preview shows.
 */
export function setPreviewContent(fileName: string, text: string): vscode.Uri {
	const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${fileName}` });
	contents.set(uri.toString(), text);
	// Tells VS Code to re-read an already open preview of the same name.
	emitter.fire(uri);
	return uri;
}
