import * as vscode from 'vscode';
import { GeneratorBase } from './base';
import { BUILTIN_GENERATORS } from './builtins';
import { CustomGenerator } from './custom';
import { GeneratorFile } from './model';
import { parseGeneratorText } from './toml';
import { readFileText } from '../table/repository';
import { ParseError } from '../tomlUtil';

/**
 * Eine `.tdgen`-Datei im Workspace, roh eingelesen und geparst — Gegenstück
 * zu TableEntry in table/repository.ts für benutzerdefinierte Generatoren.
 */
export interface GeneratorEntry {
	uri: vscode.Uri;
	/** Workspace-relativer Pfad (POSIX-Trenner), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Rohtext zum Zeitpunkt des Einlesens — für Diagnostics ohne erneutes Lesen/Parsen. */
	text: string;
	/** Geparster Generator, oder `null`, wenn die Datei kein gültiges TOML enthält (oder nicht lesbar war). */
	file: GeneratorFile | null;
	/** Der Parse-Fehler samt Position, falls das TOML kaputt ist (nicht gesetzt bei Lese-Fehlern). */
	error: ParseError | null;
	/** Aufgelöster Generator (nur wenn `file` lesbar ist und einen Namen hat). */
	generator: CustomGenerator | null;
}

/** Baut den Eintrag einer `.tdgen`-Datei aus ihrem Rohtext (`text: null` = nicht lesbar) — siehe buildTableEntry. */
export function buildGeneratorEntry(uri: vscode.Uri, relativePath: string, text: string | null): GeneratorEntry {
	if (text === null) {
		return { uri, relativePath, text: '', file: null, error: null, generator: null };
	}
	try {
		const file = parseGeneratorText(text);
		const generator = file.name.trim() ? new CustomGenerator(file) : null;
		return { uri, relativePath, text, file, error: null, generator };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, file: null, error, generator: null };
	}
}

/**
 * Liest und parst alle `.tdgen`-Dateien im Workspace ein — wie
 * table/repository.ts#listTables inklusive der noch ungesicherten Inhalte
 * offener Editoren; Dateien mit kaputtem TOML bleiben (mit `file: null`) in
 * der Liste. Für die laufend benötigten Listen hält der Workspace-Index
 * (src/workspaceIndex.ts) einen gemeinsamen Cache.
 */
export async function listGenerators(): Promise<GeneratorEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.tdgen', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<GeneratorEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			const text = await readFileText(uri).catch(() => null);
			return buildGeneratorEntry(uri, relativePath, text);
		}),
	);
}

/**
 * Verdichtet Workspace-Einträge zur vollständigen Generator-Liste
 * (eingebaute zuerst, danach die benutzerdefinierten nach Name sortiert;
 * Duplikate — zwei Dateien mit demselben Namen — werden auf den ersten
 * Treffer reduziert). Grundlage für Generator-Auswahl und Validierung im
 * Table Editor sowie die Plan-Erstellung des Generator-Laufs.
 */
export function toGeneratorList(entries: GeneratorEntry[]): GeneratorBase[] {
	const customs = new Map<string, CustomGenerator>();
	for (const entry of entries) {
		if (entry.generator && !customs.has(entry.generator.id)) {
			customs.set(entry.generator.id, entry.generator);
		}
	}
	const sorted = [...customs.values()].sort((a, b) => a.name.localeCompare(b.name));
	return [...BUILTIN_GENERATORS, ...sorted];
}
