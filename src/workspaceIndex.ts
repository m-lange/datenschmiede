import * as vscode from 'vscode';
import { Project } from './project/model';
import { parseProjectText } from './project/toml';
import { ParseError } from './tomlUtil';
import { TableEntry, buildTableEntry, readFileText } from './table/repository';
import { GeneratorEntry, buildGeneratorEntry } from './generator/repository';
import { LookupEntry, buildLookupEntry } from './lookup/repository';

/** Alle Dateitypen dieser Extension, die der Index beobachtet. */
const WATCH_PATTERN = '**/*.{td,tdproject,lkp,tdgen}';

/** Dateiart nach Endung — für gezielte Benachrichtigung der Abnehmer. */
export type IndexedFileKind = 'td' | 'tdgen' | 'lkp' | 'tdproject';

function kindOf(uri: vscode.Uri): IndexedFileKind | null {
	const path = uri.path;
	if (path.endsWith('.td')) {
		return 'td';
	}
	if (path.endsWith('.tdgen')) {
		return 'tdgen';
	}
	if (path.endsWith('.lkp')) {
		return 'lkp';
	}
	if (path.endsWith('.tdproject')) {
		return 'tdproject';
	}
	return null;
}

/** Eine `.tdproject`-Datei im Workspace — Gegenstück zu TableEntry für Projekte (nur von den Diagnostics benötigt). */
export interface ProjectEntry {
	uri: vscode.Uri;
	/** Workspace-relativer Pfad (POSIX-Trenner), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Rohtext zum Zeitpunkt des Einlesens. */
	text: string;
	/** Geparstes Projekt, oder `null`, wenn die Datei kein gültiges TOML enthält (oder nicht lesbar war). */
	project: Project | null;
	/** Der Parse-Fehler samt Position, falls das TOML kaputt ist (nicht gesetzt bei Lese-Fehlern). */
	error: ParseError | null;
}

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

/** Ein vollständiger, in sich konsistenter Stand aller Datenschmiede-Dateien des Workspace. */
export interface WorkspaceSnapshot {
	tables: TableEntry[];
	generators: GeneratorEntry[];
	lookups: LookupEntry[];
	projects: ProjectEntry[];
}

/**
 * Gemeinsamer Workspace-Index für alle `.td`-, `.tdgen`-, `.lkp`- und
 * `.tdproject`-Dateien: EIN Watcher-Satz, EIN (gebündelter, debouncter)
 * Änderungs-Event und EIN gecachter Einlese-Stand (Rohtext + geparstes
 * Modell je Datei) — statt dass Diagnostics, Table Editor und Projekt-Editor
 * jeweils eigene Watcher halten und den Workspace unabhängig voneinander
 * mehrfach neu einlesen.
 *
 * Getriggert wird die Invalidierung von Datei-Änderungen auf der Festplatte
 * (Watcher), von Eingaben in offenen Editoren (onDidChangeTextDocument —
 * gelesen wird immer der aktuelle Buffer-Stand, siehe readFileText) und vom
 * Schließen eines Editors (zurück zum Festplatten-Stand). `snapshot()`
 * liest bei Bedarf neu ein; solange nichts invalidiert wurde, teilen sich
 * alle Aufrufer denselben Stand.
 */
export class WorkspaceIndex implements vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<ReadonlySet<IndexedFileKind>>();
	/** Feuert (debounced) nach Änderungen an Index-Dateien — mit den betroffenen Dateiarten seit dem letzten Event. */
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
	 * Aktueller Einlese-Stand — gecacht bis zur nächsten Invalidierung;
	 * parallele Aufrufer teilen sich denselben (laufenden) Einlese-Vorgang.
	 */
	public snapshot(): Promise<WorkspaceSnapshot> {
		if (!this.snapshotPromise) {
			this.snapshotPromise = this.load();
		}
		return this.snapshotPromise;
	}

	/** Cache verwerfen und die Abnehmer (debounced) benachrichtigen. */
	private invalidate(kind: IndexedFileKind | null): void {
		if (!kind) {
			return;
		}
		this.snapshotPromise = null;
		this.pendingKinds.add(kind);
		if (this.notifyTimer) {
			clearTimeout(this.notifyTimer);
		}
		// Debounced, damit z. B. Tippen in einem offenen Editor nicht bei jedem
		// Anschlag alle Abnehmer den Workspace neu verarbeiten lässt.
		this.notifyTimer = setTimeout(() => {
			this.notifyTimer = undefined;
			const kinds = new Set(this.pendingKinds);
			this.pendingKinds.clear();
			this.emitter.fire(kinds);
		}, 400);
	}

	/** Liest alle Index-Dateien mit EINEM findFiles-Durchlauf neu ein (parallel gelesen, Ergebnis in stabiler Pfad-Reihenfolge). */
	private async load(): Promise<WorkspaceSnapshot> {
		const uris = await vscode.workspace.findFiles(WATCH_PATTERN, '**/node_modules/**');
		// Stabile Reihenfolge, damit „erster Treffer gewinnt“-Deduplizierungen
		// (doppelte logische Namen, siehe toTableOptions & Co.) über Snapshots
		// hinweg dieselbe Datei wählen — findFiles garantiert keine Ordnung.
		const read = await Promise.all(
			uris.map(async (uri) => ({
				uri,
				kind: kindOf(uri),
				relativePath: vscode.workspace.asRelativePath(uri, false),
				text: await readFileText(uri).catch(() => null),
			})),
		);
		read.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

		const snapshot: WorkspaceSnapshot = { tables: [], generators: [], lookups: [], projects: [] };
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
			}
		}
		return snapshot;
	}
}
