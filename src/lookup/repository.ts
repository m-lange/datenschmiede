import * as vscode from 'vscode';
import { LookupList } from './model';
import { parseLookupText } from './csv';
import { readFileText } from '../table/repository';
import { ParseError } from '../tomlUtil';
import { KnownLookupRef } from '../generator/types';

/**
 * Eine `.lkp`-Datei im Workspace, roh eingelesen und geparst — Gegenstück zu
 * TableEntry in table/repository.ts für Nachschlagelisten. Grundlage für den
 * Nachschlagelisten-Generator (Auswahl + Validierung im Table Editor) und
 * die Plan-Erstellung des Generator-Laufs.
 */
export interface LookupEntry {
	uri: vscode.Uri;
	/** Workspace-relativer Pfad (POSIX-Trenner), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Rohtext zum Zeitpunkt des Einlesens — für Diagnostics ohne erneutes Lesen/Parsen. */
	text: string;
	/** Geparste Liste, oder `null`, wenn die Datei kein gültiges CSV enthält (oder nicht lesbar war). */
	lookup: LookupList | null;
	/** Der Parse-Fehler samt Position, falls das CSV kaputt ist (nicht gesetzt bei Lese-Fehlern). */
	error: ParseError | null;
	/** Referenzierbarer Name: der `# name:`-Metadaten-Wert, sonst der Dateiname ohne Endung. */
	name: string;
}

/** Baut den Eintrag einer `.lkp`-Datei aus ihrem Rohtext (`text: null` = nicht lesbar) — siehe buildTableEntry. */
export function buildLookupEntry(uri: vscode.Uri, relativePath: string, text: string | null): LookupEntry {
	const fallbackName = relativePath.replace(/^.*\//, '').replace(/\.lkp$/, '');
	if (text === null) {
		return { uri, relativePath, text: '', lookup: null, error: null, name: fallbackName };
	}
	try {
		const lookup = parseLookupText(text);
		return { uri, relativePath, text, lookup, error: null, name: lookup.name.trim() || fallbackName };
	} catch (err) {
		const error = err instanceof ParseError ? err : new ParseError(err instanceof Error ? err.message : String(err));
		return { uri, relativePath, text, lookup: null, error, name: fallbackName };
	}
}

/**
 * Liest und parst alle `.lkp`-Dateien im Workspace ein (inklusive
 * ungesicherter Inhalte offener Editoren). Für die laufend benötigten Listen
 * hält der Workspace-Index (src/workspaceIndex.ts) einen gemeinsamen Cache.
 */
export async function listLookups(): Promise<LookupEntry[]> {
	const uris = await vscode.workspace.findFiles('**/*.lkp', '**/node_modules/**');
	return Promise.all(
		uris.map(async (uri): Promise<LookupEntry> => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			const text = await readFileText(uri).catch(() => null);
			return buildLookupEntry(uri, relativePath, text);
		}),
	);
}

/**
 * Verdichtet Einträge zu den Referenz-Infos der Validierung/Auswahl (eine
 * Zeile je Name, Duplikate auf den ersten Treffer reduziert, nach Name
 * sortiert). Nur benannte Wertespalten werden angeboten.
 */
export function toLookupRefs(entries: LookupEntry[]): KnownLookupRef[] {
	const byName = new Map<string, KnownLookupRef>();
	for (const entry of entries) {
		if (byName.has(entry.name)) {
			continue;
		}
		const columns = entry.lookup ? entry.lookup.columns.map((c) => c.trim()).filter((c) => c.length > 0) : [];
		byName.set(entry.name, { name: entry.name, columns });
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
