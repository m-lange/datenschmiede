import * as vscode from 'vscode';
import { Project } from './project/model';
import { parseProjectText } from './project/toml';
import { ParseError } from './tomlUtil';
import { TableEntry, buildTableEntry, readFileText } from './table/repository';
import { GeneratorEntry, buildGeneratorEntry } from './generator/repository';
import { LookupEntry, buildLookupEntry } from './lookup/repository';
import { FileGeneratorEntry, buildFileGeneratorEntry } from './filegen/repository';

/** Every file type of this extension that the index watches. */
const WATCH_PATTERN = '**/*.{td,tdproject,lkp,tdgen,filegen}';

/** File kind derived from the extension — lets consumers be notified selectively. */
export type IndexedFileKind = 'td' | 'tdgen' | 'lkp' | 'tdproject' | 'filegen';

/** Maps a URI to its indexed file kind, or `null` for unrelated files. */

function kindOf(uri: vscode.Uri): IndexedFileKind | null {
	const path = uri.path;
	if (path.endsWith('.td')) {
		return 'td';
	}
	if (path.endsWith('.tdgen')) {
		return 'tdgen';
	}
	if (path.endsWith('.filegen')) {
		return 'filegen';
	}
	if (path.endsWith('.lkp')) {
		return 'lkp';
	}
	if (path.endsWith('.tdproject')) {
		return 'tdproject';
	}
	return null;
}

/** A `.tdproject` file in the workspace — the project counterpart to TableEntry (only needed by the diagnostics). */
export interface ProjectEntry {
	uri: vscode.Uri;
	/** Workspace-relative path (POSIX separators), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Raw text at the time it was read. */
	text: string;
	/** The parsed project, or `null` if the file is not valid TOML (or could not be read). */
	project: Project | null;
	/** The parse error including its position if the TOML is broken (unset for read errors). */
	error: ParseError | null;
}

/** Parses one `.tdproject` file into a {@link ProjectEntry}, capturing parse errors instead of throwing. */
function buildProjectEntry(uri: vscode.Uri, relativePath: string, text: string | null): ProjectEntry {
	if (text === null) {
		return { uri, relativePath, text: '', project: null, error: null };
	}
	try {
		return { uri, relativePath, text, project: parseProjectText(text), error: null };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, project: null, error };
	}
}

/** A complete, internally consistent view of every Datenschmiede file in the workspace. */
export interface WorkspaceSnapshot {
	tables: TableEntry[];
	generators: GeneratorEntry[];
	lookups: LookupEntry[];
	projects: ProjectEntry[];
	fileGenerators: FileGeneratorEntry[];
}

/**
 * Shared workspace index for all `.td`, `.tdgen`, `.lkp` and `.tdproject`
 * files: ONE set of watchers, ONE (batched, debounced) change event and ONE
 * cached read (raw text + parsed model per file) — instead of diagnostics,
 * table editor and project editor each keeping their own watchers and
 * re-reading the workspace independently.
 *
 * Invalidation is triggered by file changes on disk (watcher), by typing in
 * open editors (onDidChangeTextDocument — the current buffer contents are
 * always what gets read, see readFileText) and by closing an editor (back to
 * the on-disk state). `snapshot()` re-reads on demand; as long as nothing has
 * been invalidated, all callers share the same state.
 */
export class WorkspaceIndex implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<ReadonlySet<IndexedFileKind>>();
	/** Fires (debounced) after indexed files change — carrying the file kinds affected since the last event. */
	public readonly onDidChange = this.emitter.event;

	private readonly disposables: vscode.Disposable[] = [];
	private snapshotPromise: Promise<WorkspaceSnapshot> | null = null;
	private readonly pendingKinds = new Set<IndexedFileKind>();
	private notifyTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		const watcher = vscode.workspace.createFileSystemWatcher(WATCH_PATTERN);
		const onFsEvent = (uri: vscode.Uri) => this.invalidate(kindOf(uri));
		watcher.onDidCreate(onFsEvent);
		watcher.onDidDelete(onFsEvent);
		watcher.onDidChange(onFsEvent);
		this.disposables.push(watcher);
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((e) => this.invalidate(kindOf(e.document.uri))),
		);
		this.disposables.push(vscode.workspace.onDidCloseTextDocument((doc) => this.invalidate(kindOf(doc.uri))));
	}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		if (this.notifyTimer) {
			clearTimeout(this.notifyTimer);
		}
		this.emitter.dispose();
	}

	/**
	 * The current read state — cached until the next invalidation; concurrent
	 * callers share the same (in-flight) read.
	 */
	public snapshot(): Promise<WorkspaceSnapshot> {
		if (!this.snapshotPromise) {
			this.snapshotPromise = this.load();
		}
		return this.snapshotPromise;
	}

	/** Drops the cache and notifies consumers (debounced). */
	private invalidate(kind: IndexedFileKind | null): void {
		if (!kind) {
			return;
		}
		this.snapshotPromise = null;
		this.pendingKinds.add(kind);
		if (this.notifyTimer) {
			clearTimeout(this.notifyTimer);
		}
		// Debounced so that, for example, typing in an open editor does not make
		// every consumer reprocess the workspace on each keystroke.
		this.notifyTimer = setTimeout(() => {
			this.notifyTimer = undefined;
			const kinds = new Set(this.pendingKinds);
			this.pendingKinds.clear();
			this.emitter.fire(kinds);
		}, 400);
	}

	/** Re-reads all indexed files with ONE findFiles pass (read in parallel, result in stable path order). */
	private async load(): Promise<WorkspaceSnapshot> {
		const uris = await vscode.workspace.findFiles(WATCH_PATTERN, '**/node_modules/**');
		// Stable ordering so that "first match wins" deduplication (duplicate
		// logical names, see toTableOptions and friends) picks the same file
		// across snapshots — findFiles guarantees no particular order.
		const read = await Promise.all(
			uris.map(async (uri) => ({
				uri,
				kind: kindOf(uri),
				relativePath: vscode.workspace.asRelativePath(uri, false),
				text: await readFileText(uri).catch(() => null),
			})),
		);
		read.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

		const snapshot: WorkspaceSnapshot = { tables: [], generators: [], lookups: [], projects: [], fileGenerators: [] };
		for (const { uri, kind, relativePath, text } of read) {
			switch (kind) {
				case 'td':
					snapshot.tables.push(buildTableEntry(uri, relativePath, text));
					break;
				case 'tdgen':
					snapshot.generators.push(buildGeneratorEntry(uri, relativePath, text));
					break;
				case 'lkp':
					snapshot.lookups.push(buildLookupEntry(uri, relativePath, text));
					break;
				case 'tdproject':
					snapshot.projects.push(buildProjectEntry(uri, relativePath, text));
					break;
				case 'filegen':
					snapshot.fileGenerators.push(buildFileGeneratorEntry(uri, relativePath, text));
					break;
			}
		}
		return snapshot;
	}
}
