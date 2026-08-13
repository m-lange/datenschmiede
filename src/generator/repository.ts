import * as vscode from 'vscode';
import { GeneratorBase } from './base';
import { BUILTIN_GENERATORS } from './builtins';
import { CustomGenerator } from './custom';
import { GeneratorFile } from './model';
import { parseGeneratorText } from './toml';
import { readFileText } from '../table/repository';

/**
 * Eine `.tdgen`-Datei im Workspace, roh eingelesen und geparst — Gegenstück
 * zu TableEntry in table/repository.ts für benutzerdefinierte Generatoren.
 */
export interface GeneratorEntry {
	uri: vscode.Uri;
	/** Workspace-relativer Pfad (POSIX-Trenner), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Geparster Generator, oder `null`, wenn die Datei kein gültiges TOML enthält. */
	file: GeneratorFile | null;
	/** Aufgelöster Generator (nur wenn `file` lesbar ist und einen Namen hat). */
	generator: CustomGenerator | null;
}

/**
 * Liest und parst alle `.tdgen`-Dateien im Workspace ein — wie
 * table/repository.ts#listTables inklusive der noch ungesicherten Inhalte
 * offener Editoren; Dateien mit kaputtem TOML bleiben (mit `file: null`) in
 * der Liste.
 */
export async function listGenerators(): Promise<GeneratorEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.tdgen', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<GeneratorEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			try {
				const text = await readFileText(uri);
				const file = parseGeneratorText(text);
				const generator = file.name.trim() ? new CustomGenerator(file) : null;
				return { uri, relativePath, file, generator };
			} catch {
				return { uri, relativePath, file: null, generator: null };
			}
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
