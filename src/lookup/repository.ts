import * as vscode from 'vscode';
import { LookupList } from './model';
import { parseLookupText } from './csv';
import { readFileText } from '../table/repository';
import { ParseError } from '../tomlUtil';
import { KnownLookupRef } from '../generator/types';

/**
 * A `.lkp` file in the workspace, read raw and parsed — the lookup list
 * counterpart to TableEntry in table/repository.ts. Basis for the lookup
 * generator (picker + validation in the table editor) and for building the
 * generator run's plan.
 */
export interface LookupEntry {
	uri: vscode.Uri;
	/** Workspace-relative path (POSIX separators), via `vscode.workspace.asRelativePath`. */
	relativePath: string;
	/** Raw text at the time it was read — lets diagnostics work without reading/parsing again. */
	text: string;
	/** The parsed list, or `null` if the file is not valid CSV (or could not be read). */
	lookup: LookupList | null;
	/** The parse error including its position if the CSV is broken (unset for read errors). */
	error: ParseError | null;
	/** Referenceable name: the `# name:` metadata value, otherwise the file name without its extension. */
	name: string;
}

/** Builds the entry for a `.lkp` file from its raw text (`text: null` = unreadable) — see buildTableEntry. */
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
 * Reads and parses every `.lkp` file in the workspace (including unsaved
 * contents of open editors). For the lists needed continuously, the workspace
 * index (src/workspaceIndex.ts) keeps a shared cache.
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
 * Condenses entries into the reference info used by validation and the pickers
 * (one row per name, duplicates collapsed to the first match, sorted by name).
 * Only named value columns are offered.
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
